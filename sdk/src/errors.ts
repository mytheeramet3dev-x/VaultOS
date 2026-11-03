export const VAULTOS_ERRORS: Record<string, string> = {
  Unauthorized: "Unauthorized signer for this action",
  InvalidRole: "Member does not possess the required role",
  ThresholdNotMet: "Proposal required approval threshold has not been reached",
  AlreadyApproved: "Signer has already approved this proposal",
  ApprovalNotFound: "Approval has not been granted by this signer",
  TimelockNotElapsed: "Proposal is timelocked and cannot be executed yet",
  VaultIsFrozen: "Vault is currently frozen due to emergency controls",
  VaultNotFrozen: "Vault is not currently frozen",
  ProposalAlreadyExecuted: "Proposal has already been executed",
  ProposalCancelled: "Proposal has been cancelled",
  ProposalExpired: "Proposal has expired",
  ProposalNotExecutable: "Proposal is not in an executable state",
  PerTransactionLimitExceeded: "Transfer exceeds per-transaction spending limit",
  RollingSpendingLimitExceeded: "Transfer exceeds rolling window spending limit",
  DestinationNotAllowed: "Transfer destination address is not in the allowlist",
  AssetNotAllowed: "Token mint is not in the allowed asset list",
  ProgramNotAllowed: "Target program ID is not in the allowed CPI programs list",
  InvalidVaultAuthority: "Invalid vault authority PDA provided",
  MemberAlreadyExists: "Member is already registered in this vault",
  MemberNotFound: "Member account is deactivated or not found",
  InvalidThreshold: "Invalid threshold: must be greater than 0 and <= total active members",
  ArithmeticOverflow: "Arithmetic overflow or underflow occurred",
  StringTooLong: "String length exceeds maximum permissible limit",
  InvalidPDASeeds: "Invalid account seeds or derivation",
  InvalidTokenAccount: "Invalid token account or mismatch with mint/owner",
  EscalatedThresholdNotMet: "Escalated policy threshold requirement not met",
  StaleConfigRevision: "Governance configuration revision changed since proposal or approval was created",
  InvalidTimelock: "Invalid timelock delay: must be between 0 and maximum permissible timelock (30 days)",
  MaxApproversReached: "Maximum number of approvers reached for a single proposal",
  MaxMembersReached: "Maximum number of vault members reached",
  ApproverThresholdShortfall: "Cannot reduce active approvers below the vault approval threshold",
  NoActiveExecutor: "Vault must retain at least one active executor",
};

export class VaultOSError extends Error {
  constructor(public code: string, message?: string) {
    const desc = VAULTOS_ERRORS[code] || "VaultOS error";
    super(message || `${code}: ${desc}`);
    this.name = "VaultOSError";
  }

  static fromLogs(logs: string[]): VaultOSError | null {
    for (const log of logs) {
      for (const code of Object.keys(VAULTOS_ERRORS)) {
        if (log.includes(code)) {
          return new VaultOSError(code);
        }
      }
    }
    return null;
  }
}
