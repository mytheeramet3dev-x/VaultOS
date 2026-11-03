use anchor_lang::prelude::*;

pub const ROLE_ADMIN: u8 = 1 << 0; // 1
pub const ROLE_PROPOSER: u8 = 1 << 1; // 2
pub const ROLE_APPROVER: u8 = 1 << 2; // 4
pub const ROLE_EXECUTOR: u8 = 1 << 3; // 8
pub const ROLE_GUARDIAN: u8 = 1 << 4; // 16
pub const ALL_ROLES: u8 =
    ROLE_ADMIN | ROLE_PROPOSER | ROLE_APPROVER | ROLE_EXECUTOR | ROLE_GUARDIAN; // 31

#[account]
pub struct Member {
    pub vault: Pubkey,
    pub wallet: Pubkey,
    pub roles: u8,
    pub is_active: bool,
    pub added_at: i64,
    pub bump: u8,
    pub config_revision_at_join: u32,
}

impl Member {
    pub const LEN: usize = 8 // discriminator
        + 32 // vault
        + 32 // wallet
        + 1  // roles bitmask
        + 1  // is_active
        + 8  // added_at
        + 1  // bump
        + 4  // config_revision_at_join
        + 28; // reserved padding

    pub fn has_role(&self, role: u8) -> bool {
        self.is_active && (self.roles & role) != 0
    }

    pub fn is_admin(&self) -> bool {
        self.has_role(ROLE_ADMIN)
    }

    pub fn can_propose(&self) -> bool {
        self.has_role(ROLE_PROPOSER)
    }

    pub fn can_approve(&self) -> bool {
        self.has_role(ROLE_APPROVER)
    }

    pub fn can_execute(&self) -> bool {
        self.has_role(ROLE_EXECUTOR)
    }

    pub fn is_guardian(&self) -> bool {
        self.has_role(ROLE_GUARDIAN) || self.has_role(ROLE_ADMIN)
    }
}
