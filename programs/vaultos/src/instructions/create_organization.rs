use crate::errors::VaultOSError;
use crate::events::OrganizationCreated;
use crate::state::Organization;
use anchor_lang::prelude::*;

#[derive(Accounts)]
#[instruction(org_id: String, name: String)]
pub struct CreateOrganization<'info> {
    #[account(
        init,
        payer = admin,
        space = Organization::LEN,
        seeds = [b"organization", org_id.as_bytes()],
        bump
    )]
    pub organization: Account<'info, Organization>,

    #[account(mut)]
    pub admin: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<CreateOrganization>, org_id: String, name: String) -> Result<()> {
    require!(
        org_id.len() <= Organization::MAX_ORG_ID_LEN,
        VaultOSError::StringTooLong
    );
    require!(
        name.len() <= Organization::MAX_NAME_LEN,
        VaultOSError::StringTooLong
    );

    let clock = Clock::get()?;
    let organization = &mut ctx.accounts.organization;

    organization.admin = ctx.accounts.admin.key();
    organization.org_id = org_id.clone();
    organization.name = name.clone();
    organization.vault_count = 0;
    organization.created_at = clock.unix_timestamp;
    organization.bump = ctx.bumps.organization;

    emit!(OrganizationCreated {
        organization: organization.key(),
        org_id,
        name,
        admin: ctx.accounts.admin.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
