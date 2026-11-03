use crate::errors::VaultOSError;
use crate::events::ProposalCreated;
use crate::policies::PolicyEngine;
use crate::state::{Member, Policy, Proposal, ProposalOperation, ProposalStatus, Vault};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(title: String, operation: ProposalOperation)]
pub struct CreateProposal<'info> {
    #[account(
        mut,
        constraint = !vault.is_frozen @ VaultOSError::VaultIsFrozen
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        seeds = [b"member", vault.key().as_ref(), proposer.key().as_ref()],
        bump = proposer_member.bump,
        constraint = proposer_member.can_propose() @ VaultOSError::InvalidRole
    )]
    pub proposer_member: Account<'info, Member>,

    #[account(
        init,
        payer = proposer,
        space = Proposal::LEN,
        seeds = [
            b"proposal",
            vault.key().as_ref(),
            vault.proposal_count.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(mut)]
    pub proposer: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(
    ctx: Context<'info, CreateProposal<'info>>,
    title: String,
    operation: ProposalOperation,
) -> Result<()> {
    require!(
        title.len() <= Proposal::MAX_TITLE_LEN,
        VaultOSError::StringTooLong
    );
    match &operation {
        ProposalOperation::CpiCall {
            program_id,
            instruction_data,
        } => {
            require!(
                instruction_data.len() <= Proposal::MAX_CPI_DATA_LEN,
                VaultOSError::StringTooLong
            );
            require!(
                !PolicyEngine::is_forbidden_cpi_program(program_id),
                VaultOSError::ProgramNotAllowed
            );
        }
        ProposalOperation::ChangeThreshold { new_threshold } => {
            require!(
                *new_threshold >= 1
                    && (*new_threshold as usize) <= Proposal::MAX_APPROVERS
                    && *new_threshold <= ctx.accounts.vault.member_count
                    && *new_threshold <= ctx.accounts.vault.approver_count.max(1),
                VaultOSError::InvalidThreshold
            );
        }
        ProposalOperation::SetTimelock { delay_seconds } => {
            require!(
                *delay_seconds >= 0 && *delay_seconds <= Vault::MAX_TIMELOCK,
                VaultOSError::InvalidTimelock
            );
        }
        _ => {}
    }

    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault;
    let proposal_index = vault.proposal_count;

    let base_threshold = vault.threshold;
    let base_timelock = vault.timelock_delay;
    let mut required_threshold = base_threshold;
    let mut timelock_delay = base_timelock;

    // Check if any policy accounts passed in remaining_accounts apply escalation
    let mut seen_policy_indices: Vec<u16> = Vec::new();
    for account_info in ctx.remaining_accounts.iter() {
        if account_info.owner == &crate::ID {
            if let Ok(data) = account_info.try_borrow_data() {
                let mut slice: &[u8] = &data;
                if let Ok(policy) = Policy::try_deserialize(&mut slice) {
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
                        !seen_policy_indices.contains(&policy.policy_index),
                        VaultOSError::InvalidPDASeeds
                    );
                    seen_policy_indices.push(policy.policy_index);

                    if policy.is_active {
                        let (esc_thresh, esc_tl) = PolicyEngine::compute_escalation(
                            &policy,
                            &operation,
                            base_threshold,
                            base_timelock,
                        )?;
                        if esc_thresh > required_threshold {
                            required_threshold = esc_thresh;
                        }
                        if esc_tl > timelock_delay {
                            timelock_delay = esc_tl;
                        }
                    }
                }
            }
        }
    }

    require!(
        seen_policy_indices.len() == vault.policy_count as usize,
        VaultOSError::Unauthorized
    );
    require!(
        required_threshold <= vault.approver_count.max(1),
        VaultOSError::ApproverThresholdShortfall
    );

    // Ensure proposal never expires before its timelock unlocks (+ 7 days execution grace window)
    let expires_at = clock
        .unix_timestamp
        .checked_add(timelock_delay)
        .ok_or(VaultOSError::ArithmeticOverflow)?
        .checked_add(Vault::EXECUTION_GRACE_PERIOD)
        .ok_or(VaultOSError::ArithmeticOverflow)?;

    let proposal = &mut ctx.accounts.proposal;
    proposal.vault = vault.key();
    proposal.proposal_index = proposal_index;
    proposal.proposer = ctx.accounts.proposer.key();
    proposal.title = title.clone();
    proposal.operation = operation.clone();
    proposal.status = ProposalStatus::Active;
    proposal.approval_count = 0;
    proposal.required_threshold = required_threshold;
    proposal.timelock_delay = timelock_delay;
    proposal.created_at = clock.unix_timestamp;
    proposal.approved_at = 0;
    proposal.executed_at = 0;
    proposal.expires_at = expires_at;
    proposal.bump = ctx.bumps.proposal;
    proposal.approvers = Vec::new();
    proposal.vault_revision = vault.config_revision;

    vault.proposal_count = vault
        .proposal_count
        .checked_add(1)
        .ok_or(VaultOSError::ArithmeticOverflow)?;

    let (op_type_id, dest, amt, mint_opt) = match &operation {
        ProposalOperation::SolTransfer {
            destination,
            lamports,
        } => (1u8, *destination, *lamports, None),
        ProposalOperation::TokenTransfer {
            destination,
            amount,
            mint,
        } => (2u8, *destination, *amount, Some(*mint)),
        ProposalOperation::AddMember { wallet, .. } => (3u8, *wallet, 0, None),
        ProposalOperation::RemoveMember { wallet } => (4u8, *wallet, 0, None),
        ProposalOperation::ChangeThreshold { new_threshold } => {
            (5u8, Pubkey::default(), *new_threshold as u64, None)
        }
        ProposalOperation::SetTimelock { delay_seconds } => {
            (6u8, Pubkey::default(), *delay_seconds as u64, None)
        }
        ProposalOperation::SetFrozen { .. } => (7u8, Pubkey::default(), 0, None),
        ProposalOperation::CpiCall { program_id, .. } => (8u8, *program_id, 0, None),
    };

    emit!(ProposalCreated {
        vault: vault.key(),
        proposal: proposal.key(),
        proposal_index,
        proposer: ctx.accounts.proposer.key(),
        title,
        operation_type: op_type_id,
        destination: dest,
        amount: amt,
        mint: mint_opt,
        required_threshold,
        timelock_delay,
        expires_at,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
