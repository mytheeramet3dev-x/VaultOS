use crate::errors::VaultOSError;
use crate::events::PolicyCreated;
use crate::policies::PolicyEngine;
use crate::state::{Member, Policy, PolicyType, Vault};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(policy_type: PolicyType)]
pub struct CreatePolicy<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(
        seeds = [b"member", vault.key().as_ref(), admin.key().as_ref()],
        bump = admin_member.bump,
        constraint = admin_member.is_admin() @ VaultOSError::InvalidRole
    )]
    pub admin_member: Account<'info, Member>,

    #[account(
        init,
        payer = admin,
        space = Policy::LEN,
        seeds = [
            b"policy",
            vault.key().as_ref(),
            vault.policy_count.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub policy: Account<'info, Policy>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(
    ctx: Context<'info, CreatePolicy<'info>>,
    mut policy_type: PolicyType,
) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    ctx.accounts.vault.verify_admin_consensus(
        &vault_key,
        &ctx.accounts.admin.key(),
        ctx.remaining_accounts,
        true,
    )?;

    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault;
    require!(
        vault.policy_count < Vault::MAX_POLICIES,
        VaultOSError::StringTooLong
    );
    let policy_index = vault.policy_count;

    let policy_type_id = match &mut policy_type {
        PolicyType::PerTransactionLimit { max_amount, .. } => {
            require!(*max_amount > 0, VaultOSError::ArithmeticOverflow);
            1u8
        }
        PolicyType::RollingSpendingLimit {
            max_amount_window,
            window_seconds,
            current_window_start,
            current_spent,
            ..
        } => {
            require!(
                *max_amount_window > 0 && *window_seconds > 0,
                VaultOSError::ArithmeticOverflow
            );
            *current_window_start = clock.unix_timestamp;
            *current_spent = 0;
            2u8
        }
        PolicyType::DestinationAllowlist { destinations } => {
            require!(
                destinations.len() <= Policy::MAX_VECTOR_LEN,
                VaultOSError::StringTooLong
            );
            3u8
        }
        PolicyType::AssetAllowlist { allowed_mints } => {
            require!(
                allowed_mints.len() <= Policy::MAX_VECTOR_LEN,
                VaultOSError::StringTooLong
            );
            4u8
        }
        PolicyType::ProgramAllowlist { allowed_programs } => {
            require!(
                allowed_programs.len() <= Policy::MAX_VECTOR_LEN,
                VaultOSError::StringTooLong
            );
            require!(
                !allowed_programs
                    .iter()
                    .any(PolicyEngine::is_forbidden_cpi_program),
                VaultOSError::ProgramNotAllowed
            );
            5u8
        }
        PolicyType::ApprovalEscalation {
            tier_amount,
            extra_approvals,
            extra_timelock,
        } => {
            require!(
                *tier_amount > 0 && *extra_timelock >= 0 && *extra_timelock <= Vault::MAX_TIMELOCK,
                VaultOSError::InvalidTimelock
            );
            let escalated_req = vault
                .threshold
                .checked_add(*extra_approvals)
                .ok_or(VaultOSError::ArithmeticOverflow)?;
            require!(
                (escalated_req as usize) <= crate::state::Proposal::MAX_APPROVERS,
                VaultOSError::MaxApproversReached
            );
            require!(
                escalated_req <= vault.approver_count,
                VaultOSError::ApproverThresholdShortfall
            );
            6u8
        }
    };

    let policy = &mut ctx.accounts.policy;
    policy.vault = vault.key();
    policy.policy_index = policy_index;
    policy.policy_type = policy_type;
    policy.is_active = true;
    policy.created_at = clock.unix_timestamp;
    policy.bump = ctx.bumps.policy;

    vault.policy_count = vault
        .policy_count
        .checked_add(1)
        .ok_or(VaultOSError::ArithmeticOverflow)?;
    vault.config_revision = vault
        .config_revision
        .checked_add(1)
        .ok_or(VaultOSError::ArithmeticOverflow)?;

    emit!(PolicyCreated {
        vault: vault.key(),
        policy: policy.key(),
        policy_index,
        policy_type: policy_type_id,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
