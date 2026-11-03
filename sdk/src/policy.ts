import { PublicKey, SystemProgram } from "@solana/web3.js";
import { DEFAULT_PROGRAM_ID } from "./pda";
import { PolicyAccount, ProposalOperation } from "./types";
import { VaultOSError } from "./errors";

export const FORBIDDEN_CPI_PROGRAMS: PublicKey[] = [
  SystemProgram.programId,
  new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"), // SPL Token
  new PublicKey("TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb"), // SPL Token-2022
  new PublicKey("BPFLoaderUpgradeab1e11111111111111111111111"), // BPF Loader Upgradeable
  DEFAULT_PROGRAM_ID,
  PublicKey.default,
];

export interface PolicyCheckResult {
  passed: boolean;
  violations: string[];
  escalatedThreshold?: number;
  escalatedTimelock?: bigint;
}

export class PolicyEvaluator {
  static isForbiddenCpiProgram(programId: PublicKey): boolean {
    return FORBIDDEN_CPI_PROGRAMS.some((p) => p.equals(programId));
  }

  /**
   * Pre-evaluates an operation against a list of active policies client-side.
   */
  static evaluate(
    policies: PolicyAccount[],
    operation: ProposalOperation,
    baseThreshold: number,
    baseTimelock: bigint,
    currentTimestamp: bigint = BigInt(Math.floor(Date.now() / 1000))
  ): PolicyCheckResult {
    const violations: string[] = [];
    let requiredThreshold = baseThreshold;
    let requiredTimelock = baseTimelock;

    if (
      operation.type === "CpiCall" &&
      PolicyEvaluator.isForbiddenCpiProgram(operation.programId)
    ) {
      violations.push(
        `Program ${operation.programId.toBase58()} is a core asset/system program and cannot be invoked via CpiCall`
      );
    }

    for (const policy of policies) {
      if (!policy.isActive) continue;

      const { config } = policy;

      switch (config.type) {
        case "PerTransactionLimit": {
          if (operation.type === "SolTransfer" && config.mint === null) {
            if (operation.lamports > config.maxAmount) {
              violations.push(
                `SOL transfer of ${operation.lamports} lamports exceeds limit of ${config.maxAmount}`
              );
            }
          } else if (
            operation.type === "TokenTransfer" &&
            config.mint !== null &&
            config.mint.equals(operation.mint)
          ) {
            if (operation.amount > config.maxAmount) {
              violations.push(
                `Token transfer of ${operation.amount} exceeds limit of ${config.maxAmount}`
              );
            }
          }
          break;
        }

        case "RollingSpendingLimit": {
          const isSol = operation.type === "SolTransfer" && config.mint === null;
          const isToken =
            operation.type === "TokenTransfer" &&
            config.mint !== null &&
            config.mint.equals(operation.mint);

          if (isSol || isToken) {
            const amount =
              operation.type === "SolTransfer" ? operation.lamports : operation.amount;
            const windowElapsed = currentTimestamp - config.currentWindowStart;
            const spent = windowElapsed >= config.windowSeconds ? 0n : config.currentSpent;

            if (spent + amount > config.maxAmountWindow) {
              violations.push(
                `Transfer of ${amount} exceeds 24h rolling limit (${spent}/${config.maxAmountWindow})`
              );
            }
          }
          break;
        }

        case "DestinationAllowlist": {
          if (
            operation.type === "SolTransfer" ||
            operation.type === "TokenTransfer"
          ) {
            if (
              config.destinations.length > 0 &&
              !config.destinations.some((d) => d.equals(operation.destination))
            ) {
              violations.push(
                `Destination ${operation.destination.toBase58()} is not allowlisted`
              );
            }
          }
          break;
        }

        case "AssetAllowlist": {
          if (operation.type === "TokenTransfer") {
            if (
              config.allowedMints.length > 0 &&
              !config.allowedMints.some((m) => m.equals(operation.mint))
            ) {
              violations.push(
                `Token mint ${operation.mint.toBase58()} is not allowlisted`
              );
            }
          }
          break;
        }

        case "ProgramAllowlist": {
          if (operation.type === "CpiCall") {
            if (
              config.allowedPrograms.length > 0 &&
              !config.allowedPrograms.some((p) => p.equals(operation.programId))
            ) {
              violations.push(
                `Program ${operation.programId.toBase58()} is not in allowlist for CPI`
              );
            }
          }
          break;
        }

        case "ApprovalEscalation": {
          let amount = 0n;
          if (operation.type === "SolTransfer") amount = operation.lamports;
          else if (operation.type === "TokenTransfer") amount = operation.amount;

          if (amount >= config.tierAmount) {
            const escThresh = baseThreshold + config.extraApprovals;
            const escTl = baseTimelock + config.extraTimelock;
            if (escThresh > requiredThreshold) requiredThreshold = escThresh;
            if (escTl > requiredTimelock) requiredTimelock = escTl;
          }
          break;
        }
      }
    }

    return {
      passed: violations.length === 0,
      violations,
      escalatedThreshold: requiredThreshold,
      escalatedTimelock: requiredTimelock,
    };
  }
}
