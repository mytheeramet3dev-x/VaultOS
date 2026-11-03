use anchor_lang::prelude::*;

#[error_code]
pub enum VaultOSError {
    #[msg("Unauthorized signer for this action")]
    Unauthorized,

    #[msg("Member does not possess the required role")]
    InvalidRole,

    #[msg("Proposal required approval threshold has not been reached")]
    ThresholdNotMet,

    #[msg("Signer has already approved this proposal")]
    AlreadyApproved,

    #[msg("Approval has not been granted by this signer")]
    ApprovalNotFound,

    #[msg("Proposal is timelocked and cannot be executed yet")]
    TimelockNotElapsed,

    #[msg("Vault is currently frozen due to emergency controls")]
    VaultIsFrozen,

    #[msg("Vault is not currently frozen")]
    VaultNotFrozen,

    #[msg("Proposal has already been executed")]
    ProposalAlreadyExecuted,

    #[msg("Proposal has been cancelled")]
    ProposalCancelled,

    #[msg("Proposal has expired")]
    ProposalExpired,

    #[msg("Proposal is not in an executable state")]
    ProposalNotExecutable,

    #[msg("Transfer exceeds per-transaction spending limit")]
    PerTransactionLimitExceeded,

    #[msg("Transfer exceeds rolling window spending limit")]
    RollingSpendingLimitExceeded,

    #[msg("Transfer destination address is not in the allowlist")]
    DestinationNotAllowed,

    #[msg("Token mint is not in the allowed asset list")]
    AssetNotAllowed,

    #[msg("Target program ID is not in the allowed CPI programs list")]
    ProgramNotAllowed,

    #[msg("Invalid vault authority PDA provided")]
    InvalidVaultAuthority,

    #[msg("Member is already registered in this vault")]
    MemberAlreadyExists,

    #[msg("Member account is deactivated or not found")]
    MemberNotFound,

    #[msg("Member is already active")]
    MemberAlreadyActive,

    #[msg("Invalid threshold: must be greater than 0 and <= total active members")]
    InvalidThreshold,

    #[msg("Arithmetic overflow or underflow occurred")]
    ArithmeticOverflow,

    #[msg("String length exceeds maximum permissible limit")]
    StringTooLong,

    #[msg("Invalid account seeds or derivation")]
    InvalidPDASeeds,

    #[msg("Invalid token account or mismatch with mint/owner")]
    InvalidTokenAccount,

    #[msg("Proposal operation type mismatch")]
    InvalidOperationType,

    #[msg("Escalated policy threshold requirement not met")]
    EscalatedThresholdNotMet,

    #[msg("Proposal or approval revision does not match current vault config revision")]
    StaleConfigRevision,

    #[msg("Invalid timelock delay: must be between 0 and 30 days")]
    InvalidTimelock,

    #[msg("Maximum number of approvers (16) reached for this proposal")]
    MaxApproversReached,

    #[msg("Maximum number of vault members reached")]
    MaxMembersReached,

    #[msg("Active approver count cannot fall below vault threshold")]
    ApproverThresholdShortfall,

    #[msg("Vault must retain at least one active executor")]
    NoActiveExecutor,
}
