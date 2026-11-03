use crate::errors::VaultOSError;
use crate::events::ProposalApprovalRevoked;
use crate::state::{Approval, Member, Proposal, ProposalStatus, Vault};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct RevokeApproval<'info> {
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
        bump = approver_member.bump,
        constraint = approver_member.is_active @ VaultOSError::MemberNotFound
    )]
    pub approver_member: Account<'info, Member>,

    #[account(
        mut,
        close = member,
        seeds = [b"approval", proposal.key().as_ref(), member.key().as_ref()],
        bump = approval.bump,
    )]
    pub approval: Account<'info, Approval>,

    #[account(mut)]
    pub member: Signer<'info>,
}

pub fn handler(ctx: Context<RevokeApproval>) -> Result<()> {
    let clock = Clock::get()?;
    let proposal = &mut ctx.accounts.proposal;

    let member_key = ctx.accounts.member.key();
    proposal.approvers.retain(|k| k != &member_key);
    proposal.approval_count = proposal
        .approval_count
        .checked_sub(1)
        .ok_or(VaultOSError::ArithmeticOverflow)?;

    if proposal.approval_count < proposal.required_threshold {
        proposal.status = ProposalStatus::Active;
        proposal.approved_at = 0;
    }

    emit!(ProposalApprovalRevoked {
        vault: ctx.accounts.vault.key(),
        proposal: proposal.key(),
        member: ctx.accounts.member.key(),
        current_approvals: proposal.approval_count,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
