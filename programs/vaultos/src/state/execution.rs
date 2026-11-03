use anchor_lang::prelude::*;

#[account]
pub struct ExecutionRecord {
    pub proposal: Pubkey,
    pub executor: Pubkey,
    pub executed_at: i64,
    pub outcome: u8, // 1 = Success, 2 = Failed
    pub bump: u8,
}

impl ExecutionRecord {
    pub const LEN: usize = 8 // discriminator
        + 32 // proposal
        + 32 // executor
        + 8  // executed_at
        + 1  // outcome
        + 1  // bump
        + 16; // reserved padding
}
