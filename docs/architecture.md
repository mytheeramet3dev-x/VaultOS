# VaultOS Architecture

VaultOS is a production-grade, non-custodial treasury management and governance operating system built natively on Solana.

```
+-----------------------------------------------------------------------------------+
|                                  CLIENT LAYER                                     |
|                                                                                   |
|   +-----------------------------+        +------------------------------------+   |
|   |    Institutional Web UI     |        |          TypeScript SDK            |   |
|   |      (Next.js 14 / React)   |        |           (@vaultos/sdk)           |   |
|   +--------------+--------------+        +-----------------+------------------+   |
|                  |                                         |                      |
+------------------|-----------------------------------------|----------------------+
                   | RPC Requests / Transactions             |
                   v                                         v
+-----------------------------------------------------------------------------------+
|                             SOLANA BLOCKCHAIN LAYER                               |
|                                                                                   |
|   +---------------------------------------------------------------------------+   |
|   |                        VaultOS Anchor Program                             |   |
|   |              (ID: 8crGeaqgPRAak8pvSf3YZpDovdTwUrCmfag3YdRM1iYw)           |   |
|   +-------------------------------------+-------------------------------------+   |
|                                         |                                         |
|                 +-----------------------+-----------------------+                 |
|                 |                                               |                 |
|                 v                                               v                 |
|       +-------------------+                           +-------------------+       |
|       |     State PDAs    |                           | Vault Authority   |       |
|       |  Organization     |                           |       PDA         |       |
|       |  Vault            |                           +---------+---------+       |
|       |  Member (Roles)   |                                     |                 |
|       |  Proposal         |                                     | Seeds Signing   |
|       |  Approval         |                                     v                 |
|       |  Policy Engine    |                           +-------------------+       |
|       |  Execution Record |                           | Native SOL & SPL  |       |
|       +-------------------+                           |  Token Accounts   |       |
|                                                       +-------------------+       |
+-----------------------------------------------------------------------------------+
                                          |
                                          | Event Streaming (Logs / Blocks)
                                          v
+-----------------------------------------------------------------------------------+
|                              INDEXER & API LAYER                                  |
|                                                                                   |
|   +------------------------+        +-------------------+     +---------------+   |
|   |     Event Ingestion    | -----> |  SQLite / Postgres| --> | Express API   |   |
|   |  & Reconciliation Job  |        |      Storage      |     |  Endpoints    |   |
|   +------------------------+        +-------------------+     +---------------+   |
+-----------------------------------------------------------------------------------+
```

## System Layers

### 1. Solana Program Layer (`programs/vaultos`)
The authoritative source of truth. Written in Rust using Anchor 1.2.0. Enforces all multisig invariants, timelocks, spending limits, allowlists, and idempotent execution.

### 2. Treasury Vault Authority PDA
A deterministic program-derived address (`seeds = ["vault_authority", vault.key()]`). It has exclusive authority over vault-controlled lamports and SPL token accounts. No backend, keeper, or frontend ever holds private keys.

### 3. TypeScript SDK (`@vaultos/sdk`)
Typed client library providing deterministic PDA derivation, instruction builders, typed error mapping, and pre-flight simulation helpers.

### 4. Indexer Service (`services/indexer`)
Derived data indexing service providing queryable REST endpoints for proposals, active policies, historical executions, member directories, and audit event logs.

### 5. Institutional Web Application (`apps/web`)
Next.js 14 application featuring institutional dark-mode UX, multi-role wallet switcher, interactive proposal workflow, real-time policy warnings, and audit inspection.
