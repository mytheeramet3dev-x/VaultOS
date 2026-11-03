use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq)]
pub enum PolicyType {
    PerTransactionLimit {
        mint: Option<Pubkey>,
        max_amount: u64,
    },
    RollingSpendingLimit {
        mint: Option<Pubkey>,
        max_amount_window: u64,
        window_seconds: i64,
        current_window_start: i64,
        current_spent: u64,
    },
    DestinationAllowlist {
        destinations: Vec<Pubkey>,
    },
    AssetAllowlist {
        allowed_mints: Vec<Pubkey>,
    },
    ProgramAllowlist {
        allowed_programs: Vec<Pubkey>,
    },
    ApprovalEscalation {
        tier_amount: u64,
        extra_approvals: u16,
        extra_timelock: i64,
    },
}

#[account]
pub struct Policy {
    pub vault: Pubkey,
    pub policy_index: u16,
    pub policy_type: PolicyType,
    pub is_active: bool,
    pub created_at: i64,
    pub bump: u8,
}

impl Policy {
    pub const MAX_VECTOR_LEN: usize = 10;

    pub const LEN: usize = 8 // discriminator
        + 32 // vault
        + 2  // policy_index
        + (1 + 33 + 8 + 8 + 8 + 8 + (4 + Self::MAX_VECTOR_LEN * 32)) // policy_type enum
        + 1  // is_active
        + 8  // created_at
        + 1  // bump
        + 64; // reserved padding
}
