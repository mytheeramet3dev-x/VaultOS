use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum ProposalOperation {
    SolTransfer {
        destination: Pubkey,
        lamports: u64,
    },
    TokenTransfer {
        mint: Pubkey,
        destination: Pubkey,
        amount: u64,
    },
    AddMember {
        wallet: Pubkey,
        roles: u8,
    },
    RemoveMember {
        wallet: Pubkey,
    },
    ChangeThreshold {
        new_threshold: u16,
    },
    SetTimelock {
        delay_seconds: i64,
    },
    SetFrozen {
        frozen: bool,
    },
    CpiCall {
        program_id: Pubkey,
        instruction_data: Vec<u8>,
    },
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum ProposalStatus {
    Draft,
    Active,
    Approved,
    Executable,
    Executed,
    Cancelled,
    Expired,
}

#[account]
pub struct Proposal {
    pub vault: Pubkey,
    pub proposal_index: u64,
    pub proposer: Pubkey,
    pub title: String,
    pub operation: ProposalOperation,
    pub status: ProposalStatus,
    pub approval_count: u16,
    pub required_threshold: u16,
    pub timelock_delay: i64,
    pub created_at: i64,
    pub approved_at: i64,
    pub executed_at: i64,
    pub expires_at: i64,
    pub bump: u8,
    pub approvers: Vec<Pubkey>,
    pub vault_revision: u32,
}

impl Proposal {
    pub const MAX_TITLE_LEN: usize = 64;
    pub const MAX_CPI_DATA_LEN: usize = 128;
    pub const MAX_APPROVERS: usize = 16;

    pub const LEN: usize = 8 // discriminator
        + 32 // vault
        + 8  // proposal_index
        + 32 // proposer
        + (4 + Self::MAX_TITLE_LEN) // title
        + (1 + 32 + 8 + 4 + Self::MAX_CPI_DATA_LEN) // operation enum
        + 1  // status enum
        + 2  // approval_count
        + 2  // required_threshold
        + 8  // timelock_delay
        + 8  // created_at
        + 8  // approved_at
        + 8  // executed_at
        + 8  // expires_at
        + 1  // bump
        + (4 + Self::MAX_APPROVERS * 32) // approvers vector
        + 4  // vault_revision
        + 60; // reserved padding
}
