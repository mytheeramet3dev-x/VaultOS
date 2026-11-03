import { describe, it } from "node:test";
import assert from "node:assert";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  DEFAULT_PROGRAM_ID,
  getApprovalPDA,
  getExecutionRecordPDA,
  getMemberPDA,
  getOrganizationPDA,
  getPolicyPDA,
  getProposalPDA,
  getVaultAuthorityPDA,
  getVaultPDA,
  RoleBitflags,
  PolicyEvaluator,
  SimulationHelper,
  VaultOSError,
  PolicyAccount,
  ProposalAccount,
  ProposalStatus,
} from "../src";

describe("VaultOS SDK Tests", () => {
  const dummyProgramId = DEFAULT_PROGRAM_ID;

  it("should derive deterministic PDAs correctly", () => {
    const orgId = "acme-corp";
    const [orgPda, orgBump] = getOrganizationPDA(orgId, dummyProgramId);
    assert.ok(orgPda instanceof PublicKey);
    assert.ok(orgBump >= 0 && orgBump <= 255);

    const [vaultPda, vaultBump] = getVaultPDA(orgPda, 0, dummyProgramId);
    assert.ok(vaultPda instanceof PublicKey);
    assert.ok(vaultBump >= 0 && vaultBump <= 255);

    const [authPda, authBump] = getVaultAuthorityPDA(vaultPda, dummyProgramId);
    assert.ok(authPda instanceof PublicKey);
    assert.ok(authBump >= 0 && authBump <= 255);

    const wallet = Keypair.generate().publicKey;
    const [memberPda, memberBump] = getMemberPDA(vaultPda, wallet, dummyProgramId);
    assert.ok(memberPda instanceof PublicKey);
    assert.ok(memberBump >= 0 && memberBump <= 255);

    const [proposalPda, propBump] = getProposalPDA(vaultPda, 0n, dummyProgramId);
    assert.ok(proposalPda instanceof PublicKey);
    assert.ok(propBump >= 0 && propBump <= 255);

    const [approvalPda] = getApprovalPDA(proposalPda, wallet, dummyProgramId);
    assert.ok(approvalPda instanceof PublicKey);

    const [policyPda] = getPolicyPDA(vaultPda, 0, dummyProgramId);
    assert.ok(policyPda instanceof PublicKey);

    const [execPda] = getExecutionRecordPDA(proposalPda, dummyProgramId);
    assert.ok(execPda instanceof PublicKey);
  });

  it("should verify role bitflag operations", () => {
    const allRoles =
      RoleBitflags.ADMIN |
      RoleBitflags.PROPOSER |
      RoleBitflags.APPROVER |
      RoleBitflags.EXECUTOR;
    assert.strictEqual(allRoles, 15);

    const hasAdmin = (allRoles & RoleBitflags.ADMIN) !== 0;
    const hasApprover = (allRoles & RoleBitflags.APPROVER) !== 0;
    assert.ok(hasAdmin);
    assert.ok(hasApprover);

    const proposerOnly = RoleBitflags.PROPOSER;
    assert.strictEqual((proposerOnly & RoleBitflags.ADMIN) !== 0, false);
    assert.strictEqual((proposerOnly & RoleBitflags.PROPOSER) !== 0, true);
  });

  it("should evaluate per-transaction spending limit", () => {
    const policy: PolicyAccount = {
      address: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
      policyIndex: 0,
      config: {
        type: "PerTransactionLimit",
        mint: null, // SOL
        maxAmount: 10_000_000_000n, // 10 SOL
      },
      isActive: true,
      createdAt: 1000,
      bump: 255,
    };

    // Valid transfer: 5 SOL
    const resValid = PolicyEvaluator.evaluate(
      [policy],
      {
        type: "SolTransfer",
        destination: Keypair.generate().publicKey,
        lamports: 5_000_000_000n,
      },
      2,
      0n
    );
    assert.strictEqual(resValid.passed, true);
    assert.strictEqual(resValid.violations.length, 0);

    // Invalid transfer: 15 SOL
    const resInvalid = PolicyEvaluator.evaluate(
      [policy],
      {
        type: "SolTransfer",
        destination: Keypair.generate().publicKey,
        lamports: 15_000_000_000n,
      },
      2,
      0n
    );
    assert.strictEqual(resInvalid.passed, false);
    assert.ok(resInvalid.violations[0].includes("exceeds limit"));
  });

  it("should evaluate rolling 24h limit and window reset", () => {
    const policy: PolicyAccount = {
      address: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
      policyIndex: 1,
      config: {
        type: "RollingSpendingLimit",
        mint: null,
        maxAmountWindow: 20_000_000_000n, // 20 SOL
        windowSeconds: 86400n,
        currentWindowStart: 1000n,
        currentSpent: 12_000_000_000n, // 12 SOL spent
      },
      isActive: true,
      createdAt: 1000,
      bump: 255,
    };

    // Exceeds limit in same window (12 + 10 = 22 > 20)
    const resOver = PolicyEvaluator.evaluate(
      [policy],
      {
        type: "SolTransfer",
        destination: Keypair.generate().publicKey,
        lamports: 10_000_000_000n,
      },
      2,
      0n,
      1200n
    );
    assert.strictEqual(resOver.passed, false);

    // Passes in next window (after 86400s)
    const resNextWindow = PolicyEvaluator.evaluate(
      [policy],
      {
        type: "SolTransfer",
        destination: Keypair.generate().publicKey,
        lamports: 10_000_000_000n,
      },
      2,
      0n,
      1000n + 86500n
    );
    assert.strictEqual(resNextWindow.passed, true);
  });

  it("should evaluate destination allowlist policy", () => {
    const allowedDest = Keypair.generate().publicKey;
    const forbiddenDest = Keypair.generate().publicKey;

    const policy: PolicyAccount = {
      address: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
      policyIndex: 2,
      config: {
        type: "DestinationAllowlist",
        destinations: [allowedDest],
      },
      isActive: true,
      createdAt: 1000,
      bump: 255,
    };

    const resAllowed = PolicyEvaluator.evaluate(
      [policy],
      {
        type: "SolTransfer",
        destination: allowedDest,
        lamports: 1_000_000n,
      },
      2,
      0n
    );
    assert.strictEqual(resAllowed.passed, true);

    const resForbidden = PolicyEvaluator.evaluate(
      [policy],
      {
        type: "SolTransfer",
        destination: forbiddenDest,
        lamports: 1_000_000n,
      },
      2,
      0n
    );
    assert.strictEqual(resForbidden.passed, false);
    assert.ok(resForbidden.violations[0].includes("not allowlisted"));
  });

  it("should calculate escalation policy threshold and timelock", () => {
    const policy: PolicyAccount = {
      address: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
      policyIndex: 3,
      config: {
        type: "ApprovalEscalation",
        tierAmount: 100_000_000_000n, // 100 SOL
        extraApprovals: 2,
        extraTimelock: 86400n,
      },
      isActive: true,
      createdAt: 1000,
      bump: 255,
    };

    // Below tier
    const resLow = PolicyEvaluator.evaluate(
      [policy],
      {
        type: "SolTransfer",
        destination: Keypair.generate().publicKey,
        lamports: 50_000_000_000n,
      },
      2,
      3600n
    );
    assert.strictEqual(resLow.escalatedThreshold, 2);
    assert.strictEqual(resLow.escalatedTimelock, 3600n);

    // Above tier
    const resHigh = PolicyEvaluator.evaluate(
      [policy],
      {
        type: "SolTransfer",
        destination: Keypair.generate().publicKey,
        lamports: 150_000_000_000n,
      },
      2,
      3600n
    );
    assert.strictEqual(resHigh.escalatedThreshold, 4); // 2 + 2
    assert.strictEqual(resHigh.escalatedTimelock, 3600n + 86400n);
  });

  it("should simulate proposal balance changes and detect warnings", async () => {
    const dest = Keypair.generate().publicKey;
    const vaultAuth = Keypair.generate().publicKey;

    const proposal: ProposalAccount = {
      address: Keypair.generate().publicKey,
      vault: Keypair.generate().publicKey,
      proposalIndex: 0n,
      proposer: Keypair.generate().publicKey,
      title: "Treasury Grant",
      operation: {
        type: "SolTransfer",
        destination: dest,
        lamports: 5_000_000_000n,
      },
      status: ProposalStatus.Active,
      approvalCount: 1,
      requiredThreshold: 2,
      timelockDelay: 0n,
      createdAt: 1000,
      approvedAt: 0,
      executedAt: 0,
      expiresAt: 2000,
      bump: 255,
    };

    // Mock connection
    const mockConn = {} as any;
    const simResult = await SimulationHelper.simulateProposalExecution(
      mockConn,
      proposal,
      [],
      2,
      0n,
      vaultAuth
    );

    assert.strictEqual(simResult.expectedBalanceChanges.length, 2);
    assert.strictEqual(simResult.expectedBalanceChanges[0].deltaLamports, -5_000_000_000);
    assert.strictEqual(simResult.expectedBalanceChanges[1].deltaLamports, 5_000_000_000);
    assert.ok(simResult.warnings.some((w) => w.includes("threshold not yet reached")));
  });

  it("should parse on-chain error codes from logs", () => {
    const errorLogs = [
      "Program 8crGeaqgPRAak8pvSf3YZpDovdTwUrCmfag3YdRM1iYw invoke [1]",
      "Program log: AnchorError caused by account: proposal. Error Code: ThresholdNotMet. Error Number: 6002. Error Message: Proposal required approval threshold has not been reached.",
    ];

    const err = VaultOSError.fromLogs(errorLogs);
    assert.ok(err);
    assert.strictEqual(err.code, "ThresholdNotMet");
    assert.ok(err.message.includes("threshold has not been reached"));
  });
});
