use crate::errors::VaultOSError;
use crate::events::MemberRemoved;
use crate::state::{Member, Vault};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(member_wallet: Pubkey)]
pub struct RemoveMember<'info> {
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
        close = admin,
        seeds = [b"member", vault.key().as_ref(), member_wallet.as_ref()],
        bump = target_member.bump,
        constraint = target_member.is_active @ VaultOSError::MemberNotFound
    )]
    pub target_member: Account<'info, Member>,

    #[account(mut)]
    pub admin: Signer<'info>,
}

pub fn handler<'info>(
    ctx: Context<'info, RemoveMember<'info>>,
    member_wallet: Pubkey,
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
    let target = &mut ctx.accounts.target_member;

    require!(vault.member_count > 1, VaultOSError::InvalidThreshold);

    if target.is_admin() {
        require!(vault.admin_count > 1, VaultOSError::InvalidRole);
        vault.admin_count = vault
            .admin_count
            .checked_sub(1)
            .ok_or(VaultOSError::ArithmeticOverflow)?;
    }

    if target.can_approve() {
        let next_approvers = vault
            .approver_count
            .checked_sub(1)
            .ok_or(VaultOSError::ArithmeticOverflow)?;
        require!(
            next_approvers >= vault.threshold,
            VaultOSError::ApproverThresholdShortfall
        );
        vault.approver_count = next_approvers;
    }

    if target.can_execute() {
        require!(vault.executor_count > 1, VaultOSError::NoActiveExecutor);
        vault.executor_count = vault
            .executor_count
            .checked_sub(1)
            .ok_or(VaultOSError::ArithmeticOverflow)?;
    }

    let new_member_count = vault
        .member_count
        .checked_sub(1)
        .ok_or(VaultOSError::ArithmeticOverflow)?;

    require!(
        new_member_count >= vault.threshold,
        VaultOSError::InvalidThreshold
    );

    target.is_active = false;
    target.roles = 0;

    vault.member_count = new_member_count;
    vault.config_revision = vault
        .config_revision
        .checked_add(1)
        .ok_or(VaultOSError::ArithmeticOverflow)?;

    emit!(MemberRemoved {
        vault: vault.key(),
        member: member_wallet,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
