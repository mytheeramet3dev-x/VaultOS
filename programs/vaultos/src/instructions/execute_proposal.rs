use crate::errors::VaultOSError;
use crate::events::ProposalExecuted;
use crate::policies::PolicyEngine;
use crate::state::{
    ExecutionRecord, Member, Policy, Proposal, ProposalOperation, ProposalStatus, Vault,
};
use anchor_lang::prelude::*;
use anchor_lang::solana_program::{
    instruction::{AccountMeta, Instruction},
    program::invoke_signed,
    system_instruction,
};

#[derive(Accounts)]
pub struct ExecuteProposal<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    /// CHECK: Validated against vault seeds
    #[account(
        mut,
        seeds = [b"vault_authority", vault.key().as_ref()],
        bump = vault.authority_bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        mut,
        has_one = vault @ VaultOSError::Unauthorized,
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        init,
        payer = executor,
        space = ExecutionRecord::LEN,
        seeds = [b"execution", proposal.key().as_ref()],
        bump
    )]
    pub execution_record: Account<'info, ExecutionRecord>,

    #[account(
        seeds = [b"member", vault.key().as_ref(), executor.key().as_ref()],
        bump = executor_member.bump,
        constraint = executor_member.can_execute() @ VaultOSError::InvalidRole
    )]
    pub executor_member: Account<'info, Member>,

    #[account(mut)]
    pub executor: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(ctx: Context<'info, ExecuteProposal<'info>>) -> Result<()> {
    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault;
    let proposal = &mut ctx.accounts.proposal;

    // 1. Check freeze state (except unfreeze operation)
    let is_unfreeze_op = matches!(
        proposal.operation,
        ProposalOperation::SetFrozen { frozen: false }
    );
    if vault.is_frozen && !is_unfreeze_op {
        return err!(VaultOSError::VaultIsFrozen);
    }

    // 2. Lifecycle invariants
    require!(
        proposal.status != ProposalStatus::Executed,
        VaultOSError::ProposalAlreadyExecuted
    );
    require!(
        proposal.status != ProposalStatus::Cancelled,
        VaultOSError::ProposalCancelled
    );
    require!(
        clock.unix_timestamp <= proposal.expires_at,
        VaultOSError::ProposalExpired
    );
    require!(
        proposal.vault_revision == vault.config_revision,
        VaultOSError::StaleConfigRevision
    );

    // Retroactive Threshold Hardening: enforce max(proposal.required_threshold, vault.threshold)
    let effective_threshold = proposal.required_threshold.max(vault.threshold);
    require!(
        proposal.approval_count >= effective_threshold,
        VaultOSError::ThresholdNotMet
    );

    // Stale Approval Guard: verify that approvers are still active members with ROLE_APPROVER at execution time
    let mut verified_active_approvers: Vec<Pubkey> = Vec::new();
    if proposal.approvers.contains(&ctx.accounts.executor.key())
        && ctx.accounts.executor_member.can_approve()
    {
        verified_active_approvers.push(ctx.accounts.executor.key());
    }

    for account_info in ctx.remaining_accounts.iter() {
        if account_info.owner == &crate::ID {
            if let Ok(data) = account_info.try_borrow_data() {
                let mut slice: &[u8] = &data;
                if let Ok(member) = Member::try_deserialize(&mut slice) {
                    if member.vault == vault.key() {
                        let expected_member_pda = Pubkey::create_program_address(
                            &[
                                b"member",
                                vault.key().as_ref(),
                                member.wallet.as_ref(),
                                &[member.bump],
                            ],
                            &crate::ID,
                        )
                        .map_err(|_| error!(VaultOSError::InvalidPDASeeds))?;
                        require!(
                            account_info.key == &expected_member_pda,
                            VaultOSError::InvalidPDASeeds
                        );
                        if proposal.approvers.contains(&member.wallet) {
                            require!(
                                member.is_active && member.can_approve(),
                                VaultOSError::MemberNotFound
                            );
                            if !verified_active_approvers.contains(&member.wallet) {
                                verified_active_approvers.push(member.wallet);
                            }
                        }
                    }
                }
            }
        }
    }

    if !proposal.approvers.is_empty() {
        require!(
            verified_active_approvers.len() >= effective_threshold as usize,
            VaultOSError::ThresholdNotMet
        );
    }

    // 3. Timelock invariant
    if proposal.timelock_delay > 0 {
        let unlock_timestamp = proposal
            .approved_at
            .checked_add(proposal.timelock_delay)
            .ok_or(VaultOSError::ArithmeticOverflow)?;
        require!(
            clock.unix_timestamp >= unlock_timestamp,
            VaultOSError::TimelockNotElapsed
        );
    }

    // 4. Evaluate all active policies in remaining accounts (including execution-time escalation check)
    let mut evaluated_policy_indices: Vec<u16> = Vec::new();
    let mut has_program_allowlist = false;
    let mut escalated_threshold = effective_threshold;
    let mut escalated_timelock = proposal.timelock_delay;

    for account_info in ctx.remaining_accounts.iter() {
        if account_info.owner == &crate::ID {
            if let Ok(data) = account_info.try_borrow_data() {
                let mut slice: &[u8] = &data;
                if let Ok(mut policy) = Policy::try_deserialize(&mut slice) {
                    require!(policy.vault == vault.key(), VaultOSError::Unauthorized);
                    let expected_pda = Pubkey::create_program_address(
                        &[
                            b"policy",
                            vault.key().as_ref(),
                            policy.policy_index.to_le_bytes().as_ref(),
                            &[policy.bump],
                        ],
                        &crate::ID,
                    )
                    .map_err(|_| error!(VaultOSError::InvalidPDASeeds))?;
                    require!(
                        account_info.key == &expected_pda,
                        VaultOSError::InvalidPDASeeds
                    );
                    require!(
                        !evaluated_policy_indices.contains(&policy.policy_index),
                        VaultOSError::InvalidPDASeeds
                    );
                    evaluated_policy_indices.push(policy.policy_index);

                    if policy.is_active {
                        if matches!(
                            policy.policy_type,
                            crate::state::PolicyType::ProgramAllowlist { .. }
                        ) {
                            has_program_allowlist = true;
                        }
                        let (esc_thresh, esc_timelock) = PolicyEngine::compute_escalation(
                            &policy,
                            &proposal.operation,
                            effective_threshold,
                            proposal.timelock_delay,
                        )?;
                        escalated_threshold = escalated_threshold.max(esc_thresh);
                        escalated_timelock = escalated_timelock.max(esc_timelock);

                        PolicyEngine::evaluate_policy(
                            &mut policy,
                            &proposal.operation,
                            clock.unix_timestamp,
                        )?;
                        drop(data);
                        let mut mut_data = account_info.try_borrow_mut_data()?;
                        let mut out_slice: &mut [u8] = &mut mut_data;
                        policy.try_serialize(&mut out_slice)?;
                    }
                }
            }
        }
    }

    require!(
        evaluated_policy_indices.len() == vault.policy_count as usize,
        VaultOSError::Unauthorized
    );

    // Enforce escalated threshold & timelock computed from active policies at execution time
    require!(
        proposal.approval_count >= escalated_threshold,
        VaultOSError::EscalatedThresholdNotMet
    );
    if !proposal.approvers.is_empty() {
        require!(
            verified_active_approvers.len() >= escalated_threshold as usize,
            VaultOSError::EscalatedThresholdNotMet
        );
    }
    if escalated_timelock > 0 {
        let unlock_timestamp = proposal
            .approved_at
            .checked_add(escalated_timelock)
            .ok_or(VaultOSError::ArithmeticOverflow)?;
        require!(
            clock.unix_timestamp >= unlock_timestamp,
            VaultOSError::TimelockNotElapsed
        );
    }

    // 5. Execute operation
    let vault_key = vault.key();
    let authority_seeds: &[&[u8]] = &[
        b"vault_authority",
        vault_key.as_ref(),
        &[vault.authority_bump],
    ];
    let signer_seeds = &[authority_seeds];

    let mut dest_pubkey = Pubkey::default();
    let mut transfer_amount = 0u64;
    let op_type_id: u8;

    match proposal.operation.clone() {
        ProposalOperation::SolTransfer {
            destination,
            lamports,
        } => {
            op_type_id = 1;
            dest_pubkey = destination;
            transfer_amount = lamports;

            require!(lamports > 0, VaultOSError::ArithmeticOverflow);

            let dest_account = ctx
                .remaining_accounts
                .iter()
                .find(|a| a.key == &destination)
                .ok_or(VaultOSError::Unauthorized)?;

            let ix = system_instruction::transfer(
                &ctx.accounts.vault_authority.key(),
                &destination,
                lamports,
            );

            invoke_signed(
                &ix,
                &[
                    ctx.accounts.vault_authority.to_account_info(),
                    dest_account.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                signer_seeds,
            )?;
        }

        ProposalOperation::TokenTransfer {
            mint,
            destination,
            amount,
        } => {
            op_type_id = 2;
            dest_pubkey = destination;
            transfer_amount = amount;

            require!(amount > 0, VaultOSError::InvalidTokenAccount);
            let external_accounts: Vec<&AccountInfo<'info>> = ctx
                .remaining_accounts
                .iter()
                .filter(|a| a.owner != &crate::ID)
                .collect();
            require!(
                external_accounts.len() >= 3,
                VaultOSError::InvalidTokenAccount
            );
            let source_account = external_accounts[0];
            let dest_account = external_accounts[1];
            let token_program = external_accounts[2];

            // Strict Production Check: Verify destination account matches proposal destination
            require!(
                dest_account.key == &destination,
                VaultOSError::InvalidTokenAccount
            );

            // Strict Production Check: Verify token program is official SPL Token or Token-2022
            const SPL_TOKEN_ID: Pubkey = Pubkey::new_from_array([
                6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28,
                180, 133, 237, 95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
            ]);
            const SPL_TOKEN_2022_ID: Pubkey = Pubkey::new_from_array([
                6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218, 182, 26,
                252, 77, 131, 185, 13, 39, 254, 189, 249, 40, 216, 161, 139, 252,
            ]);
            require!(
                token_program.key == &SPL_TOKEN_ID || token_program.key == &SPL_TOKEN_2022_ID,
                VaultOSError::InvalidTokenAccount
            );

            // Verify source and destination token accounts are owned by the token program
            require!(
                source_account.owner == token_program.key
                    && dest_account.owner == token_program.key,
                VaultOSError::InvalidTokenAccount
            );

            // Verify SPL Token account layout: [0..32] = mint, [32..64] = owner
            {
                let src_data = source_account.try_borrow_data()?;
                let dst_data = dest_account.try_borrow_data()?;
                require!(
                    src_data.len() >= 72 && dst_data.len() >= 72,
                    VaultOSError::InvalidTokenAccount
                );
                require!(
                    &src_data[0..32] == mint.as_ref() && &dst_data[0..32] == mint.as_ref(),
                    VaultOSError::InvalidTokenAccount
                );
                require!(
                    &src_data[32..64] == ctx.accounts.vault_authority.key().as_ref(),
                    VaultOSError::InvalidVaultAuthority
                );
            }

            // Support both TransferChecked (when mint AccountInfo is passed) and Transfer
            let mint_account_opt = ctx
                .remaining_accounts
                .iter()
                .find(|a| a.key == &mint && a.owner == token_program.key);

            if let Some(mint_account) = mint_account_opt {
                let mint_data = mint_account.try_borrow_data()?;
                require!(mint_data.len() >= 45, VaultOSError::InvalidTokenAccount);
                let decimals = mint_data[44];
                drop(mint_data);

                let mut data = vec![12u8]; // SPL Token / Token-2022 instruction 12: TransferChecked
                data.extend_from_slice(&amount.to_le_bytes());
                data.push(decimals);

                let accounts = vec![
                    AccountMeta::new(*source_account.key, false),
                    AccountMeta::new_readonly(*mint_account.key, false),
                    AccountMeta::new(*dest_account.key, false),
                    AccountMeta::new_readonly(ctx.accounts.vault_authority.key(), true),
                ];

                let ix = Instruction {
                    program_id: *token_program.key,
                    accounts,
                    data,
                };

                invoke_signed(
                    &ix,
                    &[
                        source_account.clone(),
                        mint_account.clone(),
                        dest_account.clone(),
                        ctx.accounts.vault_authority.to_account_info(),
                        token_program.clone(),
                    ],
                    signer_seeds,
                )?;
            } else {
                let mut data = vec![3u8]; // SPL Token instruction 3: Transfer
                data.extend_from_slice(&amount.to_le_bytes());

                let accounts = vec![
                    AccountMeta::new(*source_account.key, false),
                    AccountMeta::new(*dest_account.key, false),
                    AccountMeta::new_readonly(ctx.accounts.vault_authority.key(), true),
                ];

                let ix = Instruction {
                    program_id: *token_program.key,
                    accounts,
                    data,
                };

                invoke_signed(
                    &ix,
                    &[
                        source_account.clone(),
                        dest_account.clone(),
                        ctx.accounts.vault_authority.to_account_info(),
                        token_program.clone(),
                    ],
                    signer_seeds,
                )?;
            }
        }

        ProposalOperation::ChangeThreshold { new_threshold } => {
            op_type_id = 5;
            require!(
                new_threshold >= 1 && new_threshold <= vault.member_count,
                VaultOSError::InvalidThreshold
            );
            require!(
                (new_threshold as usize) <= Proposal::MAX_APPROVERS,
                VaultOSError::MaxApproversReached
            );
            require!(
                new_threshold <= vault.approver_count,
                VaultOSError::ApproverThresholdShortfall
            );
            vault.threshold = new_threshold;
            vault.config_revision = vault
                .config_revision
                .checked_add(1)
                .ok_or(VaultOSError::ArithmeticOverflow)?;
        }

        ProposalOperation::SetTimelock { delay_seconds } => {
            op_type_id = 6;
            require!(
                delay_seconds >= 0 && delay_seconds <= Vault::MAX_TIMELOCK,
                VaultOSError::InvalidTimelock
            );
            vault.timelock_delay = delay_seconds;
            vault.config_revision = vault
                .config_revision
                .checked_add(1)
                .ok_or(VaultOSError::ArithmeticOverflow)?;
        }

        ProposalOperation::SetFrozen { frozen } => {
            op_type_id = 7;
            vault.is_frozen = frozen;
        }

        ProposalOperation::AddMember { wallet, roles } => {
            op_type_id = 3;
            dest_pubkey = wallet;
            require!(
                roles > 0 && (roles & !crate::state::ALL_ROLES) == 0,
                VaultOSError::InvalidRole
            );
            require!(
                vault.member_count < Vault::MAX_MEMBERS,
                VaultOSError::MaxMembersReached
            );

            let (expected_member_pda, member_bump) = Pubkey::find_program_address(
                &[b"member", vault.key().as_ref(), wallet.as_ref()],
                &crate::ID,
            );
            let target_member_info = ctx
                .remaining_accounts
                .iter()
                .find(|a| a.key == &expected_member_pda)
                .ok_or(VaultOSError::MemberNotFound)?;
            require!(target_member_info.is_writable, VaultOSError::Unauthorized);

            // Prevent overwriting an already-initialized Member PDA (which would corrupt member_count / admin_count)
            require!(
                target_member_info.data_is_empty()
                    && target_member_info.owner == &anchor_lang::solana_program::system_program::ID,
                VaultOSError::MemberAlreadyExists
            );

            // Prevent lamport pre-funding griefing: handle both 0-lamport and pre-funded PDA creation safely
            let rent_lamports = Rent::get()?.minimum_balance(Member::LEN);
            let current_lamports = target_member_info.lamports();
            let member_seeds: &[&[u8]] = &[
                b"member",
                vault_key.as_ref(),
                wallet.as_ref(),
                &[member_bump],
            ];

            if current_lamports == 0 {
                let create_ix = system_instruction::create_account(
                    &ctx.accounts.executor.key(),
                    &expected_member_pda,
                    rent_lamports,
                    Member::LEN as u64,
                    &crate::ID,
                );
                invoke_signed(
                    &create_ix,
                    &[
                        ctx.accounts.executor.to_account_info(),
                        target_member_info.clone(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                    &[member_seeds],
                )?;
            } else {
                if current_lamports < rent_lamports {
                    let top_up = rent_lamports
                        .checked_sub(current_lamports)
                        .ok_or(VaultOSError::ArithmeticOverflow)?;
                    let transfer_ix = system_instruction::transfer(
                        &ctx.accounts.executor.key(),
                        &expected_member_pda,
                        top_up,
                    );
                    invoke_signed(
                        &transfer_ix,
                        &[
                            ctx.accounts.executor.to_account_info(),
                            target_member_info.clone(),
                            ctx.accounts.system_program.to_account_info(),
                        ],
                        &[],
                    )?;
                }
                let alloc_ix =
                    system_instruction::allocate(&expected_member_pda, Member::LEN as u64);
                invoke_signed(
                    &alloc_ix,
                    &[
                        target_member_info.clone(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                    &[member_seeds],
                )?;
                let assign_ix = system_instruction::assign(&expected_member_pda, &crate::ID);
                invoke_signed(
                    &assign_ix,
                    &[
                        target_member_info.clone(),
                        ctx.accounts.system_program.to_account_info(),
                    ],
                    &[member_seeds],
                )?;
            }

            let new_member_state = Member {
                vault: vault.key(),
                wallet,
                roles,
                is_active: true,
                added_at: clock.unix_timestamp,
                bump: member_bump,
                config_revision_at_join: vault.config_revision,
            };
            let mut mut_data = target_member_info.try_borrow_mut_data()?;
            let mut out_slice: &mut [u8] = &mut mut_data;
            new_member_state.try_serialize(&mut out_slice)?;

            vault.member_count = vault
                .member_count
                .checked_add(1)
                .ok_or(VaultOSError::ArithmeticOverflow)?;
            if (roles & crate::state::ROLE_ADMIN) != 0 {
                vault.admin_count = vault
                    .admin_count
                    .checked_add(1)
                    .ok_or(VaultOSError::ArithmeticOverflow)?;
            }
            if (roles & crate::state::ROLE_APPROVER) != 0 {
                vault.approver_count = vault
                    .approver_count
                    .checked_add(1)
                    .ok_or(VaultOSError::ArithmeticOverflow)?;
            }
            if (roles & crate::state::ROLE_EXECUTOR) != 0 {
                vault.executor_count = vault
                    .executor_count
                    .checked_add(1)
                    .ok_or(VaultOSError::ArithmeticOverflow)?;
            }
        }

        ProposalOperation::RemoveMember { wallet } => {
            op_type_id = 4;
            dest_pubkey = wallet;

            let target_member_info = ctx
                .remaining_accounts
                .iter()
                .find(|a| {
                    if a.owner != &crate::ID {
                        return false;
                    }
                    if let Ok(d) = a.try_borrow_data() {
                        let mut s: &[u8] = &d;
                        if let Ok(m) = Member::try_deserialize(&mut s) {
                            return m.vault == vault.key() && m.wallet == wallet;
                        }
                    }
                    false
                })
                .ok_or(VaultOSError::MemberNotFound)?;
            require!(target_member_info.is_writable, VaultOSError::Unauthorized);

            let target_member = {
                let d = target_member_info.try_borrow_data()?;
                let mut s: &[u8] = &d;
                Member::try_deserialize(&mut s)?
            };
            require!(target_member.is_active, VaultOSError::MemberNotFound);
            let expected_pda = Pubkey::create_program_address(
                &[
                    b"member",
                    vault.key().as_ref(),
                    wallet.as_ref(),
                    &[target_member.bump],
                ],
                &crate::ID,
            )
            .map_err(|_| error!(VaultOSError::InvalidPDASeeds))?;
            require!(
                target_member_info.key == &expected_pda,
                VaultOSError::InvalidPDASeeds
            );

            require!(vault.member_count > 1, VaultOSError::InvalidThreshold);
            if target_member.is_admin() {
                require!(vault.admin_count > 1, VaultOSError::InvalidRole);
                vault.admin_count = vault
                    .admin_count
                    .checked_sub(1)
                    .ok_or(VaultOSError::ArithmeticOverflow)?;
            }
            if target_member.can_approve() {
                let new_approver_count = vault
                    .approver_count
                    .checked_sub(1)
                    .ok_or(VaultOSError::ArithmeticOverflow)?;
                require!(
                    new_approver_count >= vault.threshold,
                    VaultOSError::ApproverThresholdShortfall
                );
                vault.approver_count = new_approver_count;
            }
            if target_member.can_execute() {
                let new_executor_count = vault
                    .executor_count
                    .checked_sub(1)
                    .ok_or(VaultOSError::ArithmeticOverflow)?;
                require!(new_executor_count >= 1, VaultOSError::NoActiveExecutor);
                vault.executor_count = new_executor_count;
            }

            let new_member_count = vault
                .member_count
                .checked_sub(1)
                .ok_or(VaultOSError::ArithmeticOverflow)?;
            require!(
                new_member_count >= vault.threshold,
                VaultOSError::InvalidThreshold
            );
            vault.member_count = new_member_count;
            vault.config_revision = vault
                .config_revision
                .checked_add(1)
                .ok_or(VaultOSError::ArithmeticOverflow)?;

            // Safely close target_member account and return rent to executor
            let member_lamports = target_member_info.lamports();
            **target_member_info.try_borrow_mut_lamports()? = 0;
            **ctx.accounts.executor.try_borrow_mut_lamports()? = ctx
                .accounts
                .executor
                .lamports()
                .checked_add(member_lamports)
                .ok_or(VaultOSError::ArithmeticOverflow)?;
            target_member_info.assign(&anchor_lang::solana_program::system_program::ID);
            target_member_info.try_borrow_mut_data()?.fill(0);
        }

        ProposalOperation::CpiCall {
            program_id,
            instruction_data,
        } => {
            op_type_id = 8;
            dest_pubkey = program_id;

            // Core Asset & Re-entrancy Guard: block System, SPL Token, Token-2022, BPF Loader, VaultOS, and default pubkey
            require!(
                !PolicyEngine::is_forbidden_cpi_program(&program_id),
                VaultOSError::ProgramNotAllowed
            );
            require!(has_program_allowlist, VaultOSError::ProgramNotAllowed);

            let program_account = ctx
                .remaining_accounts
                .iter()
                .find(|a| a.key == &program_id && a.executable)
                .ok_or(VaultOSError::ProgramNotAllowed)?;

            let pre_cpi_lamports = ctx.accounts.vault_authority.lamports();
            let mut cpi_account_metas = vec![AccountMeta::new_readonly(
                ctx.accounts.vault_authority.key(),
                true,
            )];
            let mut cpi_account_infos = vec![ctx.accounts.vault_authority.to_account_info()];

            for acc in ctx.remaining_accounts.iter() {
                // Skip VaultOS internal verification accounts (Policy / Member PDAs), the target program itself, and duplicate vault_authority
                if acc.owner == &crate::ID
                    || acc.key == &program_id
                    || acc.key == &ctx.accounts.vault_authority.key()
                {
                    continue;
                }
                // Block passing core asset/system programs into CpiCall remaining_accounts to prevent nested CPI outflows
                require!(
                    !PolicyEngine::is_forbidden_cpi_program(acc.key),
                    VaultOSError::ProgramNotAllowed
                );
                // Block passing writable token accounts owned by vault_authority into CpiCall (token outflows must use TokenTransfer)
                if acc.is_writable
                    && (acc.owner == &crate::policies::SPL_TOKEN_PROGRAM_ID
                        || acc.owner == &crate::policies::SPL_TOKEN_2022_PROGRAM_ID)
                {
                    let ta_data = acc.try_borrow_data()?;
                    if ta_data.len() >= 64
                        && &ta_data[32..64] == ctx.accounts.vault_authority.key().as_ref()
                    {
                        return err!(VaultOSError::ProgramNotAllowed);
                    }
                }
                if acc.is_writable {
                    cpi_account_metas.push(AccountMeta::new(*acc.key, acc.is_signer));
                } else {
                    cpi_account_metas.push(AccountMeta::new_readonly(*acc.key, acc.is_signer));
                }
                cpi_account_infos.push(acc.clone());
            }
            cpi_account_infos.push(program_account.clone());

            let cpi_instruction = Instruction {
                program_id,
                accounts: cpi_account_metas,
                data: instruction_data,
            };

            invoke_signed(&cpi_instruction, &cpi_account_infos, signer_seeds)?;
            require!(
                ctx.accounts.vault_authority.lamports() >= pre_cpi_lamports,
                VaultOSError::ProgramNotAllowed
            );
        }
    }

    // 6. Record execution outcome
    let execution_record = &mut ctx.accounts.execution_record;
    execution_record.proposal = proposal.key();
    execution_record.executor = ctx.accounts.executor.key();
    execution_record.executed_at = clock.unix_timestamp;
    execution_record.outcome = 1; // Success
    execution_record.bump = ctx.bumps.execution_record;

    // 7. Update proposal status & vault executed_proposal_count
    proposal.status = ProposalStatus::Executed;
    proposal.executed_at = clock.unix_timestamp;
    vault.executed_proposal_count = vault
        .executed_proposal_count
        .checked_add(1)
        .ok_or(VaultOSError::ArithmeticOverflow)?;

    emit!(ProposalExecuted {
        vault: vault.key(),
        proposal: proposal.key(),
        executor: ctx.accounts.executor.key(),
        operation_type: op_type_id,
        destination: dest_pubkey,
        amount: transfer_amount,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
