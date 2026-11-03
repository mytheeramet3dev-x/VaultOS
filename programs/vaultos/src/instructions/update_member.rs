use crate::errors::VaultOSError;
use crate::events::MemberRolesUpdated;
use crate::state::{Member, Vault};
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(member_wallet: Pubkey, new_roles: u8)]
pub struct UpdateMember<'info> {
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
        seeds = [b"member", vault.key().as_ref(), member_wallet.as_ref()],
        bump = target_member.bump,
        constraint = target_member.is_active @ VaultOSError::MemberNotFound
    )]
    pub target_member: Account<'info, Member>,

    pub admin: Signer<'info>,
}

pub fn handler<'info>(
    ctx: Context<'info, UpdateMember<'info>>,
    member_wallet: Pubkey,
    new_roles: u8,
) -> Result<()> {
    require!(
        new_roles > 0 && (new_roles & !crate::state::ALL_ROLES) == 0,
        VaultOSError::InvalidRole
    );

    let vault_key = ctx.accounts.vault.key();
    ctx.accounts.vault.verify_admin_consensus(
        &vault_key,
        &ctx.accounts.admin.key(),
        ctx.remaining_accounts,
        false,
    )?;

    let vault = &mut ctx.accounts.vault;
    let target = &mut ctx.accounts.target_member;

    let was_admin = target.is_admin();
    let will_be_admin = (new_roles & crate::state::ROLE_ADMIN) != 0;

    if was_admin && !will_be_admin {
        require!(vault.admin_count > 1, VaultOSError::InvalidRole);
        vault.admin_count = vault
            .admin_count
            .checked_sub(1)
            .ok_or(VaultOSError::ArithmeticOverflow)?;
    } else if !was_admin && will_be_admin {
        vault.admin_count = vault
            .admin_count
            .checked_add(1)
            .ok_or(VaultOSError::ArithmeticOverflow)?;
    }

    let was_approver = target.can_approve();
    let will_be_approver = (new_roles & crate::state::ROLE_APPROVER) != 0;
    if was_approver && !will_be_approver {
        let next_approvers = vault
            .approver_count
            .checked_sub(1)
            .ok_or(VaultOSError::ArithmeticOverflow)?;
        require!(
            next_approvers >= vault.threshold,
            VaultOSError::ApproverThresholdShortfall
        );
        vault.approver_count = next_approvers;
    } else if !was_approver && will_be_approver {
        vault.approver_count = vault
            .approver_count
            .checked_add(1)
            .ok_or(VaultOSError::ArithmeticOverflow)?;
    }

    let was_executor = target.can_execute();
    let will_be_executor = (new_roles & crate::state::ROLE_EXECUTOR) != 0;
    if was_executor && !will_be_executor {
        require!(vault.executor_count > 1, VaultOSError::NoActiveExecutor);
        vault.executor_count = vault
            .executor_count
            .checked_sub(1)
            .ok_or(VaultOSError::ArithmeticOverflow)?;
    } else if !was_executor && will_be_executor {
        vault.executor_count = vault
            .executor_count
            .checked_add(1)
            .ok_or(VaultOSError::ArithmeticOverflow)?;
    }

    target.roles = new_roles;
    vault.config_revision = vault
        .config_revision
        .checked_add(1)
        .ok_or(VaultOSError::ArithmeticOverflow)?;

    let clock = Clock::get()?;
    emit!(MemberRolesUpdated {
        vault: ctx.accounts.vault.key(),
        member: member_wallet,
        new_roles,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
