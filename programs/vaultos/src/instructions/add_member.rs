use crate::errors::VaultOSError;
use crate::events::MemberAdded;
use crate::state::{Member, Vault};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(member_wallet: Pubkey, roles: u8)]
pub struct AddMember<'info> {
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
        space = Member::LEN,
        seeds = [b"member", vault.key().as_ref(), member_wallet.as_ref()],
        bump
    )]
    pub new_member: Account<'info, Member>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler<'info>(
    ctx: Context<'info, AddMember<'info>>,
    member_wallet: Pubkey,
    roles: u8,
) -> Result<()> {
    require!(
        roles > 0 && (roles & !crate::state::ALL_ROLES) == 0,
        VaultOSError::InvalidRole
    );

    let vault_key = ctx.accounts.vault.key();
    ctx.accounts.vault.verify_admin_consensus(
        &vault_key,
        &ctx.accounts.admin.key(),
        ctx.remaining_accounts,
        true,
    )?;

    let clock = Clock::get()?;
    let vault = &mut ctx.accounts.vault;
    let new_member = &mut ctx.accounts.new_member;

    require!(
        vault.member_count < Vault::MAX_MEMBERS,
        VaultOSError::MaxMembersReached
    );

    new_member.vault = vault.key();
    new_member.wallet = member_wallet;
    new_member.roles = roles;
    new_member.is_active = true;
    new_member.added_at = clock.unix_timestamp;
    new_member.bump = ctx.bumps.new_member;
    new_member.config_revision_at_join = vault.config_revision;

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

    emit!(MemberAdded {
        vault: vault.key(),
        member: member_wallet,
        roles,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
