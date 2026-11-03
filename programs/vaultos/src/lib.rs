use anchor_lang::prelude::*;

pub mod errors;
pub mod events;
pub mod instructions;
pub mod policies;
pub mod state;

pub use instructions::*;
pub use state::{PolicyType, ProposalOperation};

declare_id!("8crGeaqgPRAak8pvSf3YZpDovdTwUrCmfag3YdRM1iYw");

#[program]
pub mod vaultos {
    use super::*;

    pub fn create_organization(
        ctx: Context<CreateOrganization>,
        org_id: String,
        name: String,
    ) -> Result<()> {
        instructions::create_organization::handler(ctx, org_id, name)
    }

    pub fn create_vault(
        ctx: Context<CreateVault>,
        name: String,
        threshold: u16,
        timelock_delay: i64,
    ) -> Result<()> {
        instructions::create_vault::handler(ctx, name, threshold, timelock_delay)
    }

    pub fn add_member<'info>(
        ctx: Context<'info, AddMember<'info>>,
        member_wallet: Pubkey,
        roles: u8,
    ) -> Result<()> {
        instructions::add_member::handler(ctx, member_wallet, roles)
    }

    pub fn update_member<'info>(
        ctx: Context<'info, UpdateMember<'info>>,
        member_wallet: Pubkey,
        new_roles: u8,
    ) -> Result<()> {
        instructions::update_member::handler(ctx, member_wallet, new_roles)
    }

    pub fn remove_member<'info>(
        ctx: Context<'info, RemoveMember<'info>>,
        member_wallet: Pubkey,
    ) -> Result<()> {
        instructions::remove_member::handler(ctx, member_wallet)
    }

    pub fn create_proposal<'info>(
        ctx: Context<'info, CreateProposal<'info>>,
        title: String,
        operation: ProposalOperation,
    ) -> Result<()> {
        instructions::create_proposal::handler(ctx, title, operation)
    }

    pub fn approve_proposal(ctx: Context<ApproveProposal>) -> Result<()> {
        instructions::approve_proposal::handler(ctx)
    }

    pub fn revoke_approval(ctx: Context<RevokeApproval>) -> Result<()> {
        instructions::revoke_approval::handler(ctx)
    }

    pub fn cancel_proposal<'info>(ctx: Context<'info, CancelProposal<'info>>) -> Result<()> {
        instructions::cancel_proposal::handler(ctx)
    }

    pub fn execute_proposal<'info>(ctx: Context<'info, ExecuteProposal<'info>>) -> Result<()> {
        instructions::execute_proposal::handler(ctx)
    }

    pub fn create_policy<'info>(
        ctx: Context<'info, CreatePolicy<'info>>,
        policy_type: PolicyType,
    ) -> Result<()> {
        instructions::create_policy::handler(ctx, policy_type)
    }

    pub fn update_policy<'info>(
        ctx: Context<'info, UpdatePolicy<'info>>,
        new_policy_type: PolicyType,
        is_active: bool,
    ) -> Result<()> {
        instructions::update_policy::handler(ctx, new_policy_type, is_active)
    }

    pub fn remove_policy<'info>(ctx: Context<'info, RemovePolicy<'info>>) -> Result<()> {
        instructions::remove_policy::handler(ctx)
    }

    pub fn freeze_vault(ctx: Context<FreezeVault>) -> Result<()> {
        instructions::freeze_vault::handler(ctx)
    }

    pub fn unfreeze_vault<'info>(ctx: Context<'info, UnfreezeVault<'info>>) -> Result<()> {
        instructions::unfreeze_vault::handler(ctx)
    }

    pub fn deposit_sol(ctx: Context<DepositSol>, amount_lamports: u64) -> Result<()> {
        instructions::deposit_sol::handler(ctx, amount_lamports)
    }

    pub fn deposit_token(ctx: Context<DepositToken>, amount: u64) -> Result<()> {
        instructions::deposit_token::handler(ctx, amount)
    }
}

#[cfg(test)]
mod integration_tests {
    use super::*;
    use crate::policies::{
        PolicyEngine, BPF_LOADER_UPGRADEABLE_PROGRAM_ID, SPL_TOKEN_2022_PROGRAM_ID,
        SPL_TOKEN_PROGRAM_ID,
    };
    use crate::state::{
        Member, Policy, PolicyType, Proposal, ProposalOperation, ProposalStatus, Vault, ALL_ROLES,
        ROLE_ADMIN, ROLE_APPROVER, ROLE_EXECUTOR, ROLE_GUARDIAN, ROLE_PROPOSER,
    };

    fn make_vault(threshold: u16, member_count: u16, admin_count: u16) -> Vault {
        Vault {
            organization: Pubkey::new_unique(),
            vault_index: 0,
            name: "Core Treasury".to_string(),
            authority_bump: 254,
            bump: 255,
            threshold,
            member_count,
            admin_count,
            proposal_count: 0,
            policy_count: 0,
            timelock_delay: 3600,
            is_frozen: false,
            created_at: 1_700_000_000,
            executed_proposal_count: 0,
            config_revision: 1,
            account_version: Vault::CURRENT_VERSION,
            approver_count: member_count,
            executor_count: 1,
        }
    }

    #[test]
    fn test_admin_consensus_blocks_unilateral_admin_when_multisig_active() {
        let vault_key = Pubkey::new_unique();
        let admin_1 = Pubkey::new_unique();
        let vault = make_vault(2, 3, 2);

        // Once member_count (3) >= threshold (2) and threshold > 1,
        // a single admin without co-signers in remaining_accounts MUST fail.
        let empty_remaining: Vec<AccountInfo> = vec![];
        let res = vault.verify_admin_consensus(&vault_key, &admin_1, &empty_remaining, true);
        assert!(
            res.is_err(),
            "Unilateral admin action must be rejected when multisig is active"
        );
    }

    #[test]
    fn test_admin_consensus_passes_during_bootstrap_or_with_valid_cosigner_pda() {
        let vault_key = Pubkey::new_unique();
        let admin_1 = Pubkey::new_unique();
        let admin_2 = Pubkey::new_unique();

        // 1. Bootstrap phase: member_count (2) < threshold (3)
        //    - Onboarding (allow_bootstrap = true) succeeds
        //    - Destructive operations (allow_bootstrap = false, e.g. remove_member) MUST fail!
        let bootstrap_vault = make_vault(3, 2, 1);
        let empty_remaining: Vec<AccountInfo> = vec![];
        assert!(
            bootstrap_vault
                .verify_admin_consensus(&vault_key, &admin_1, &empty_remaining, true)
                .is_ok(),
            "Bootstrap phase should allow initial member setup before reaching threshold"
        );
        assert!(
            bootstrap_vault
                .verify_admin_consensus(&vault_key, &admin_1, &empty_remaining, false)
                .is_err(),
            "Destructive operations must NOT bypass consensus during bootstrap phase"
        );

        // 2. Active multisig phase: 2-of-3 vault with valid co-signer + serialized Member PDA
        let active_vault = make_vault(2, 3, 2);
        let (admin_2_member_pda, bump) = Pubkey::find_program_address(
            &[b"member", vault_key.as_ref(), admin_2.as_ref()],
            &crate::ID,
        );

        let member_state = Member {
            vault: vault_key,
            wallet: admin_2,
            roles: ROLE_ADMIN | ROLE_APPROVER,
            added_at: 1_700_000_000,
            is_active: true,
            bump,
            config_revision_at_join: 1,
        };
        let mut member_bytes = Vec::with_capacity(Member::LEN);
        member_state.try_serialize(&mut member_bytes).unwrap();

        let mut signer_lamports = 1_000_000u64;
        let mut signer_data = vec![];
        let mut pda_lamports = 1_000_000u64;
        let system_id = anchor_lang::solana_program::system_program::ID;
        let prog_id = crate::ID;

        let cosigner_info = AccountInfo::new(
            &admin_2,
            true, // is_signer = true
            false,
            &mut signer_lamports,
            &mut signer_data,
            &system_id,
            false,
        );
        let cosigner_member_info = AccountInfo::new(
            &admin_2_member_pda,
            false,
            false,
            &mut pda_lamports,
            &mut member_bytes,
            &prog_id,
            false,
        );

        let remaining = vec![cosigner_info, cosigner_member_info];
        assert!(
            active_vault
                .verify_admin_consensus(&vault_key, &admin_1, &remaining, false)
                .is_ok(),
            "M-of-N admin consensus with verified co-signer and Member PDA should succeed"
        );
    }

    #[test]
    fn test_admin_consensus_rejects_unsigned_or_duplicate_cosigner() {
        let vault_key = Pubkey::new_unique();
        let admin_1 = Pubkey::new_unique();
        let admin_2 = Pubkey::new_unique();
        let active_vault = make_vault(2, 3, 2);

        let (admin_2_member_pda, bump) = Pubkey::find_program_address(
            &[b"member", vault_key.as_ref(), admin_2.as_ref()],
            &crate::ID,
        );
        let member_state = Member {
            vault: vault_key,
            wallet: admin_2,
            roles: ROLE_ADMIN | ROLE_APPROVER,
            added_at: 1_700_000_000,
            is_active: true,
            bump,
            config_revision_at_join: 1,
        };
        let mut member_bytes = Vec::with_capacity(Member::LEN);
        member_state.try_serialize(&mut member_bytes).unwrap();

        let mut signer_lamports = 1_000_000u64;
        let mut signer_data = vec![];
        let mut pda_lamports = 1_000_000u64;
        let system_id = anchor_lang::solana_program::system_program::ID;
        let prog_id = crate::ID;

        // Unsigned co-signer must fail
        let unsigned_cosigner = AccountInfo::new(
            &admin_2,
            false, // NOT a signer!
            false,
            &mut signer_lamports,
            &mut signer_data,
            &system_id,
            false,
        );
        let cosigner_member_info = AccountInfo::new(
            &admin_2_member_pda,
            false,
            false,
            &mut pda_lamports,
            &mut member_bytes,
            &prog_id,
            false,
        );

        let remaining = vec![unsigned_cosigner, cosigner_member_info];
        assert!(
            active_vault
                .verify_admin_consensus(&vault_key, &admin_1, &remaining, false)
                .is_err(),
            "Unsigned co-signer must be rejected"
        );
    }

    #[test]
    fn test_borsh_account_roundtrip_and_create_program_address_determinism() {
        let vault_key = Pubkey::new_unique();
        let wallet = Pubkey::new_unique();
        let (expected_pda, bump) = Pubkey::find_program_address(
            &[b"member", vault_key.as_ref(), wallet.as_ref()],
            &crate::ID,
        );
        let fast_pda = Pubkey::create_program_address(
            &[b"member", vault_key.as_ref(), wallet.as_ref(), &[bump]],
            &crate::ID,
        )
        .unwrap();
        assert_eq!(
            expected_pda, fast_pda,
            "create_program_address must match find_program_address"
        );

        // Verify Proposal serialization & deserialization with approvers list
        let prop = Proposal {
            vault: vault_key,
            proposal_index: 42,
            proposer: wallet,
            title: "Upgrade Treasury Policy".to_string(),
            operation: ProposalOperation::AddMember {
                wallet: Pubkey::new_unique(),
                roles: ROLE_PROPOSER | ROLE_APPROVER | ROLE_EXECUTOR,
            },
            status: ProposalStatus::Executable,
            approval_count: 2,
            required_threshold: 2,
            approvers: vec![wallet, Pubkey::new_unique()],
            created_at: 1_700_000_000,
            approved_at: 1_700_000_100,
            timelock_delay: 3600,
            expires_at: 1_700_604_800,
            executed_at: 0,
            bump: 253,
            vault_revision: 1,
        };

        let mut buf = Vec::with_capacity(Proposal::LEN);
        prop.try_serialize(&mut buf).unwrap();
        assert!(
            buf.len() <= Proposal::LEN,
            "Serialized Proposal must fit within Proposal::LEN"
        );

        let mut slice: &[u8] = &buf;
        let decoded = Proposal::try_deserialize(&mut slice).unwrap();
        assert_eq!(decoded.proposal_index, 42);
        assert_eq!(decoded.approvers.len(), 2);
        assert_eq!(decoded.status, ProposalStatus::Executable);
        assert_eq!(decoded.vault_revision, 1);
    }

    #[test]
    fn test_self_cpi_and_policy_guardrails() {
        let external_prog = Pubkey::new_unique();
        let mut allowlist_policy = Policy {
            vault: Pubkey::new_unique(),
            policy_index: 0,
            policy_type: PolicyType::ProgramAllowlist {
                allowed_programs: vec![external_prog],
            },
            is_active: true,
            created_at: 1000,
            bump: 255,
        };

        // H3: Core asset / system programs MUST be blocked from CpiCall & ProgramAllowlist
        assert!(PolicyEngine::is_forbidden_cpi_program(&crate::ID));
        assert!(PolicyEngine::is_forbidden_cpi_program(&Pubkey::default()));
        assert!(PolicyEngine::is_forbidden_cpi_program(
            &anchor_lang::solana_program::system_program::ID
        ));
        assert!(PolicyEngine::is_forbidden_cpi_program(
            &SPL_TOKEN_PROGRAM_ID
        ));
        assert!(PolicyEngine::is_forbidden_cpi_program(
            &SPL_TOKEN_2022_PROGRAM_ID
        ));
        assert!(PolicyEngine::is_forbidden_cpi_program(
            &BPF_LOADER_UPGRADEABLE_PROGRAM_ID
        ));
        assert!(!PolicyEngine::is_forbidden_cpi_program(&external_prog));

        let cpi_op = ProposalOperation::CpiCall {
            program_id: external_prog,
            instruction_data: vec![1, 2, 3, 4],
        };
        assert!(PolicyEngine::evaluate_policy(&mut allowlist_policy, &cpi_op, 1000).is_ok());

        // Verify role bitmask invariants including ROLE_GUARDIAN (L1)
        let member = Member {
            vault: Pubkey::new_unique(),
            wallet: Pubkey::new_unique(),
            roles: ROLE_EXECUTOR | ROLE_GUARDIAN,
            added_at: 1000,
            is_active: true,
            bump: 254,
            config_revision_at_join: 1,
        };
        assert!(member.can_execute());
        assert!(member.is_guardian());
        assert!(!member.is_admin());
        assert!(!member.can_approve());
        assert_eq!(
            ALL_ROLES,
            ROLE_ADMIN | ROLE_PROPOSER | ROLE_APPROVER | ROLE_EXECUTOR | ROLE_GUARDIAN
        );
    }

    #[test]
    fn test_timelock_expiry_scaling_and_escalation_caps() {
        // H1 & H2: Verify Vault::MAX_TIMELOCK (30d), Proposal::MAX_APPROVERS (16), Vault::MAX_MEMBERS (64)
        assert_eq!(Vault::MAX_TIMELOCK, 30 * 24 * 60 * 60);
        assert_eq!(Vault::EXECUTION_GRACE_PERIOD, 7 * 24 * 60 * 60);
        assert_eq!(Proposal::MAX_APPROVERS, 16);
        assert_eq!(Vault::MAX_MEMBERS, 64);

        // Escalation policy with out-of-bounds values must be clamped to MAX_APPROVERS and MAX_TIMELOCK
        let escalation_policy = Policy {
            vault: Pubkey::new_unique(),
            policy_index: 1,
            policy_type: PolicyType::ApprovalEscalation {
                tier_amount: 1_000_000_000,
                extra_approvals: 99,                // Exceeds MAX_APPROVERS (16)
                extra_timelock: 365 * 24 * 60 * 60, // Exceeds MAX_TIMELOCK (30d)
            },
            is_active: true,
            created_at: 1000,
            bump: 254,
        };

        let large_transfer = ProposalOperation::SolTransfer {
            destination: Pubkey::new_unique(),
            lamports: 5_000_000_000,
        };

        let (eff_thresh, eff_timelock) =
            PolicyEngine::compute_escalation(&escalation_policy, &large_transfer, 2, 3600).unwrap();
        assert_eq!(
            eff_thresh,
            Proposal::MAX_APPROVERS as u16,
            "Escalated threshold must never exceed Proposal::MAX_APPROVERS"
        );
        assert_eq!(
            eff_timelock,
            Vault::MAX_TIMELOCK,
            "Escalated timelock must never exceed Vault::MAX_TIMELOCK"
        );
    }

    #[test]
    fn test_program_entrypoint_real_instruction_dispatch() {
        use crate::errors::VaultOSError;
        use anchor_lang::InstructionData;

        let prog_id = crate::ID;
        let system_id = anchor_lang::solana_program::system_program::ID;
        let vault_key = Pubkey::new_unique();
        let guardian_wallet = Pubkey::new_unique();
        let proposer_wallet = Pubkey::new_unique();

        // 1. Test L1: Guardian member passes `FreezeVault` account validation via real program `entry`,
        //    whereas a non-guardian proposer is rejected with `VaultOSError::InvalidRole`!
        let (guardian_pda, guardian_bump) = Pubkey::find_program_address(
            &[b"member", vault_key.as_ref(), guardian_wallet.as_ref()],
            &prog_id,
        );
        let (proposer_pda, proposer_bump) = Pubkey::find_program_address(
            &[b"member", vault_key.as_ref(), proposer_wallet.as_ref()],
            &prog_id,
        );

        let vault_state = make_vault(2, 3, 2);
        let mut vault_bytes = vec![0u8; Vault::LEN];
        vault_state
            .try_serialize(&mut &mut vault_bytes[..])
            .unwrap();

        let guardian_member = Member {
            vault: vault_key,
            wallet: guardian_wallet,
            roles: ROLE_GUARDIAN,
            is_active: true,
            added_at: 1000,
            bump: guardian_bump,
            config_revision_at_join: 1,
        };
        let mut guardian_bytes = vec![0u8; Member::LEN];
        guardian_member
            .try_serialize(&mut &mut guardian_bytes[..])
            .unwrap();

        let proposer_member = Member {
            vault: vault_key,
            wallet: proposer_wallet,
            roles: ROLE_PROPOSER,
            is_active: true,
            added_at: 1000,
            bump: proposer_bump,
            config_revision_at_join: 1,
        };
        let mut proposer_bytes = vec![0u8; Member::LEN];
        proposer_member
            .try_serialize(&mut &mut proposer_bytes[..])
            .unwrap();

        let freeze_ix_data = crate::instruction::FreezeVault {}.data();

        // Non-guardian proposer attempt must fail with `VaultOSError::InvalidRole`
        {
            let mut v_lamports = 1_000_000u64;
            let mut m_lamports = 1_000_000u64;
            let mut s_lamports = 1_000_000u64;
            let mut s_data = vec![];
            let mut v_data = vault_bytes.clone();
            let mut p_data = proposer_bytes.clone();

            let accounts = vec![
                AccountInfo::new(
                    &vault_key,
                    false,
                    true,
                    &mut v_lamports,
                    &mut v_data,
                    &prog_id,
                    false,
                ),
                AccountInfo::new(
                    &proposer_pda,
                    false,
                    false,
                    &mut m_lamports,
                    &mut p_data,
                    &prog_id,
                    false,
                ),
                AccountInfo::new(
                    &proposer_wallet,
                    true,
                    false,
                    &mut s_lamports,
                    &mut s_data,
                    &system_id,
                    false,
                ),
            ];
            let res = crate::entry(&prog_id, &accounts, &freeze_ix_data);
            let expected_err: anchor_lang::solana_program::program_error::ProgramError =
                anchor_lang::error::Error::from(VaultOSError::InvalidRole).into();
            assert_eq!(
                res.unwrap_err(),
                expected_err,
                "Non-guardian proposer must be rejected with VaultOSError::InvalidRole"
            );
        }

        // Guardian attempt passes all account constraints (reaching handler body)
        {
            let mut v_lamports = 1_000_000u64;
            let mut m_lamports = 1_000_000u64;
            let mut s_lamports = 1_000_000u64;
            let mut s_data = vec![];
            let mut v_data = vault_bytes.clone();
            let mut g_data = guardian_bytes.clone();

            let accounts = vec![
                AccountInfo::new(
                    &vault_key,
                    false,
                    true,
                    &mut v_lamports,
                    &mut v_data,
                    &prog_id,
                    false,
                ),
                AccountInfo::new(
                    &guardian_pda,
                    false,
                    false,
                    &mut m_lamports,
                    &mut g_data,
                    &prog_id,
                    false,
                ),
                AccountInfo::new(
                    &guardian_wallet,
                    true,
                    false,
                    &mut s_lamports,
                    &mut s_data,
                    &system_id,
                    false,
                ),
            ];
            let res = crate::entry(&prog_id, &accounts, &freeze_ix_data);
            let invalid_role_err: anchor_lang::solana_program::program_error::ProgramError =
                anchor_lang::error::Error::from(VaultOSError::InvalidRole).into();
            assert_ne!(
                res.unwrap_err(),
                invalid_role_err,
                "Guardian member must pass FreezeVault role constraint"
            );
        }

        // 2. Test M4 via `crate::entry`: `update_member` must reject demoting an approver
        //    when `approver_count == threshold` (ApproverThresholdShortfall) or demoting the
        //    last executor (`NoActiveExecutor`).
        let admin_wallet = Pubkey::new_unique();
        let target_wallet = Pubkey::new_unique();
        let (admin_pda, admin_bump) = Pubkey::find_program_address(
            &[b"member", vault_key.as_ref(), admin_wallet.as_ref()],
            &prog_id,
        );
        let (target_pda, target_bump) = Pubkey::find_program_address(
            &[b"member", vault_key.as_ref(), target_wallet.as_ref()],
            &prog_id,
        );

        let mut vault_1of2 = make_vault(1, 2, 1);
        vault_1of2.approver_count = 1; // Exactly equal to threshold (1)
        vault_1of2.executor_count = 1; // Only 1 active executor
        let mut v1_bytes = vec![0u8; Vault::LEN];
        vault_1of2.try_serialize(&mut &mut v1_bytes[..]).unwrap();

        let admin_member = Member {
            vault: vault_key,
            wallet: admin_wallet,
            roles: ROLE_ADMIN,
            is_active: true,
            added_at: 1000,
            bump: admin_bump,
            config_revision_at_join: 1,
        };
        let mut admin_bytes = vec![0u8; Member::LEN];
        admin_member
            .try_serialize(&mut &mut admin_bytes[..])
            .unwrap();

        let target_member = Member {
            vault: vault_key,
            wallet: target_wallet,
            roles: ROLE_APPROVER | ROLE_EXECUTOR,
            is_active: true,
            added_at: 1000,
            bump: target_bump,
            config_revision_at_join: 1,
        };
        let mut target_bytes = vec![0u8; Member::LEN];
        target_member
            .try_serialize(&mut &mut target_bytes[..])
            .unwrap();

        // Attempt to strip ROLE_APPROVER when approver_count (1) == threshold (1) -> MUST fail with ApproverThresholdShortfall
        let strip_approver_ix = crate::instruction::UpdateMember {
            member_wallet: target_wallet,
            new_roles: ROLE_EXECUTOR,
        }
        .data();
        {
            let mut v_lamports = 1_000_000u64;
            let mut a_lamports = 1_000_000u64;
            let mut t_lamports = 1_000_000u64;
            let mut s_lamports = 1_000_000u64;
            let mut s_data = vec![];
            let mut v_data = v1_bytes.clone();
            let mut a_data = admin_bytes.clone();
            let mut t_data = target_bytes.clone();

            let accounts = vec![
                AccountInfo::new(
                    &vault_key,
                    false,
                    true,
                    &mut v_lamports,
                    &mut v_data,
                    &prog_id,
                    false,
                ),
                AccountInfo::new(
                    &admin_pda,
                    false,
                    false,
                    &mut a_lamports,
                    &mut a_data,
                    &prog_id,
                    false,
                ),
                AccountInfo::new(
                    &target_pda,
                    false,
                    true,
                    &mut t_lamports,
                    &mut t_data,
                    &prog_id,
                    false,
                ),
                AccountInfo::new(
                    &admin_wallet,
                    true,
                    false,
                    &mut s_lamports,
                    &mut s_data,
                    &system_id,
                    false,
                ),
            ];
            let res = crate::entry(&prog_id, &accounts, &strip_approver_ix);
            let expected_err: anchor_lang::solana_program::program_error::ProgramError =
                anchor_lang::error::Error::from(VaultOSError::ApproverThresholdShortfall).into();
            assert_eq!(
                res.unwrap_err(),
                expected_err,
                "Stripping ROLE_APPROVER below threshold must be rejected with ApproverThresholdShortfall"
            );
        }

        // Attempt to strip ROLE_EXECUTOR when executor_count == 1 -> MUST fail with NoActiveExecutor
        let strip_executor_ix = crate::instruction::UpdateMember {
            member_wallet: target_wallet,
            new_roles: ROLE_APPROVER,
        }
        .data();
        {
            let mut v_lamports = 1_000_000u64;
            let mut a_lamports = 1_000_000u64;
            let mut t_lamports = 1_000_000u64;
            let mut s_lamports = 1_000_000u64;
            let mut s_data = vec![];
            let mut v_data = v1_bytes.clone();
            let mut a_data = admin_bytes.clone();
            let mut t_data = target_bytes.clone();

            let accounts = vec![
                AccountInfo::new(
                    &vault_key,
                    false,
                    true,
                    &mut v_lamports,
                    &mut v_data,
                    &prog_id,
                    false,
                ),
                AccountInfo::new(
                    &admin_pda,
                    false,
                    false,
                    &mut a_lamports,
                    &mut a_data,
                    &prog_id,
                    false,
                ),
                AccountInfo::new(
                    &target_pda,
                    false,
                    true,
                    &mut t_lamports,
                    &mut t_data,
                    &prog_id,
                    false,
                ),
                AccountInfo::new(
                    &admin_wallet,
                    true,
                    false,
                    &mut s_lamports,
                    &mut s_data,
                    &system_id,
                    false,
                ),
            ];
            let res = crate::entry(&prog_id, &accounts, &strip_executor_ix);
            let expected_err: anchor_lang::solana_program::program_error::ProgramError =
                anchor_lang::error::Error::from(VaultOSError::NoActiveExecutor).into();
            assert_eq!(
                res.unwrap_err(),
                expected_err,
                "Stripping ROLE_EXECUTOR from the last executor must be rejected with NoActiveExecutor"
            );
        }

        // 3. Verify `Vault::MAX_POLICIES` cap (16) and non-cumulative multi-tier escalation
        assert_eq!(Vault::MAX_POLICIES, 16);
        let tier_1 = Policy {
            vault: vault_key,
            policy_index: 0,
            policy_type: PolicyType::ApprovalEscalation {
                tier_amount: 100_000_000_000,
                extra_approvals: 1,
                extra_timelock: 3600,
            },
            is_active: true,
            created_at: 1000,
            bump: 254,
        };
        let tier_2 = Policy {
            vault: vault_key,
            policy_index: 1,
            policy_type: PolicyType::ApprovalEscalation {
                tier_amount: 500_000_000_000,
                extra_approvals: 2,
                extra_timelock: 86400,
            },
            is_active: true,
            created_at: 1000,
            bump: 253,
        };
        let high_op = ProposalOperation::SolTransfer {
            destination: Pubkey::new_unique(),
            lamports: 600_000_000_000,
        };
        let base_t = 2u16;
        let base_tl = 0i64;
        let (t1, tl1) =
            PolicyEngine::compute_escalation(&tier_1, &high_op, base_t, base_tl).unwrap();
        let (t2, tl2) =
            PolicyEngine::compute_escalation(&tier_2, &high_op, base_t, base_tl).unwrap();
        assert_eq!(
            t1.max(t2),
            4,
            "Multi-tier escalation must take max tier (2 + 2 = 4), not sum tiers (2 + 1 + 2 = 5)"
        );
        assert_eq!(tl1.max(tl2), 86400);
    }
}
