use crate::errors::VaultOSError;
use crate::events::PolicyUpdated;
use crate::policies::PolicyEngine;
use crate::state::{Member, Policy, PolicyType, Vault};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(new_policy_type: PolicyType, is_active: bool)]
pub struct UpdatePolicy<'info> {
    #[account(mut)]
    pub vault: Account<'info, Vault>,

    #[account(
        seeds = [b"member", vault.key().as_ref(), admin.key().as_ref()],
        bump = admin_member.bump,
        constraint = admin_member.is_admin() @ VaultOSError::InvalidRole
    )]
    pub admin_member: Account<'info, Member>,

    #[account(
        mut,
        has_one = vault @ VaultOSError::Unauthorized,
    )]
    pub policy: Account<'info, Policy>,

    pub admin: Signer<'info>,
}

pub fn handler<'info>(
    ctx: Context<'info, UpdatePolicy<'info>>,
    mut new_policy_type: PolicyType,
    is_active: bool,
) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    ctx.accounts.vault.verify_admin_consensus(
        &vault_key,
        &ctx.accounts.admin.key(),
        ctx.remaining_accounts,
        false,
    )?;

    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault;
    let policy = &mut ctx.accounts.policy;

    let policy_type_id = match &mut new_policy_type {
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

    policy.policy_type = new_policy_type;
    policy.is_active = is_active;
    vault.config_revision = vault
        .config_revision
        .checked_add(1)
        .ok_or(VaultOSError::ArithmeticOverflow)?;

    emit!(PolicyUpdated {
        vault: ctx.accounts.vault.key(),
        policy: policy.key(),
        policy_index: policy.policy_index,
        policy_type: policy_type_id,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
