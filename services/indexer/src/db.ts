import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import fs from "node:fs";
import {
  IndexedAuditEvent,
  IndexedMember,
  IndexedOrganization,
  IndexedPolicy,
  IndexedProposal,
  IndexedVault,
  VaultAnalytics,
} from "./types";

export class IndexerDatabase {
  private db: DatabaseSync;

  constructor(dbPath?: string) {
    const finalPath = dbPath || path.join(process.cwd(), "vaultos_indexer.db");
    const dir = path.dirname(finalPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new DatabaseSync(finalPath);
    this.initTables();
  }

  private initTables() {
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      PRAGMA foreign_keys = ON;

      CREATE TABLE IF NOT EXISTS organizations (
        address TEXT PRIMARY KEY,
        org_id TEXT,
        name TEXT,
        admin TEXT,
        vault_count INTEGER,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS vaults (
        address TEXT PRIMARY KEY,
        organization TEXT,
        vault_index INTEGER,
        name TEXT,
        authority_pda TEXT,
        threshold INTEGER,
        member_count INTEGER,
        proposal_count INTEGER,
        policy_count INTEGER,
        timelock_delay INTEGER,
        is_frozen INTEGER,
        sol_balance_lamports INTEGER DEFAULT 0,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS members (
        vault TEXT,
        wallet TEXT,
        roles INTEGER,
        is_active INTEGER,
        added_at INTEGER,
        PRIMARY KEY (vault, wallet)
      );

      CREATE TABLE IF NOT EXISTS proposals (
        address TEXT PRIMARY KEY,
        vault TEXT,
        proposal_index INTEGER,
        proposer TEXT,
        title TEXT,
        operation_type TEXT,
        destination TEXT,
        amount INTEGER,
        mint TEXT,
        status TEXT,
        approval_count INTEGER,
        required_threshold INTEGER,
        timelock_delay INTEGER,
        created_at INTEGER,
        approved_at INTEGER,
        executed_at INTEGER,
        expires_at INTEGER,
        tx_signature TEXT
      );

      CREATE TABLE IF NOT EXISTS approvals (
        proposal TEXT,
        member TEXT,
        approved_at INTEGER,
        tx_signature TEXT,
        PRIMARY KEY (proposal, member)
      );

      CREATE TABLE IF NOT EXISTS policies (
        address TEXT PRIMARY KEY,
        vault TEXT,
        policy_index INTEGER,
        policy_type TEXT,
        config TEXT,
        is_active INTEGER,
        created_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS audit_events (
        id TEXT PRIMARY KEY,
        signature TEXT,
        vault TEXT,
        event_name TEXT,
        actor TEXT,
        block_time INTEGER,
        data TEXT
      );

      CREATE TABLE IF NOT EXISTS checkpoints (
        key TEXT PRIMARY KEY,
        value TEXT
      );
    `);
  }

  // --- Organization ---

  saveOrganization(org: IndexedOrganization) {
    const stmt = this.db.prepare(`
      INSERT INTO organizations (address, org_id, name, admin, vault_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        name = excluded.name,
        vault_count = excluded.vault_count;
    `);
    stmt.run(org.address, org.orgId, org.name, org.admin, org.vaultCount, org.createdAt);
  }

  getOrganizations(): IndexedOrganization[] {
    const stmt = this.db.prepare(`SELECT * FROM organizations ORDER BY created_at DESC`);
    const rows = stmt.all() as any[];
    return rows.map((r) => ({
      address: r.address,
      orgId: r.org_id,
      name: r.name,
      admin: r.admin,
      vaultCount: r.vault_count,
      createdAt: r.created_at,
    }));
  }

  // --- Vault ---

  saveVault(vault: IndexedVault) {
    const stmt = this.db.prepare(`
      INSERT INTO vaults (
        address, organization, vault_index, name, authority_pda,
        threshold, member_count, proposal_count, policy_count,
        timelock_delay, is_frozen, sol_balance_lamports, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        name = excluded.name,
        threshold = excluded.threshold,
        member_count = excluded.member_count,
        proposal_count = excluded.proposal_count,
        policy_count = excluded.policy_count,
        timelock_delay = excluded.timelock_delay,
        is_frozen = excluded.is_frozen,
        sol_balance_lamports = excluded.sol_balance_lamports;
    `);
    stmt.run(
      vault.address,
      vault.organization,
      vault.vaultIndex,
      vault.name,
      vault.authorityPda,
      vault.threshold,
      vault.memberCount,
      vault.proposalCount,
      vault.policyCount,
      vault.timelockDelay,
      vault.isFrozen ? 1 : 0,
      vault.solBalanceLamports,
      vault.createdAt
    );
  }

  getVaults(): IndexedVault[] {
    const stmt = this.db.prepare(`SELECT * FROM vaults ORDER BY created_at DESC`);
    const rows = stmt.all() as any[];
    return rows.map(this.mapVaultRow);
  }

  getVault(address: string): IndexedVault | null {
    const stmt = this.db.prepare(`SELECT * FROM vaults WHERE address = ?`);
    const row = stmt.get(address) as any;
    return row ? this.mapVaultRow(row) : null;
  }

  private mapVaultRow(r: any): IndexedVault {
    return {
      address: r.address,
      organization: r.organization,
      vaultIndex: r.vault_index,
      name: r.name,
      authorityPda: r.authority_pda,
      threshold: r.threshold,
      memberCount: r.member_count,
      proposalCount: r.proposal_count,
      policyCount: r.policy_count,
      timelockDelay: r.timelock_delay,
      isFrozen: Boolean(r.is_frozen),
      solBalanceLamports: r.sol_balance_lamports,
      createdAt: r.created_at,
    };
  }

  // --- Member ---

  saveMember(member: IndexedMember) {
    const stmt = this.db.prepare(`
      INSERT INTO members (vault, wallet, roles, is_active, added_at)
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(vault, wallet) DO UPDATE SET
        roles = excluded.roles,
        is_active = excluded.is_active;
    `);
    stmt.run(
      member.vault,
      member.wallet,
      member.roles,
      member.isActive ? 1 : 0,
      member.addedAt
    );
  }

  getMembers(vaultAddress: string): IndexedMember[] {
    const stmt = this.db.prepare(`SELECT * FROM members WHERE vault = ?`);
    const rows = stmt.all(vaultAddress) as any[];
    return rows.map((r) => {
      const roles = r.roles;
      const roleNames: string[] = [];
      if (roles & 1) roleNames.push("Admin");
      if (roles & 2) roleNames.push("Proposer");
      if (roles & 4) roleNames.push("Approver");
      if (roles & 8) roleNames.push("Executor");
      if (roles & 16) roleNames.push("Guardian");

      return {
        vault: r.vault,
        wallet: r.wallet,
        roles,
        roleNames,
        isActive: Boolean(r.is_active),
        addedAt: r.added_at,
      };
    });
  }

  // --- Proposal ---

  saveProposal(p: IndexedProposal) {
    const stmt = this.db.prepare(`
      INSERT INTO proposals (
        address, vault, proposal_index, proposer, title,
        operation_type, destination, amount, mint, status,
        approval_count, required_threshold, timelock_delay,
        created_at, approved_at, executed_at, expires_at, tx_signature
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        status = excluded.status,
        approval_count = excluded.approval_count,
        approved_at = excluded.approved_at,
        executed_at = excluded.executed_at,
        tx_signature = COALESCE(excluded.tx_signature, proposals.tx_signature);
    `);
    stmt.run(
      p.address,
      p.vault,
      p.proposalIndex,
      p.proposer,
      p.title,
      p.operationType,
      p.destination,
      p.amount,
      p.mint,
      p.status,
      p.approvalCount,
      p.requiredThreshold,
      p.timelockDelay,
      p.createdAt,
      p.approvedAt,
      p.executedAt,
      p.expiresAt,
      p.txSignature || null
    );
  }

  getProposals(vaultAddress: string): IndexedProposal[] {
    const stmt = this.db.prepare(`
      SELECT * FROM proposals WHERE vault = ? ORDER BY proposal_index DESC
    `);
    const rows = stmt.all(vaultAddress) as any[];
    return rows.map(this.mapProposalRow);
  }

  getProposal(address: string): IndexedProposal | null {
    const stmt = this.db.prepare(`SELECT * FROM proposals WHERE address = ?`);
    const row = stmt.get(address) as any;
    return row ? this.mapProposalRow(row) : null;
  }

  private mapProposalRow(r: any): IndexedProposal {
    return {
      address: r.address,
      vault: r.vault,
      proposalIndex: r.proposal_index,
      proposer: r.proposer,
      title: r.title,
      operationType: r.operation_type,
      destination: r.destination,
      amount: r.amount,
      mint: r.mint,
      status: r.status,
      approvalCount: r.approval_count,
      requiredThreshold: r.required_threshold,
      timelockDelay: r.timelock_delay,
      createdAt: r.created_at,
      approvedAt: r.approved_at,
      executedAt: r.executed_at,
      expiresAt: r.expires_at,
      txSignature: r.tx_signature,
    };
  }

  // --- Policy ---

  savePolicy(policy: IndexedPolicy) {
    const stmt = this.db.prepare(`
      INSERT INTO policies (address, vault, policy_index, policy_type, config, is_active, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(address) DO UPDATE SET
        config = excluded.config,
        is_active = excluded.is_active;
    `);
    stmt.run(
      policy.address,
      policy.vault,
      policy.policyIndex,
      policy.policyType,
      JSON.stringify(policy.config),
      policy.isActive ? 1 : 0,
      policy.createdAt
    );
  }

  getPolicies(vaultAddress: string): IndexedPolicy[] {
    const stmt = this.db.prepare(`SELECT * FROM policies WHERE vault = ?`);
    const rows = stmt.all(vaultAddress) as any[];
    return rows.map((r) => ({
      address: r.address,
      vault: r.vault,
      policyIndex: r.policy_index,
      policyType: r.policy_type,
      config: JSON.parse(r.config),
      isActive: Boolean(r.is_active),
      createdAt: r.created_at,
    }));
  }

  // --- Audit Events ---

  saveAuditEvent(event: IndexedAuditEvent): boolean {
    const stmt = this.db.prepare(`
      INSERT INTO audit_events (id, signature, vault, event_name, actor, block_time, data)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO NOTHING;
    `);
    const result = stmt.run(
      event.id,
      event.signature,
      event.vault,
      event.eventName,
      event.actor,
      event.blockTime,
      JSON.stringify(event.data)
    );
    return Number(result.changes) > 0;
  }

  getAuditEvents(vaultAddress?: string, limit: number = 50): IndexedAuditEvent[] {
    let stmt;
    if (vaultAddress) {
      stmt = this.db.prepare(`
        SELECT * FROM audit_events WHERE vault = ? ORDER BY block_time DESC LIMIT ?
      `);
      return (stmt.all(vaultAddress, limit) as any[]).map(this.mapAuditRow);
    } else {
      stmt = this.db.prepare(`
        SELECT * FROM audit_events ORDER BY block_time DESC LIMIT ?
      `);
      return (stmt.all(limit) as any[]).map(this.mapAuditRow);
    }
  }

  private mapAuditRow(r: any): IndexedAuditEvent {
    return {
      id: r.id,
      signature: r.signature,
      vault: r.vault,
      eventName: r.event_name,
      actor: r.actor,
      blockTime: r.block_time,
      data: JSON.parse(r.data || "{}"),
    };
  }

  // --- Analytics ---

  getAnalytics(vaultAddress: string): VaultAnalytics {
    const proposals = this.getProposals(vaultAddress);
    const members = this.getMembers(vaultAddress);
    const policies = this.getPolicies(vaultAddress);

    let totalVolumeLamports = 0;
    let executedProposals = 0;
    let activeProposals = 0;
    let cancelledProposals = 0;

    for (const p of proposals) {
      if (p.status === "Executed") {
        executedProposals++;
        totalVolumeLamports += p.amount;
      } else if (p.status === "Active" || p.status === "Approved" || p.status === "Executable") {
        activeProposals++;
      } else if (p.status === "Cancelled") {
        cancelledProposals++;
      }
    }

    const approvalRate =
      proposals.length > 0 ? (executedProposals / proposals.length) * 100 : 0;

    return {
      vaultAddress,
      totalVolumeLamports,
      totalProposals: proposals.length,
      executedProposals,
      activeProposals,
      cancelledProposals,
      memberCount: members.length,
      policyCount: policies.length,
      approvalRatePercentage: Math.round(approvalRate * 10) / 10,
    };
  }

  getStats(): {
    vaultsCount: number;
    proposalsCount: number;
    membersCount: number;
    policiesCount: number;
    eventsCount: number;
  } {
    const v = (this.db.prepare("SELECT COUNT(*) as c FROM vaults").get() as any)?.c || 0;
    const p = (this.db.prepare("SELECT COUNT(*) as c FROM proposals").get() as any)?.c || 0;
    const m = (this.db.prepare("SELECT COUNT(*) as c FROM members").get() as any)?.c || 0;
    const pol = (this.db.prepare("SELECT COUNT(*) as c FROM policies").get() as any)?.c || 0;
    const e = (this.db.prepare("SELECT COUNT(*) as c FROM audit_events").get() as any)?.c || 0;
    return {
      vaultsCount: Number(v),
      proposalsCount: Number(p),
      membersCount: Number(m),
      policiesCount: Number(pol),
      eventsCount: Number(e),
    };
  }

  getCheckpoint(key: string): string | null {
    const row = this.db.prepare(`SELECT value FROM checkpoints WHERE key = ?`).get(key) as any;
    return row ? String(row.value) : null;
  }

  saveCheckpoint(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO checkpoints (key, value) VALUES (?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value;`
      )
      .run(key, value);
  }
}
