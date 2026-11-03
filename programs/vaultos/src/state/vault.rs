use crate::errors::VaultOSError;
use crate::state::Member;
use anchor_lang::prelude::*;

pub const MAX_VAULT_NAME_LEN: usize = 64;
pub const MAX_TIMELOCK_SECONDS: i64 = 30 * 24 * 60 * 60; // 30 days max timelock
pub const DEFAULT_EXECUTION_GRACE_SECONDS: i64 = 7 * 24 * 60 * 60; // 7 days post-timelock execution window
pub const MAX_VAULT_MEMBERS: u16 = 64;
pub const MAX_VAULT_POLICIES: u16 = 16;

#[account]
pub struct Vault {
    pub organization: Pubkey,
    pub vault_index: u32,
    pub name: String,
    pub authority_bump: u8,
    pub threshold: u16,
    pub member_count: u16,
    pub admin_count: u16,
    pub proposal_count: u64,
    pub policy_count: u16,
    pub timelock_delay: i64,
    pub is_frozen: bool,
    pub created_at: i64,
    pub bump: u8,
    pub executed_proposal_count: u64,
    pub config_revision: u32,
    pub account_version: u8,
    pub approver_count: u16,
    pub executor_count: u16,
}

impl Vault {
    pub const MAX_NAME_LEN: usize = MAX_VAULT_NAME_LEN;
    pub const MAX_TIMELOCK: i64 = MAX_TIMELOCK_SECONDS;
    pub const EXECUTION_GRACE_PERIOD: i64 = DEFAULT_EXECUTION_GRACE_SECONDS;
    pub const MAX_MEMBERS: u16 = MAX_VAULT_MEMBERS;
    pub const MAX_POLICIES: u16 = MAX_VAULT_POLICIES;
    pub const CURRENT_VERSION: u8 = 1;

    pub const LEN: usize = 8 // discriminator
        + 32 // organization
        + 4 // vault_index
        + (4 + Self::MAX_NAME_LEN) // name
        + 1 // authority_bump
        + 2 // threshold
        + 2 // member_count
        + 2 // admin_count
        + 8 // proposal_count
        + 2 // policy_count
        + 8 // timelock_delay
        + 1 // is_frozen
        + 8 // created_at
        + 1 // bump
        + 8 // executed_proposal_count
        + 4 // config_revision
        + 1 // account_version
        + 2 // approver_count
        + 2 // executor_count
        + 45; // reserved padding

    pub fn is_in_bootstrap_phase(&self) -> bool {
        self.member_count < self.threshold
    }

    /// Enforces M-of-N multisig consensus for administrative mutations once the vault has
    /// reached `member_count >= threshold` and `threshold > 1`.
    /// During initial bootstrap (`member_count < threshold`), only onboarding instructions
    /// (`allow_bootstrap = true`: `add_member`, `create_policy`) are permitted; destructive
    /// mutations (`remove_member`, `update_member`, `update_policy`, `remove_policy`, `unfreeze_vault`)
    /// are strictly blocked during bootstrap if `threshold > 1`.
    pub fn verify_admin_consensus<'info>(
        &self,
        vault_key: &Pubkey,
        primary_admin: &Pubkey,
        remaining_accounts: &[AccountInfo<'info>],
        allow_bootstrap: bool,
    ) -> Result<()> {
        if self.threshold <= 1 {
            return Ok(());
        }
        if self.is_in_bootstrap_phase() {
            require!(allow_bootstrap, VaultOSError::ThresholdNotMet);
            return Ok(());
        }

        require!(
            remaining_accounts.len() % 2 == 0,
            VaultOSError::InvalidPDASeeds
        );

        let mut verified_signers: Vec<Pubkey> = vec![*primary_admin];

        // Single-loop verification over [cosigner_wallet, cosigner_member_pda] pairs (no silent skip)
        for pair in remaining_accounts.chunks_exact(2) {
            let cosigner_wallet = &pair[0];
            let cosigner_pda = &pair[1];

            require!(cosigner_wallet.is_signer, VaultOSError::Unauthorized);
            require!(
                cosigner_wallet.key != primary_admin
                    && !verified_signers.contains(cosigner_wallet.key),
                VaultOSError::Unauthorized
            );
            require!(
                cosigner_pda.owner == &crate::ID,
                VaultOSError::InvalidPDASeeds
            );

            let data = cosigner_pda
                .try_borrow_data()
                .map_err(|_| error!(VaultOSError::InvalidPDASeeds))?;
            let mut slice: &[u8] = &data;
            let member = Member::try_deserialize(&mut slice)
                .map_err(|_| error!(VaultOSError::InvalidPDASeeds))?;

            let expected_pda = Pubkey::create_program_address(
                &[
                    b"member",
                    vault_key.as_ref(),
                    member.wallet.as_ref(),
                    &[member.bump],
                ],
                &crate::ID,
            )
            .map_err(|_| error!(VaultOSError::InvalidPDASeeds))?;

            require!(
                cosigner_pda.key == &expected_pda,
                VaultOSError::InvalidPDASeeds
            );
            require!(member.vault == *vault_key, VaultOSError::InvalidPDASeeds);
            require!(
                member.wallet == *cosigner_wallet.key,
                VaultOSError::Unauthorized
            );
            require!(member.is_active, VaultOSError::MemberNotFound);
            require!(
                member.is_admin() || member.can_approve(),
                VaultOSError::InvalidRole
            );

            verified_signers.push(member.wallet);
        }

        require!(
            verified_signers.len() >= self.threshold as usize,
            VaultOSError::ThresholdNotMet
        );
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn vault_len_matches_max_serialized_struct() {
        let max_vault = Vault {
            organization: Pubkey::new_unique(),
            vault_index: u32::MAX,
            name: "A".repeat(Vault::MAX_NAME_LEN),
            authority_bump: 255,
            threshold: 16,
            member_count: 16,
            admin_count: 16,
            proposal_count: u64::MAX,
            policy_count: u16::MAX,
            timelock_delay: i64::MAX,
            is_frozen: true,
            created_at: i64::MAX,
            bump: 255,
            executed_proposal_count: u64::MAX,
            config_revision: u32::MAX,
            account_version: Vault::CURRENT_VERSION,
            approver_count: 16,
            executor_count: 16,
        };
        let mut buf = Vec::with_capacity(Vault::LEN);
        max_vault.try_serialize(&mut buf).unwrap();
        assert_eq!(
            buf.len() + 45,
            Vault::LEN,
            "Vault::LEN must equal exact max Borsh serialized size + 45 reserved bytes"
        );
    }
}
