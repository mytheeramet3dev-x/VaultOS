use crate::errors::VaultOSError;
use crate::events::VaultCreated;
use crate::state::{
    Member, Organization, Proposal, Vault, ROLE_ADMIN, ROLE_APPROVER, ROLE_EXECUTOR, ROLE_GUARDIAN,
    ROLE_PROPOSER,
};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(name: String, threshold: u16, timelock_delay: i64)]
pub struct CreateVault<'info> {
    #[account(
        mut,
        has_one = admin @ VaultOSError::Unauthorized
    )]
    pub organization: Account<'info, Organization>,

    #[account(
        init,
        payer = admin,
        space = Vault::LEN,
        seeds = [
            b"vault",
            organization.key().as_ref(),
            organization.vault_count.to_le_bytes().as_ref()
        ],
        bump
    )]
    pub vault: Account<'info, Vault>,

    /// CHECK: The Vault Authority PDA seed is validated in the instruction
    #[account(
        seeds = [b"vault_authority", vault.key().as_ref()],
        bump
    )]
    pub vault_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = admin,
        space = Member::LEN,
        seeds = [b"member", vault.key().as_ref(), admin.key().as_ref()],
        bump
    )]
    pub admin_member: Account<'info, Member>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<CreateVault>,
    name: String,
    threshold: u16,
    timelock_delay: i64,
) -> Result<()> {
    require!(
        name.len() <= Vault::MAX_NAME_LEN,
        VaultOSError::StringTooLong
    );
    require!(
        threshold >= 1 && (threshold as usize) <= Proposal::MAX_APPROVERS,
        VaultOSError::InvalidThreshold
    );
    require!(
        timelock_delay >= 0 && timelock_delay <= Vault::MAX_TIMELOCK,
        VaultOSError::InvalidTimelock
    );

    let clock = Clock::get()?;
    let vault_index = ctx.accounts.organization.vault_count;

    // 1. Initialize Vault account
    let vault = &mut ctx.accounts.vault;
    vault.organization = ctx.accounts.organization.key();
    vault.vault_index = vault_index;
    vault.name = name.clone();
    vault.authority_bump = ctx.bumps.vault_authority;
    vault.threshold = threshold;
    vault.member_count = 1; // Admin member is registered
    vault.admin_count = 1;
    vault.proposal_count = 0;
    vault.policy_count = 0;
    vault.timelock_delay = timelock_delay;
    vault.is_frozen = false;
    vault.created_at = clock.unix_timestamp;
    vault.bump = ctx.bumps.vault;
    vault.executed_proposal_count = 0;
    vault.config_revision = 1;
    vault.account_version = Vault::CURRENT_VERSION;
    vault.approver_count = 1;
    vault.executor_count = 1;

    // 2. Initialize Admin Member
    let admin_member = &mut ctx.accounts.admin_member;
    admin_member.vault = vault.key();
    admin_member.wallet = ctx.accounts.admin.key();
    admin_member.roles = ROLE_ADMIN | ROLE_PROPOSER | ROLE_APPROVER | ROLE_EXECUTOR | ROLE_GUARDIAN;
    admin_member.is_active = true;
    admin_member.added_at = clock.unix_timestamp;
    admin_member.bump = ctx.bumps.admin_member;
    admin_member.config_revision_at_join = vault.config_revision;

    // 3. Increment Organization vault count
    ctx.accounts.organization.vault_count = ctx
        .accounts
        .organization
        .vault_count
        .checked_add(1)
        .ok_or(VaultOSError::ArithmeticOverflow)?;

    emit!(VaultCreated {
        organization: ctx.accounts.organization.key(),
        vault: vault.key(),
        vault_authority: ctx.accounts.vault_authority.key(),
        vault_index,
        name,
        threshold,
        timelock_delay,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
