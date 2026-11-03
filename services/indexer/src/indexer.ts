import { Connection, PublicKey } from "@solana/web3.js";
import { IndexerDatabase } from "./db";

export class VaultOSIndexer {
  private isRunning: boolean = false;
  private pollIntervalMs: number = 3000;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    public readonly connection: Connection,
    public readonly db: IndexerDatabase,
    public readonly programId: PublicKey
  ) {}

  async start() {
    if (this.isRunning) return;
    this.isRunning = true;
    console.log(`[Indexer] Starting indexer for program: ${this.programId.toBase58()}`);

    // Initial sync
    await this.syncRecentTransactions();

    // Start polling loop
    this.timer = setInterval(async () => {
      try {
        await this.syncRecentTransactions();
      } catch (err: any) {
        console.error(`[Indexer] Error during sync:`, err.message);
      }
    }, this.pollIntervalMs);
  }

  stop() {
    this.isRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    console.log(`[Indexer] Stopped indexer`);
  }

  async syncRecentTransactions() {
    try {
      const lastCheckpoint = this.db.getCheckpoint("last_signature") || undefined;
      const allSignatures: Awaited<ReturnType<Connection["getSignaturesForAddress"]>> = [];
      let beforeCursor: string | undefined = undefined;
      const PAGE_LIMIT = 100;
      const MAX_PAGES = 10;

      for (let page = 0; page < MAX_PAGES; page++) {
        const batch = await this.connection.getSignaturesForAddress(
          this.programId,
          { limit: PAGE_LIMIT, before: beforeCursor, until: lastCheckpoint },
          "confirmed"
        );
        if (batch.length === 0) break;
        allSignatures.push(...batch);
        if (batch.length < PAGE_LIMIT) break;
        beforeCursor = batch[batch.length - 1].signature;
      }

      // Process oldest-to-newest so state updates happen in causal order
      const ordered = [...allSignatures].reverse();
      for (const sigInfo of ordered) {
        if (sigInfo.err) continue;

        const tx = await this.connection.getParsedTransaction(sigInfo.signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });

        if (!tx || !tx.meta || !tx.meta.logMessages) continue;

        this.processLogs(
          sigInfo.signature,
          tx.blockTime || Math.floor(Date.now() / 1000),
          tx.meta.logMessages
        );
        this.db.saveCheckpoint("last_signature", sigInfo.signature);
      }
    } catch (err: any) {
      // In localnet / test mode, RPC might be offline; catch gracefully
    }
  }

  static getEventDiscriminator(eventName: string): Buffer {
    const crypto = require("crypto");
    return crypto.createHash("sha256").update(`event:${eventName}`).digest().slice(0, 8);
  }

  private readBorshString(buf: Buffer, offset: number): { value: string; next: number } {
    const len = buf.readUInt32LE(offset);
    const start = offset + 4;
    return {
      value: buf.slice(start, start + len).toString("utf8"),
      next: start + len,
    };
  }

  private readPubkey(buf: Buffer, offset: number): { value: string; next: number } {
    return {
      value: new PublicKey(buf.slice(offset, offset + 32)).toBase58(),
      next: offset + 32,
    };
  }

  processLogs(signature: string, blockTime: number, logs: string[]) {
    const EVENT_NAMES = [
      "OrganizationCreated",
      "VaultCreated",
      "MemberAdded",
      "MemberRemoved",
      "MemberRolesUpdated",
      "ProposalCreated",
      "ProposalApproved",
      "ProposalApprovalRevoked",
      "ProposalCancelled",
      "ProposalExecuted",
      "PolicyCreated",
      "PolicyUpdated",
      "PolicyRemoved",
      "VaultFrozen",
      "VaultUnfrozen",
      "DepositReceived",
    ];
    const OP_TYPE_NAMES: Record<number, string> = {
      1: "SolTransfer",
      2: "TokenTransfer",
      3: "AddMember",
      4: "RemoveMember",
      5: "ChangeThreshold",
      6: "SetTimelock",
      7: "SetFrozen",
      8: "CpiCall",
    };
    const POLICY_TYPE_NAMES: Record<number, string> = {
      1: "PerTransactionLimit",
      2: "RollingSpendingLimit",
      3: "DestinationAllowlist",
      4: "AssetAllowlist",
      5: "ProgramAllowlist",
      6: "ApprovalEscalation",
    };

    const programStack: string[] = [];
    const targetProgramId = this.programId.toBase58();
    const invokeRegex = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) invoke \[\d+\]$/;
    const finishRegex = /^Program ([1-9A-HJ-NP-Za-km-z]{32,44}) (?:success|failed: .*)$/;

    for (let logIndex = 0; logIndex < logs.length; logIndex++) {
      const log = logs[logIndex];

      const invokeMatch = log.match(invokeRegex);
      if (invokeMatch) {
        programStack.push(invokeMatch[1]);
        continue;
      }

      const finishMatch = log.match(finishRegex);
      if (finishMatch) {
        if (
          programStack.length > 0 &&
          programStack[programStack.length - 1] === finishMatch[1]
        ) {
          programStack.pop();
        }
        continue;
      }

      if (!log.startsWith("Program data: ")) continue;

      // H4: Reject spoofed Anchor events emitted while a foreign program is on top of the CPI call stack
      if (
        programStack.length > 0 &&
        programStack[programStack.length - 1] !== targetProgramId
      ) {
        continue;
      }

      const b64 = log.slice("Program data: ".length).trim();
      let buf: Buffer;
      try {
        buf = Buffer.from(b64, "base64");
      } catch {
        continue;
      }
      if (buf.length < 8) continue;

      const disc = buf.slice(0, 8);
      const matchedEvent = EVENT_NAMES.find((name) =>
        VaultOSIndexer.getEventDiscriminator(name).equals(disc)
      );
      if (!matchedEvent) continue;

      try {
        let c = 8;
        switch (matchedEvent) {
          case "OrganizationCreated": {
            const org = this.readPubkey(buf, c); c = org.next;
            const orgId = this.readBorshString(buf, c); c = orgId.next;
            const name = this.readBorshString(buf, c); c = name.next;
            const admin = this.readPubkey(buf, c); c = admin.next;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "OrganizationCreated",
              org.value,
              admin.value,
              { organization: org.value, orgId: orgId.value, name: name.value },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "VaultCreated": {
            const org = this.readPubkey(buf, c); c = org.next;
            const vault = this.readPubkey(buf, c); c = vault.next;
            const vaultAuth = this.readPubkey(buf, c); c = vaultAuth.next;
            const vaultIndex = buf.readUInt32LE(c); c += 4;
            const name = this.readBorshString(buf, c); c = name.next;
            const threshold = buf.readUInt16LE(c); c += 2;
            const timelockDelay = Number(buf.readBigInt64LE(c)); c += 8;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "VaultCreated",
              vault.value,
              vaultAuth.value,
              {
                organization: org.value,
                vault: vault.value,
                vaultAuthority: vaultAuth.value,
                vaultIndex,
                name: name.value,
                threshold,
                timelockDelay,
              },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "MemberAdded": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const member = this.readPubkey(buf, c); c = member.next;
            const roles = buf.readUInt8(c); c += 1;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "MemberAdded",
              vault.value,
              member.value,
              { member: member.value, roles },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "MemberRemoved": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const member = this.readPubkey(buf, c); c = member.next;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "MemberRemoved",
              vault.value,
              member.value,
              { member: member.value },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "MemberRolesUpdated": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const member = this.readPubkey(buf, c); c = member.next;
            const newRoles = buf.readUInt8(c); c += 1;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "MemberRolesUpdated",
              vault.value,
              member.value,
              { member: member.value, newRoles },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "ProposalCreated": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const proposal = this.readPubkey(buf, c); c = proposal.next;
            const proposalIndex = Number(buf.readBigUInt64LE(c)); c += 8;
            const proposer = this.readPubkey(buf, c); c = proposer.next;
            const title = this.readBorshString(buf, c); c = title.next;
            const operationTypeId = buf.readUInt8(c); c += 1;
            const destination = this.readPubkey(buf, c); c = destination.next;
            const amount = Number(buf.readBigUInt64LE(c)); c += 8;
            const hasMint = buf.readUInt8(c) !== 0; c += 1;
            let mint: string | null = null;
            if (hasMint) {
              const m = this.readPubkey(buf, c);
              mint = m.value;
              c = m.next;
            }
            const requiredThreshold = buf.readUInt16LE(c); c += 2;
            const timelockDelay = Number(buf.readBigInt64LE(c)); c += 8;
            const expiresAt = Number(buf.readBigInt64LE(c)); c += 8;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "ProposalCreated",
              vault.value,
              proposer.value,
              {
                proposal: proposal.value,
                proposalIndex,
                title: title.value,
                operationType: OP_TYPE_NAMES[operationTypeId] || "SolTransfer",
                destination: destination.value,
                amount,
                mint,
                requiredThreshold,
                timelockDelay,
                expiresAt,
              },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "ProposalApproved": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const proposal = this.readPubkey(buf, c); c = proposal.next;
            const approver = this.readPubkey(buf, c); c = approver.next;
            const currentApprovals = buf.readUInt16LE(c); c += 2;
            const requiredThreshold = buf.readUInt16LE(c); c += 2;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "ProposalApproved",
              vault.value,
              approver.value,
              { proposal: proposal.value, currentApprovals, requiredThreshold },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "ProposalApprovalRevoked": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const proposal = this.readPubkey(buf, c); c = proposal.next;
            const member = this.readPubkey(buf, c); c = member.next;
            const currentApprovals = buf.readUInt16LE(c); c += 2;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "ProposalApprovalRevoked",
              vault.value,
              member.value,
              { proposal: proposal.value, currentApprovals },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "ProposalCancelled": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const proposal = this.readPubkey(buf, c); c = proposal.next;
            const cancelledBy = this.readPubkey(buf, c); c = cancelledBy.next;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "ProposalCancelled",
              vault.value,
              cancelledBy.value,
              { proposal: proposal.value },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "ProposalExecuted": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const proposal = this.readPubkey(buf, c); c = proposal.next;
            const executor = this.readPubkey(buf, c); c = executor.next;
            const operationType = buf.readUInt8(c); c += 1;
            const destination = this.readPubkey(buf, c); c = destination.next;
            const amount = Number(buf.readBigUInt64LE(c)); c += 8;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "ProposalExecuted",
              vault.value,
              executor.value,
              {
                proposal: proposal.value,
                operationType,
                destination: destination.value,
                amount,
              },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "PolicyCreated": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const policy = this.readPubkey(buf, c); c = policy.next;
            const policyIndex = buf.readUInt16LE(c); c += 2;
            const policyTypeId = buf.readUInt8(c); c += 1;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "PolicyCreated",
              vault.value,
              policy.value,
              {
                policy: policy.value,
                policyIndex,
                policyType: POLICY_TYPE_NAMES[policyTypeId] || "Custom",
              },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "PolicyUpdated": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const policy = this.readPubkey(buf, c); c = policy.next;
            const policyIndex = buf.readUInt16LE(c); c += 2;
            const policyTypeId = buf.readUInt8(c); c += 1;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "PolicyUpdated",
              vault.value,
              policy.value,
              {
                policy: policy.value,
                policyIndex,
                policyType: POLICY_TYPE_NAMES[policyTypeId] || "Custom",
              },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "PolicyRemoved": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const policy = this.readPubkey(buf, c); c = policy.next;
            const policyIndex = buf.readUInt16LE(c); c += 2;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "PolicyRemoved",
              vault.value,
              policy.value,
              { policy: policy.value, policyIndex },
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "VaultFrozen": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const frozenBy = this.readPubkey(buf, c); c = frozenBy.next;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "VaultFrozen",
              vault.value,
              frozenBy.value,
              {},
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "VaultUnfrozen": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const unfrozenBy = this.readPubkey(buf, c); c = unfrozenBy.next;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "VaultUnfrozen",
              vault.value,
              unfrozenBy.value,
              {},
              ts || blockTime,
              logIndex
            );
            break;
          }
          case "DepositReceived": {
            const vault = this.readPubkey(buf, c); c = vault.next;
            const depositor = this.readPubkey(buf, c); c = depositor.next;
            const hasMint = buf.readUInt8(c) !== 0; c += 1;
            let mint: string | null = null;
            if (hasMint) {
              const m = this.readPubkey(buf, c);
              mint = m.value;
              c = m.next;
            }
            const amount = Number(buf.readBigUInt64LE(c)); c += 8;
            const ts = Number(buf.readBigInt64LE(c));
            this.ingestEvent(
              signature,
              "DepositReceived",
              vault.value,
              depositor.value,
              { mint, amount },
              ts || blockTime,
              logIndex
            );
            break;
          }
        }
      } catch {
        // Ignore malformed log line
      }
    }
  }

  /**
   * Directly ingest an event (e.g. from tests, SDK, or RPC log decoder)
   */
  ingestEvent(
    signature: string,
    eventName: string,
    vault: string,
    actor: string,
    data: Record<string, any>,
    blockTime: number = Math.floor(Date.now() / 1000),
    logIndex: number = 0
  ) {
    const eventId = `${signature}_${eventName}_${vault}_${logIndex}`;
    const isNew = this.db.saveAuditEvent({
      id: eventId,
      signature,
      vault,
      eventName,
      actor,
      blockTime,
      data,
    });
    if (!isNew) {
      return; // Idempotent ingestion: skip state mutation on duplicate delivery
    }

    // Update entity tables based on event
    switch (eventName) {
      case "OrganizationCreated":
        this.db.saveOrganization({
          address: data.organization,
          orgId: data.orgId,
          name: data.name,
          admin: actor,
          vaultCount: 0,
          createdAt: blockTime,
        });
        break;

      case "VaultCreated":
        this.db.saveVault({
          address: data.vault,
          organization: data.organization,
          vaultIndex: data.vaultIndex,
          name: data.name,
          authorityPda: data.vaultAuthority,
          threshold: data.threshold,
          memberCount: 1,
          proposalCount: 0,
          policyCount: 0,
          timelockDelay: data.timelockDelay || 0,
          isFrozen: false,
          solBalanceLamports: 0,
          createdAt: blockTime,
        });
        break;

      case "MemberAdded": {
        this.db.saveMember({
          vault,
          wallet: data.member,
          roles: data.roles,
          roleNames: [],
          isActive: true,
          addedAt: blockTime,
        });
        const v = this.db.getVault(vault);
        if (v) {
          v.memberCount = this.db.getMembers(vault).filter((m) => m.isActive).length;
          this.db.saveVault(v);
        }
        break;
      }

      case "MemberRemoved": {
        this.db.saveMember({
          vault,
          wallet: data.member,
          roles: 0,
          roleNames: [],
          isActive: false,
          addedAt: blockTime,
        });
        const v = this.db.getVault(vault);
        if (v) {
          v.memberCount = this.db.getMembers(vault).filter((m) => m.isActive).length;
          this.db.saveVault(v);
        }
        break;
      }

      case "MemberRolesUpdated": {
        this.db.saveMember({
          vault,
          wallet: data.member,
          roles: data.newRoles,
          roleNames: [],
          isActive: true,
          addedAt: blockTime,
        });
        break;
      }

      case "ProposalCreated":
        this.db.saveProposal({
          address: data.proposal,
          vault,
          proposalIndex: data.proposalIndex,
          proposer: actor,
          title: data.title,
          operationType: data.operationType || "SolTransfer",
          destination: data.destination,
          amount: data.amount,
          mint: data.mint || null,
          status: "Active",
          approvalCount: 0,
          requiredThreshold: data.requiredThreshold,
          timelockDelay: data.timelockDelay || 0,
          createdAt: blockTime,
          approvedAt: 0,
          executedAt: 0,
          expiresAt: data.expiresAt || blockTime + 7 * 86400,
          txSignature: signature,
        });
        break;

      case "ProposalApproved": {
        const prop = this.db.getProposal(data.proposal);
        if (prop) {
          prop.approvalCount = data.currentApprovals;
          if (prop.approvalCount >= prop.requiredThreshold) {
            prop.status = prop.timelockDelay === 0 ? "Executable" : "Approved";
            prop.approvedAt = blockTime;
          }
          this.db.saveProposal(prop);
        }
        break;
      }

      case "ProposalApprovalRevoked": {
        const prop = this.db.getProposal(data.proposal);
        if (prop) {
          prop.approvalCount = data.currentApprovals;
          if (prop.approvalCount < prop.requiredThreshold) {
            prop.status = "Active";
            prop.approvedAt = 0;
          }
          this.db.saveProposal(prop);
        }
        break;
      }

      case "ProposalCancelled": {
        const prop = this.db.getProposal(data.proposal);
        if (prop) {
          prop.status = "Cancelled";
          this.db.saveProposal(prop);
        }
        break;
      }

      case "PolicyCreated":
      case "PolicyUpdated": {
        this.db.savePolicy({
          address: data.policy,
          vault,
          policyIndex: data.policyIndex,
          policyType: data.policyType || "Custom",
          config: data,
          isActive: true,
          createdAt: blockTime,
        });
        const v = this.db.getVault(vault);
        if (v) {
          v.policyCount = this.db.getPolicies(vault).filter((p) => p.isActive).length;
          this.db.saveVault(v);
        }
        break;
      }

      case "PolicyRemoved": {
        this.db.savePolicy({
          address: data.policy,
          vault,
          policyIndex: data.policyIndex,
          policyType: "Removed",
          config: data,
          isActive: false,
          createdAt: blockTime,
        });
        const v = this.db.getVault(vault);
        if (v) {
          v.policyCount = this.db.getPolicies(vault).filter((p) => p.isActive).length;
          this.db.saveVault(v);
        }
        break;
      }

      case "ProposalExecuted": {
        const prop = this.db.getProposal(data.proposal);
        if (prop) {
          prop.status = "Executed";
          prop.executedAt = blockTime;
          prop.txSignature = signature;
          this.db.saveProposal(prop);
          if (prop.operationType === "SolTransfer" || !prop.mint) {
            const v = this.db.getVault(vault);
            if (v) {
              v.solBalanceLamports = Math.max(0, v.solBalanceLamports - prop.amount);
              this.db.saveVault(v);
            }
          }
        }
        break;
      }

      case "VaultFrozen": {
        const v = this.db.getVault(vault);
        if (v) {
          v.isFrozen = true;
          this.db.saveVault(v);
        }
        break;
      }

      case "VaultUnfrozen": {
        const v = this.db.getVault(vault);
        if (v) {
          v.isFrozen = false;
          this.db.saveVault(v);
        }
        break;
      }

      case "DepositReceived": {
        const v = this.db.getVault(vault);
        if (v && (!data.mint || data.mint === "SOL")) {
          v.solBalanceLamports += data.amount;
          this.db.saveVault(v);
        }
        break;
      }
    }
  }
}
