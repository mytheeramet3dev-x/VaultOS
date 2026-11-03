use crate::errors::VaultOSError;
use crate::events::ProposalCancelled;
use crate::state::{Member, Proposal, ProposalStatus, Vault};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct CancelProposal<'info> {
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        has_one = vault @ VaultOSError::Unauthorized,
        constraint = proposal.status != ProposalStatus::Executed @ VaultOSError::ProposalAlreadyExecuted,
        constraint = proposal.status != ProposalStatus::Cancelled @ VaultOSError::ProposalCancelled,
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        seeds = [b"member", vault.key().as_ref(), member.key().as_ref()],
        bump = caller_member.bump,
        constraint = caller_member.is_active @ VaultOSError::MemberNotFound,
        constraint = caller_member.wallet == proposal.proposer || caller_member.is_admin() @ VaultOSError::Unauthorized
    )]
    pub caller_member: Account<'info, Member>,

    pub member: Signer<'info>,
}

pub fn handler<'info>(ctx: Context<'info, CancelProposal<'info>>) -> Result<()> {
    let vault_key = ctx.accounts.vault.key();

    // If caller is not the original proposer (or proposal has already reached threshold),
    // require M-of-N admin consensus to prevent unilateral admin cancellation griefing.
    let is_proposer_cancelling_active = ctx.accounts.caller_member.wallet
        == ctx.accounts.proposal.proposer
        && ctx.accounts.proposal.status == ProposalStatus::Active;

    if !is_proposer_cancelling_active {
        require!(
            ctx.accounts.caller_member.is_admin(),
            VaultOSError::Unauthorized
        );
        ctx.accounts.vault.verify_admin_consensus(
            &vault_key,
            &ctx.accounts.member.key(),
            ctx.remaining_accounts,
            false,
        )?;
    }

    let clock = Clock::get()?;
    let proposal = &mut ctx.accounts.proposal;
    proposal.status = ProposalStatus::Cancelled;

    emit!(ProposalCancelled {
        vault: ctx.accounts.vault.key(),
        proposal: proposal.key(),
        cancelled_by: ctx.accounts.member.key(),
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
