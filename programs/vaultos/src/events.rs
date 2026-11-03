use anchor_lang::prelude::*;

#[event]
pub struct OrganizationCreated {
    pub organization: Pubkey,
    pub org_id: String,
    pub name: String,
    pub admin: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct VaultCreated {
    pub organization: Pubkey,
    pub vault: Pubkey,
    pub vault_authority: Pubkey,
    pub vault_index: u32,
    pub name: String,
    pub threshold: u16,
    pub timelock_delay: i64,
    pub timestamp: i64,
}

#[event]
pub struct MemberAdded {
    pub vault: Pubkey,
    pub member: Pubkey,
    pub roles: u8,
    pub timestamp: i64,
}

#[event]
pub struct MemberRemoved {
    pub vault: Pubkey,
    pub member: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct MemberRolesUpdated {
    pub vault: Pubkey,
    pub member: Pubkey,
    pub new_roles: u8,
    pub timestamp: i64,
}

#[event]
pub struct ProposalCreated {
    pub vault: Pubkey,
    pub proposal: Pubkey,
    pub proposal_index: u64,
    pub proposer: Pubkey,
    pub title: String,
    pub operation_type: u8,
    pub destination: Pubkey,
    pub amount: u64,
    pub mint: Option<Pubkey>,
    pub required_threshold: u16,
    pub timelock_delay: i64,
    pub expires_at: i64,
    pub timestamp: i64,
}

#[event]
pub struct ProposalApproved {
    pub vault: Pubkey,
    pub proposal: Pubkey,
    pub approver: Pubkey,
    pub current_approvals: u16,
    pub required_threshold: u16,
    pub timestamp: i64,
}

#[event]
pub struct ProposalApprovalRevoked {
    pub vault: Pubkey,
    pub proposal: Pubkey,
    pub member: Pubkey,
    pub current_approvals: u16,
    pub timestamp: i64,
}

#[event]
pub struct ProposalCancelled {
    pub vault: Pubkey,
    pub proposal: Pubkey,
    pub cancelled_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct ProposalExecuted {
    pub vault: Pubkey,
    pub proposal: Pubkey,
    pub executor: Pubkey,
    pub operation_type: u8,
    pub destination: Pubkey,
    pub amount: u64,
    pub timestamp: i64,
}

#[event]
pub struct PolicyCreated {
    pub vault: Pubkey,
    pub policy: Pubkey,
    pub policy_index: u16,
    pub policy_type: u8,
    pub timestamp: i64,
}

#[event]
pub struct PolicyUpdated {
    pub vault: Pubkey,
    pub policy: Pubkey,
    pub policy_index: u16,
    pub policy_type: u8,
    pub timestamp: i64,
}

#[event]
pub struct PolicyRemoved {
    pub vault: Pubkey,
    pub policy: Pubkey,
    pub policy_index: u16,
    pub timestamp: i64,
}

#[event]
pub struct VaultFrozen {
    pub vault: Pubkey,
    pub frozen_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct VaultUnfrozen {
    pub vault: Pubkey,
    pub unfrozen_by: Pubkey,
    pub timestamp: i64,
}

#[event]
pub struct DepositReceived {
    pub vault: Pubkey,
    pub depositor: Pubkey,
    pub mint: Option<Pubkey>,
    pub amount: u64,
    pub timestamp: i64,
}
