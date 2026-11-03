use crate::errors::VaultOSError;
use crate::events::VaultFrozen;
use crate::state::{Member, Vault};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct FreezeVault<'info> {
    #[account(
        mut,
        constraint = !vault.is_frozen @ VaultOSError::VaultIsFrozen
    )]
    pub vault: Account<'info, Vault>,

    #[account(
        seeds = [b"member", vault.key().as_ref(), admin.key().as_ref()],
        bump = admin_member.bump,
        constraint = admin_member.is_guardian() @ VaultOSError::InvalidRole
    )]
    pub admin_member: Account<'info, Member>,

    pub admin: Signer<'info>,
}

pub fn handler(ctx: Context<FreezeVault>) -> Result<()> {
    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault;

    vault.is_frozen = true;

    emit!(VaultFrozen {
        vault: vault.key(),
        frozen_by: ctx.accounts.admin.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
