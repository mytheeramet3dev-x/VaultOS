use crate::errors::VaultOSError;
use crate::events::ProposalApproved;
use crate::state::{Approval, Member, Proposal, ProposalStatus, Vault};
use anchor_lang::prelude::*;

#[derive(Accounts)]
pub struct ApproveProposal<'info> {
    pub vault: Account<'info, Vault>,

    #[account(
        mut,
        has_one = vault @ VaultOSError::Unauthorized,
        constraint = proposal.status == ProposalStatus::Active || proposal.status == ProposalStatus::Approved || proposal.status == ProposalStatus::Executable @ VaultOSError::ProposalNotExecutable,
    )]
    pub proposal: Account<'info, Proposal>,

    #[account(
        seeds = [b"member", vault.key().as_ref(), approver.key().as_ref()],
        bump = approver_member.bump,
        constraint = approver_member.can_approve() @ VaultOSError::InvalidRole
    )]
    pub approver_member: Account<'info, Member>,

    #[account(
        init,
        payer = approver,
        space = Approval::LEN,
        seeds = [b"approval", proposal.key().as_ref(), approver.key().as_ref()],
        bump
    )]
    pub approval: Account<'info, Approval>,

    #[account(mut)]
    pub approver: Signer<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ApproveProposal>) -> Result<()> {
    let clock = Clock::get()?;
    let proposal = &mut ctx.accounts.proposal;

    let is_unfreeze_op = matches!(
        proposal.operation,
        crate::state::ProposalOperation::SetFrozen { frozen: false }
    );
    if ctx.accounts.vault.is_frozen && !is_unfreeze_op {
        return err!(VaultOSError::VaultIsFrozen);
    }

    require!(
        clock.unix_timestamp <= proposal.expires_at,
        VaultOSError::ProposalExpired
    );
    require!(
        proposal.vault_revision == ctx.accounts.vault.config_revision,
        VaultOSError::StaleConfigRevision
    );
    require!(
        !proposal.approvers.contains(&ctx.accounts.approver.key()),
        VaultOSError::AlreadyApproved
    );
    require!(
        proposal.approvers.len() < Proposal::MAX_APPROVERS,
        VaultOSError::MaxApproversReached
    );

    let approval = &mut ctx.accounts.approval;
    approval.proposal = proposal.key();
    approval.member = ctx.accounts.approver.key();
    approval.approved_at = clock.unix_timestamp;
    approval.bump = ctx.bumps.approval;
    approval.proposal_revision = proposal.vault_revision;

    proposal.approvers.push(ctx.accounts.approver.key());
    proposal.approval_count = proposal
        .approval_count
        .checked_add(1)
        .ok_or(VaultOSError::ArithmeticOverflow)?;

    if proposal.approval_count >= proposal.required_threshold {
        if proposal.approved_at == 0 {
            proposal.approved_at = clock.unix_timestamp;
        }
        let max_lifetime = proposal
            .created_at
            .checked_add(Vault::MAX_TIMELOCK)
            .ok_or(VaultOSError::ArithmeticOverflow)?
            .checked_add(Vault::EXECUTION_GRACE_PERIOD * 2)
            .ok_or(VaultOSError::ArithmeticOverflow)?;
        let min_expiry_after_approval = clock
            .unix_timestamp
            .checked_add(proposal.timelock_delay)
            .ok_or(VaultOSError::ArithmeticOverflow)?
            .checked_add(Vault::EXECUTION_GRACE_PERIOD)
            .ok_or(VaultOSError::ArithmeticOverflow)?
            .min(max_lifetime);
        if proposal.expires_at < min_expiry_after_approval {
            proposal.expires_at = min_expiry_after_approval;
        }

        if proposal.timelock_delay == 0 {
            proposal.status = ProposalStatus::Executable;
        } else {
            proposal.status = ProposalStatus::Approved;
        }
    }

    emit!(ProposalApproved {
        vault: ctx.accounts.vault.key(),
        proposal: proposal.key(),
        approver: ctx.accounts.approver.key(),
        current_approvals: proposal.approval_count,
        required_threshold: proposal.required_threshold,
        timestamp: clock.unix_timestamp,
    });

    Ok(())
}
