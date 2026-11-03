use crate::errors::VaultOSError;
use crate::events::PolicyRemoved;
use crate::state::{Member, Policy, Vault};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct RemovePolicy<'info> {
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

pub fn handler<'info>(ctx: Context<'info, RemovePolicy<'info>>) -> Result<()> {
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

    policy.is_active = false;
    vault.config_revision = vault
        .config_revision
        .checked_add(1)
        .ok_or(VaultOSError::ArithmeticOverflow)?;

    emit!(PolicyRemoved {
        vault: ctx.accounts.vault.key(),
        policy: policy.key(),
        policy_index: policy.policy_index,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
