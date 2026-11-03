# VaultOS

> **Production-grade on-chain treasury, multisig, policy, and governance operating system for Solana.**

VaultOS is a non-custodial treasury management protocol and operating system built on Solana. It enables protocols, DAOs, startups, and investment teams to hold and manage digital assets through programmable vaults without giving any backend server unilateral custody of funds.

---

## Architecture Overview

```
Wallets / Applications
   |
   v
VaultOS Web Dashboard (Next.js 14)
   |
   +------> TypeScript SDK (@vaultos/sdk)
                 |
                 v
          Solana RPC / Program (8crGeaqgPRAak8pvSf3YZpDovdTwUrCmfag3YdRM1iYw)
                 |
        +--------+---------+
        |                  |
        v                  v
   VaultOS PDAs      SPL Token Accounts
        |
        v
  Controlled External CPI

Solana Events / Transactions
        |
        v
Indexer & SQLite Storage (Port 4000)
        |
        v
Queryable History / Analytics / Alerts
```

---

## Core Capabilities

- **Secure Shared Custody**: Configurable $M$-of-$N$ threshold multisig authorization.
- **Deterministic Account Model**: Exclusive control via the `Vault Authority` PDA (`seeds = [b"vault_authority", vault.key()]`).
- **Granular Role Bitflags**: Explicit on-chain permissions:
  - `ROLE_ADMIN = 1`
  - `ROLE_PROPOSER = 2`
  - `ROLE_APPROVER = 4`
  - `ROLE_EXECUTOR = 8`
- **Programmable Spending Policies**:
  - Per-transaction volume caps
  - 24-hour rolling window limits
  - Destination wallet allowlists
  - Token asset allowlists
  - Approval escalation tiers
- **Timelocks & Emergency Controls**:
  - Enforced delays between approval and execution for sensitive transactions.
  - Emergency freeze controls to immediately halt unauthorized outflows.
- **Idempotent Execution**:
  - Persistent `ExecutionRecord` PDA guarantees a proposal cannot be executed more than once.
- **Simulation Engine**:
  - Client-side pre-flight simulation helper computing expected balance deltas and policy checks before wallet signing.
- **Complete Audit Trail**:
  - Emitted Anchor events ingested into a queryable REST API and searchable dashboard timeline.

---

## Monorepo Layout

```
vaultos/
├── programs/
│   └── vaultos/                # On-chain Anchor Solana Program
│       ├── src/
│       │   ├── lib.rs          # Instruction endpoints & dispatch
│       │   ├── state/          # Account definitions & layouts
│       │   ├── instructions/   # Instruction handlers
│       │   ├── policies/       # Deterministic policy engine
│       │   ├── errors.rs       # Custom error codes
│       │   └── events.rs       # Structured audit events
│
├── sdk/                        # TypeScript SDK (@vaultos/sdk)
│   ├── src/
│   │   ├── client.ts           # High-level client API
│   │   ├── pda.ts              # Deterministic PDA derivations
│   │   ├── types.ts            # Type definitions
│   │   ├── policy.ts           # Client-side policy evaluator
│   │   └── simulation.ts       # Pre-flight transaction simulation
│
├── services/
│   └── indexer/                # Event indexer & REST API service
│       ├── src/
│       │   ├── indexer.ts      # Event parser & reconciliation
│       │   ├── db.ts           # SQLite persistent storage
│       │   └── server.ts       # Express REST endpoints
│
├── apps/
│   └── web/                    # Institutional Next.js Dashboard
│       ├── app/                # Overview, Proposals, Members, Policies, Audit
│       ├── components/         # Navbar, Sidebar, Modals, Proposal Cards
│       └── context/            # Multi-role Wallet & Treasury contexts
│
├── tests/
│   ├── integration/            # Full treasury lifecycle integration test
│   └── adversarial/            # All 11 critical invariants security suite
│
├── docs/                       # Architecture, Account Model, Security, Threat Model, Deployment
└── .github/workflows/ci.yml    # Continuous Integration pipeline
```

---

## Quickstart

### 1. Build and Run Tests

```bash
# Run Rust unit tests for policy engine & state
cargo test --manifest-path programs/vaultos/Cargo.toml

# Build and test TypeScript SDK
npm --prefix sdk run build
npm --prefix sdk test

# Run full integration and adversarial security invariant tests
node --import ts-node/register/transpile-only --test \
  tests/integration/full_lifecycle.test.ts \
  tests/adversarial/security_invariants.test.ts
```

### 2. Start the Indexer & API Service

```bash
npm --prefix services/indexer run build
npm --prefix services/indexer start
```
API endpoints will be live at `http://localhost:4000`:
- `GET /health`
- `GET /api/vaults`
- `GET /api/vaults/:address/proposals`
- `GET /api/audit`
- `GET /api/vaults/:address/analytics`

### 3. Start the Web Dashboard

```bash
npm --prefix apps/web run dev
```
Navigate to `http://localhost:3000` to interact with the dashboard. Use the built-in role switcher in the navbar to test as Admin, Proposer, Approver, or Executor!

---

## TypeScript SDK Usage Example

```typescript
import { Connection, Keypair } from "@solana/web3.js";
import { VaultOSClient, RoleBitflags } from "@vaultos/sdk";

const connection = new Connection("http://127.0.0.1:8899", "confirmed");
const adminKeypair = Keypair.generate();

const client = new VaultOSClient(connection, adminKeypair);

// 1. Create Organization & Vault
const { organization } = await client.createOrganization({
  orgId: "defi-collective",
  name: "DeFi Collective",
});

const { vault, vaultAuthority } = await client.createVault({
  organization,
  vaultIndex: 0,
  name: "Core Treasury",
  threshold: 2, // 2-of-3 multisig
  timelockDelay: 0,
});

// 2. Propose SOL Transfer
const { proposal } = await client.createSolTransferProposal({
  vault,
  proposalIndex: 0n,
  title: "Security Audit Grant",
  destination: recipientPubkey,
  lamports: 25_000_000_000n, // 25 SOL
});

// 3. Approve and Execute
await client.approveProposal({ vault, proposal });
await client.executeProposal({ vault, proposal });
```

---

## Verification & Invariant Proofs

The test suite validates all 11 critical security invariants:
1. `Only the vault authority PDA can move vault-controlled assets.`
2. `A proposal cannot execute without its required approvals (M).`
3. `A signer cannot create multiple approvals for one proposal revision.`
4. `A proposal cannot execute more than once (Idempotent witness).`
5. `A cancelled or expired proposal cannot execute.`
6. `A frozen vault cannot execute prohibited treasury operations.`
7. `A timelocked proposal cannot execute early.`
8. `A transfer cannot exceed an enforced spending policy.`
9. `A transfer cannot exceed a rolling 24-hour spending window.`
10. `A transfer to an unapproved destination is rejected when allowlist is active.`
11. `Removing a member prevents future privileged actions by that member.`

---

## License

Apache-2.0
