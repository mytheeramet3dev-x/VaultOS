# VaultOS Account & PDA Model

Every state transition in VaultOS is governed by deterministic Program Derived Addresses (PDAs) with explicit on-chain seed and bump constraints.

## PDA Seed Matrix

| Account | Seed Formulation | Description |
| :--- | :--- | :--- |
| **Organization** | `["organization", org_id]` | Top-level entity defining vault groupings |
| **Vault** | `["vault", organization, vault_index_le_bytes]` | Central treasury configuration object |
| **Vault Authority** | `["vault_authority", vault]` | Sole owner of lamports & token accounts |
| **Member** | `["member", vault, wallet]` | Member role bitmask and active status |
| **Proposal** | `["proposal", vault, proposal_index_le_bytes]` | Immutable requested operation payload |
| **Approval** | `["approval", proposal, member_wallet]` | Single on-chain approval record |
| **Policy** | `["policy", vault, policy_index_le_bytes]` | Programmable spending policy rule |
| **Execution Record** | `["execution", proposal]` | Persistent idempotency witness |

## Role Bitmask Formulation

Roles are stored on-chain as a compact 1-byte bitmask (`u8`), allowing flexible role combinations:

```rust
pub const ROLE_ADMIN: u8 = 1 << 0;     // 0b0001 (1)
pub const ROLE_PROPOSER: u8 = 1 << 1;  // 0b0010 (2)
pub const ROLE_APPROVER: u8 = 1 << 2;  // 0b0100 (4)
pub const ROLE_EXECUTOR: u8 = 1 << 3;  // 0b1000 (8)
```

- **Admin (1)**: Can create/update policies, add/remove members, and trigger emergency freeze controls.
- **Proposer (2)**: Can submit treasury transfer and configuration proposals.
- **Approver (4)**: Can sign on-chain approvals towards the $M$-of-$N$ threshold.
- **Executor (8)**: Can trigger proposal execution once threshold, timelock, and policies are satisfied.
