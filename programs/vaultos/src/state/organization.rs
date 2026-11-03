use anchor_lang::prelude::*;

#[account]
pub struct Organization {
    pub admin: Pubkey,
    pub org_id: String,
    pub name: String,
    pub vault_count: u32,
    pub created_at: i64,
    pub bump: u8,
}

impl Organization {
    pub const MAX_ORG_ID_LEN: usize = 32;
    pub const MAX_NAME_LEN: usize = 64;

    pub const LEN: usize = 8 // discriminator
        + 32 // admin
        + (4 + Self::MAX_ORG_ID_LEN) // org_id
        + (4 + Self::MAX_NAME_LEN) // name
        + 4 // vault_count
        + 8 // created_at
        + 1 // bump
        + 32; // padding for future expansion
}
