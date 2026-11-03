use crate::errors::VaultOSError;
use crate::events::VaultUnfrozen;
use crate::state::{Member, Vault};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct UnfreezeVault<'info> {
    #[account(
        mut,
        constraint = vault.is_frozen @ VaultOSError::VaultNotFrozen
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        seeds = [b"member", vault.key().as_ref(), admin.key().as_ref()],
        bump = admin_member.bump,
        constraint = admin_member.is_admin() @ VaultOSError::InvalidRole
    )]
    pub admin_member: Account<'info, Member>,

    pub admin: Signer<'info>,
}

pub fn handler<'info>(ctx: Context<'info, UnfreezeVault<'info>>) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();
    ctx.accounts.vault.verify_admin_consensus(
        &vault_key,
        &ctx.accounts.admin.key(),
        ctx.remaining_accounts,
        false,
    )?;

    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault;

    vault.is_frozen = false;

    emit!(VaultUnfrozen {
        vault: vault.key(),
        unfrozen_by: ctx.accounts.admin.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
