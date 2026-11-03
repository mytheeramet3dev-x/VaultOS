use anchor_lang::prelude::*;

#[account]
pub struct Approval {
    pub proposal: Pubkey,
    pub member: Pubkey,
    pub approved_at: i64,
    pub bump: u8,
    pub proposal_revision: u32,
}

impl Approval {
    pub const LEN: usize = 8 // discriminator
        + 32 // proposal
        + 32 // member
        + 8  // approved_at
        + 1  // bump
        + 4  // proposal_revision
        + 12; // reserved padding
}
