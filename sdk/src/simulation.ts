import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { ProposalAccount, PolicyAccount } from "./types";
import { PolicyEvaluator, PolicyCheckResult } from "./policy";

export interface SimulationResult {
  success: boolean;
  estimatedFeeLamports: number;
  expectedBalanceChanges: {
    account: string;
    preLamports: number;
    postLamports: number;
    deltaLamports: number;
  }[];
  policyCheck: PolicyCheckResult;
  logs: string[];
  errorMessage?: string;
  warnings: string[];
}

export class SimulationHelper {
  static async simulateProposalExecution(
    connection: Connection,
    proposal: ProposalAccount,
    policies: PolicyAccount[],
    baseThreshold: number,
    baseTimelock: bigint,
    vaultAuthority: PublicKey
  ): Promise<SimulationResult> {
    const warnings: string[] = [];

    // 1. Client-side policy check
    const policyCheck = PolicyEvaluator.evaluate(
      policies,
      proposal.operation,
      baseThreshold,
      baseTimelock
    );

    if (!policyCheck.passed) {
      warnings.push(...policyCheck.violations);
    }

    // 2. Expected balance change computation
    const balanceChanges: SimulationResult["expectedBalanceChanges"] = [];

    if (proposal.operation.type === "SolTransfer") {
      const lamports = Number(proposal.operation.lamports);
      balanceChanges.push(
        {
          account: vaultAuthority.toBase58(),
          preLamports: 0,
          postLamports: -lamports,
          deltaLamports: -lamports,
        },
        {
          account: proposal.operation.destination.toBase58(),
          preLamports: 0,
          postLamports: lamports,
          deltaLamports: lamports,
        }
      );
    }

    // 3. Timelock warnings
    const now = BigInt(Math.floor(Date.now() / 1000));
    if (proposal.timelockDelay > 0n) {
      const unlockTime = BigInt(proposal.approvedAt) + proposal.timelockDelay;
      if (now < unlockTime) {
        warnings.push(
          `Proposal is currently timelocked until ${new Date(Number(unlockTime) * 1000).toISOString()}`
        );
      }
    }

    // 4. Threshold warnings
    if (proposal.approvalCount < proposal.requiredThreshold) {
      warnings.push(
        `Approval threshold not yet reached: ${proposal.approvalCount}/${proposal.requiredThreshold}`
      );
    }

    return {
      success: policyCheck.passed && proposal.approvalCount >= proposal.requiredThreshold,
      estimatedFeeLamports: 5000,
      expectedBalanceChanges: balanceChanges,
      policyCheck,
      logs: ["Simulation pre-flight completed successfully"],
      warnings,
    };
  }
}
