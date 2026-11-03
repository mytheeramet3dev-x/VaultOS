import express, { Request, Response } from "express";
import cors from "cors";
import { IndexerDatabase } from "./db";
import { VaultOSIndexer } from "./indexer";

export function createServer(db: IndexerDatabase, indexer?: VaultOSIndexer) {
  const app = express();

  app.use(cors());
  app.use(express.json());

  // Health check
  app.get("/health", (_req: Request, res: Response) => {
    res.json({
      status: "ok",
      timestamp: Date.now(),
      service: "VaultOS Indexer & API",
      uptimeSeconds: process.uptime(),
    });
  });

  // Prometheus Metrics
  app.get("/metrics", (_req: Request, res: Response) => {
    const stats = db.getStats();
    const mem = process.memoryUsage();
    const uptime = process.uptime();

    const metrics = [
      `# HELP vaultos_indexer_uptime_seconds Indexer uptime in seconds`,
      `# TYPE vaultos_indexer_uptime_seconds gauge`,
      `vaultos_indexer_uptime_seconds ${uptime}`,
      `# HELP vaultos_vaults_total Total indexed vaults`,
      `# TYPE vaultos_vaults_total gauge`,
      `vaultos_vaults_total ${stats.vaultsCount}`,
      `# HELP vaultos_proposals_total Total indexed proposals`,
      `# TYPE vaultos_proposals_total gauge`,
      `vaultos_proposals_total ${stats.proposalsCount}`,
      `# HELP vaultos_members_total Total indexed members`,
      `# TYPE vaultos_members_total gauge`,
      `vaultos_members_total ${stats.membersCount}`,
      `# HELP vaultos_policies_total Total indexed policies`,
      `# TYPE vaultos_policies_total gauge`,
      `vaultos_policies_total ${stats.policiesCount}`,
      `# HELP vaultos_audit_events_total Total indexed audit events`,
      `# TYPE vaultos_audit_events_total counter`,
      `vaultos_audit_events_total ${stats.eventsCount}`,
      `# HELP vaultos_memory_heap_used_bytes Process heap memory used`,
      `# TYPE vaultos_memory_heap_used_bytes gauge`,
      `vaultos_memory_heap_used_bytes ${mem.heapUsed}`,
      `# HELP vaultos_memory_rss_bytes Process RSS memory`,
      `# TYPE vaultos_memory_rss_bytes gauge`,
      `vaultos_memory_rss_bytes ${mem.rss}`,
    ].join("\n");

    res.setHeader("Content-Type", "text/plain; version=0.0.4");
    res.send(metrics + "\n");
  });

  // Organizations
  app.get("/api/orgs", (_req: Request, res: Response) => {
    const orgs = db.getOrganizations();
    res.json(orgs);
  });

  // Vaults
  app.get("/api/vaults", (_req: Request, res: Response) => {
    const vaults = db.getVaults();
    res.json(vaults);
  });

  app.get("/api/vaults/:address", (req: Request, res: Response) => {
    const vault = db.getVault(req.params.address);
    if (!vault) {
      return res.status(404).json({ error: "Vault not found" });
    }
    res.json(vault);
  });

  // Proposals
  app.get("/api/vaults/:address/proposals", (req: Request, res: Response) => {
    const proposals = db.getProposals(req.params.address);
    res.json(proposals);
  });

  app.get("/api/proposals/:address", (req: Request, res: Response) => {
    const proposal = db.getProposal(req.params.address);
    if (!proposal) {
      return res.status(404).json({ error: "Proposal not found" });
    }
    res.json(proposal);
  });

  // Members
  app.get("/api/vaults/:address/members", (req: Request, res: Response) => {
    const members = db.getMembers(req.params.address);
    res.json(members);
  });

  // Policies
  app.get("/api/vaults/:address/policies", (req: Request, res: Response) => {
    const policies = db.getPolicies(req.params.address);
    res.json(policies);
  });

  // Audit Events
  app.get("/api/vaults/:address/audit", (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 50;
    const events = db.getAuditEvents(req.params.address, limit);
    res.json(events);
  });

  app.get("/api/audit", (req: Request, res: Response) => {
    const limit = Number(req.query.limit) || 50;
    const events = db.getAuditEvents(undefined, limit);
    res.json(events);
  });

  // Analytics
  app.get("/api/vaults/:address/analytics", (req: Request, res: Response) => {
    const analytics = db.getAnalytics(req.params.address);
    res.json(analytics);
  });

  // Ingest Event (Webhook / Direct API — Protected by Server-Side API Key Auth, no hardcoded fallback)
  app.post("/api/events/ingest", (req: Request, res: Response) => {
    const expectedApiKey = process.env.INDEXER_API_KEY;
    const headerKey = req.headers["x-api-key"];
    const authHeader = req.headers["authorization"];
    const bearerKey =
      typeof authHeader === "string" && authHeader.startsWith("Bearer ")
        ? authHeader.slice(7).trim()
        : undefined;
    const providedKey = (typeof headerKey === "string" ? headerKey : undefined) || bearerKey;

    if (!expectedApiKey || !providedKey || providedKey !== expectedApiKey) {
      return res.status(401).json({ error: "Unauthorized: Invalid or missing API key" });
    }

    const { signature, eventName, vault, actor, data, blockTime } = req.body;
    if (!signature || !eventName || !vault) {
      return res.status(400).json({ error: "Missing required event fields" });
    }

    if (indexer) {
      indexer.ingestEvent(signature, eventName, vault, actor || "unknown", data || {}, blockTime);
    }
    res.json({ success: true, eventId: `${signature}_${eventName}` });
  });

  return app;
}
