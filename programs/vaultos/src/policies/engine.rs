use crate::errors::VaultOSError;
use crate::state::{Policy, PolicyType, Proposal, ProposalOperation, Vault};
use anchor_lang::prelude::*;

pub const SPL_TOKEN_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    6, 221, 246, 225, 215, 101, 161, 147, 217, 203, 225, 70, 206, 235, 121, 172, 28, 180, 133, 237,
    95, 91, 55, 145, 58, 140, 245, 133, 126, 255, 0, 169,
]);
pub const SPL_TOKEN_2022_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    6, 221, 246, 225, 238, 117, 143, 222, 24, 66, 93, 188, 228, 108, 205, 218, 182, 26, 252, 77,
    131, 185, 13, 39, 254, 189, 249, 40, 216, 161, 139, 252,
]);
pub const BPF_LOADER_UPGRADEABLE_PROGRAM_ID: Pubkey = Pubkey::new_from_array([
    2, 168, 246, 145, 78, 136, 161, 176, 226, 16, 21, 62, 247, 99, 174, 43, 0, 194, 185, 61, 22,
    193, 36, 210, 192, 83, 122, 16, 4, 128, 0, 0,
]);

pub struct PolicyEngine;

impl PolicyEngine {
    /// Returns true if a program ID is a core asset/system program that must never be invoked
    /// via generic CpiCall (preventing CpiCall from bypassing SolTransfer / TokenTransfer spending policies).
    pub fn is_forbidden_cpi_program(program_id: &Pubkey) -> bool {
        *program_id == crate::ID
            || *program_id == Pubkey::default()
            || *program_id == anchor_lang::solana_program::system_program::ID
            || *program_id == SPL_TOKEN_PROGRAM_ID
            || *program_id == SPL_TOKEN_2022_PROGRAM_ID
            || *program_id == BPF_LOADER_UPGRADEABLE_PROGRAM_ID
    }
    /// Evaluates a single policy against a proposal operation and updates rolling window state if applicable.
    pub fn evaluate_policy(
        policy: &mut Policy,
        operation: &ProposalOperation,
        current_timestamp: i64,
    ) -> Result<()> {
        if !policy.is_active {
            return Ok(());
        }

        match &mut policy.policy_type {
            PolicyType::PerTransactionLimit { mint, max_amount } => match operation {
                ProposalOperation::SolTransfer { lamports, .. } => {
                    if mint.is_none() && *lamports > *max_amount {
                        return err!(VaultOSError::PerTransactionLimitExceeded);
                    }
                }
                ProposalOperation::TokenTransfer {
                    mint: token_mint,
                    amount,
                    ..
                } => {
                    if let Some(m) = mint {
                        if m == token_mint && *amount > *max_amount {
                            return err!(VaultOSError::PerTransactionLimitExceeded);
                        }
                    }
                }
                _ => {}
            },

            PolicyType::RollingSpendingLimit {
                mint,
                max_amount_window,
                window_seconds,
                current_window_start,
                current_spent,
            } => {
                let (target_mint, transfer_amount) = match operation {
                    ProposalOperation::SolTransfer { lamports, .. } => (None, *lamports),
                    ProposalOperation::TokenTransfer {
                        mint: m, amount, ..
                    } => (Some(*m), *amount),
                    _ => return Ok(()),
                };

                if *mint == target_mint {
                    // Check if window expired, reset if needed
                    let window_elapsed = current_timestamp
                        .checked_sub(*current_window_start)
                        .ok_or(VaultOSError::ArithmeticOverflow)?;

                    if window_elapsed >= *window_seconds {
                        *current_window_start = current_timestamp;
                        *current_spent = 0;
                    }

                    let new_spent = current_spent
                        .checked_add(transfer_amount)
                        .ok_or(VaultOSError::ArithmeticOverflow)?;

                    if new_spent > *max_amount_window {
                        return err!(VaultOSError::RollingSpendingLimitExceeded);
                    }

                    *current_spent = new_spent;
                }
            }

            PolicyType::DestinationAllowlist { destinations } => match operation {
                ProposalOperation::SolTransfer { destination, .. }
                | ProposalOperation::TokenTransfer { destination, .. } => {
                    if !destinations.is_empty() && !destinations.contains(destination) {
                        return err!(VaultOSError::DestinationNotAllowed);
                    }
                }
                _ => {}
            },

            PolicyType::AssetAllowlist { allowed_mints } => {
                if let ProposalOperation::TokenTransfer { mint, .. } = operation {
                    if !allowed_mints.is_empty() && !allowed_mints.contains(mint) {
                        return err!(VaultOSError::AssetNotAllowed);
                    }
                }
            }

            PolicyType::ProgramAllowlist { allowed_programs } => {
                if let ProposalOperation::CpiCall { program_id, .. } = operation {
                    if Self::is_forbidden_cpi_program(program_id)
                        || (!allowed_programs.is_empty() && !allowed_programs.contains(program_id))
                    {
                        return err!(VaultOSError::ProgramNotAllowed);
                    }
                }
            }

            PolicyType::ApprovalEscalation { .. } => {
                // Evaluated during proposal creation and execution escalation check
            }
        }

        Ok(())
    }

    /// Computes any escalation threshold or extra timelock required for a given operation
    pub fn compute_escalation(
        policy: &Policy,
        operation: &ProposalOperation,
        base_threshold: u16,
        base_timelock: i64,
    ) -> Result<(u16, i64)> {
        if !policy.is_active {
            return Ok((base_threshold, base_timelock));
        }

        if let PolicyType::ApprovalEscalation {
            tier_amount,
            extra_approvals,
            extra_timelock,
        } = &policy.policy_type
        {
            let amount = match operation {
                ProposalOperation::SolTransfer { lamports, .. } => *lamports,
                ProposalOperation::TokenTransfer { amount, .. } => *amount,
                _ => 0,
            };

            if amount >= *tier_amount {
                let required_threshold = base_threshold
                    .checked_add(*extra_approvals)
                    .ok_or(VaultOSError::ArithmeticOverflow)?
                    .min(Proposal::MAX_APPROVERS as u16);
                let timelock = base_timelock
                    .checked_add(*extra_timelock)
                    .ok_or(VaultOSError::ArithmeticOverflow)?
                    .min(Vault::MAX_TIMELOCK);
                return Ok((required_threshold, timelock));
            }
        }

        Ok((base_threshold, base_timelock))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_per_transaction_limit() {
        let mut policy = Policy {
            vault: Pubkey::new_unique(),
            policy_index: 0,
            policy_type: PolicyType::PerTransactionLimit {
                mint: None,
                max_amount: 10_000_000_000, // 10 SOL
            },
            is_active: true,
            created_at: 1000,
            bump: 255,
        };

        // Case 1: Under limit (5 SOL) -> OK
        let op_valid = ProposalOperation::SolTransfer {
            destination: Pubkey::new_unique(),
            lamports: 5_000_000_000,
        };
        assert!(PolicyEngine::evaluate_policy(&mut policy, &op_valid, 1000).is_ok());

        // Case 2: Exactly at limit (10 SOL) -> OK
        let op_exact = ProposalOperation::SolTransfer {
            destination: Pubkey::new_unique(),
            lamports: 10_000_000_000,
        };
        assert!(PolicyEngine::evaluate_policy(&mut policy, &op_exact, 1000).is_ok());

        // Case 3: Over limit (15 SOL) -> Error
        let op_over = ProposalOperation::SolTransfer {
            destination: Pubkey::new_unique(),
            lamports: 15_000_000_000,
        };
        assert!(PolicyEngine::evaluate_policy(&mut policy, &op_over, 1000).is_err());
    }

    #[test]
    fn test_rolling_spending_limit_and_window_reset() {
        let mut policy = Policy {
            vault: Pubkey::new_unique(),
            policy_index: 1,
            policy_type: PolicyType::RollingSpendingLimit {
                mint: None,
                max_amount_window: 20_000_000_000, // 20 SOL per 24h
                window_seconds: 86400,
                current_window_start: 1000,
                current_spent: 0,
            },
            is_active: true,
            created_at: 1000,
            bump: 255,
        };

        let op1 = ProposalOperation::SolTransfer {
            destination: Pubkey::new_unique(),
            lamports: 12_000_000_000,
        };
        // Spend 12 SOL at t=1100 -> OK, current_spent = 12 SOL
        assert!(PolicyEngine::evaluate_policy(&mut policy, &op1, 1100).is_ok());

        let op2 = ProposalOperation::SolTransfer {
            destination: Pubkey::new_unique(),
            lamports: 10_000_000_000,
        };
        // Spend 10 SOL at t=1200 -> Exceeds (12 + 10 = 22 > 20) -> Error
        assert!(PolicyEngine::evaluate_policy(&mut policy, &op2, 1200).is_err());

        // Spend 10 SOL at t = 1000 + 86401 (next window) -> Resets window! -> OK
        assert!(PolicyEngine::evaluate_policy(&mut policy, &op2, 1000 + 86401).is_ok());
    }

    #[test]
    fn test_destination_allowlist() {
        let allowed = Pubkey::new_unique();
        let forbidden = Pubkey::new_unique();

        let mut policy = Policy {
            vault: Pubkey::new_unique(),
            policy_index: 2,
            policy_type: PolicyType::DestinationAllowlist {
                destinations: vec![allowed],
            },
            is_active: true,
            created_at: 1000,
            bump: 255,
        };

        let valid_op = ProposalOperation::SolTransfer {
            destination: allowed,
            lamports: 1_000,
        };
        assert!(PolicyEngine::evaluate_policy(&mut policy, &valid_op, 1000).is_ok());

        let invalid_op = ProposalOperation::SolTransfer {
            destination: forbidden,
            lamports: 1_000,
        };
        assert!(PolicyEngine::evaluate_policy(&mut policy, &invalid_op, 1000).is_err());
    }

    #[test]
    fn test_approval_escalation() {
        let policy = Policy {
            vault: Pubkey::new_unique(),
            policy_index: 3,
            policy_type: PolicyType::ApprovalEscalation {
                tier_amount: 100_000_000_000, // 100 SOL
                extra_approvals: 2,
                extra_timelock: 86400,
            },
            is_active: true,
            created_at: 1000,
            bump: 255,
        };

        let low_op = ProposalOperation::SolTransfer {
            destination: Pubkey::new_unique(),
            lamports: 50_000_000_000,
        };
        let (thresh, tl) = PolicyEngine::compute_escalation(&policy, &low_op, 2, 3600).unwrap();
        assert_eq!(thresh, 2);
        assert_eq!(tl, 3600);

        let high_op = ProposalOperation::SolTransfer {
            destination: Pubkey::new_unique(),
            lamports: 150_000_000_000,
        };
        let (esc_thresh, esc_tl) =
            PolicyEngine::compute_escalation(&policy, &high_op, 2, 3600).unwrap();
        assert_eq!(esc_thresh, 4);
        assert_eq!(esc_tl, 3600 + 86400);
    }

    #[test]
    fn test_asset_and_program_allowlists() {
        let allowed_mint = Pubkey::new_unique();
        let forbidden_mint = Pubkey::new_unique();
        let mut asset_policy = Policy {
            vault: Pubkey::new_unique(),
            policy_index: 4,
            policy_type: PolicyType::AssetAllowlist {
                allowed_mints: vec![allowed_mint],
            },
            is_active: true,
            created_at: 1000,
            bump: 255,
        };

        let ok_token_op = ProposalOperation::TokenTransfer {
            mint: allowed_mint,
            destination: Pubkey::new_unique(),
            amount: 500_000,
        };
        assert!(PolicyEngine::evaluate_policy(&mut asset_policy, &ok_token_op, 1000).is_ok());

        let bad_token_op = ProposalOperation::TokenTransfer {
            mint: forbidden_mint,
            destination: Pubkey::new_unique(),
            amount: 500_000,
        };
        assert!(PolicyEngine::evaluate_policy(&mut asset_policy, &bad_token_op, 1000).is_err());

        let allowed_prog = Pubkey::new_unique();
        let forbidden_prog = Pubkey::new_unique();
        let mut prog_policy = Policy {
            vault: Pubkey::new_unique(),
            policy_index: 5,
            policy_type: PolicyType::ProgramAllowlist {
                allowed_programs: vec![allowed_prog],
            },
            is_active: true,
            created_at: 1000,
            bump: 255,
        };

        let ok_cpi_op = ProposalOperation::CpiCall {
            program_id: allowed_prog,
            instruction_data: vec![1, 2, 3],
        };
        assert!(PolicyEngine::evaluate_policy(&mut prog_policy, &ok_cpi_op, 1000).is_ok());

        let bad_cpi_op = ProposalOperation::CpiCall {
            program_id: forbidden_prog,
            instruction_data: vec![1, 2, 3],
        };
        assert!(PolicyEngine::evaluate_policy(&mut prog_policy, &bad_cpi_op, 1000).is_err());
    }

    #[test]
    fn test_checked_arithmetic_overflow_protection() {
        let mut policy = Policy {
            vault: Pubkey::new_unique(),
            policy_index: 6,
            policy_type: PolicyType::RollingSpendingLimit {
                mint: None,
                max_amount_window: u64::MAX,
                window_seconds: 86400,
                current_window_start: 1000,
                current_spent: u64::MAX - 10,
            },
            is_active: true,
            created_at: 1000,
            bump: 255,
        };

        let overflow_op = ProposalOperation::SolTransfer {
            destination: Pubkey::new_unique(),
            lamports: 100, // (u64::MAX - 10) + 100 overflows u64
        };
        assert!(PolicyEngine::evaluate_policy(&mut policy, &overflow_op, 1050).is_err());
    }
}
