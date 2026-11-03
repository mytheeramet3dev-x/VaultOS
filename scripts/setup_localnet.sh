#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "🛡️  VaultOS Localnet Environment Setup"
echo "=========================================="

# Check Solana CLI
if ! command -v solana &> /dev/null; then
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi

solana config set --url http://127.0.0.1:8899

PROGRAM_KEYPAIR="target/deploy/vaultos-keypair.json"
PROGRAM_SO="target/deploy/vaultos.so"

echo "Building VaultOS Solana program..."
cargo build-sbf --manifest-path programs/vaultos/Cargo.toml

echo "Deploying VaultOS to localnet..."
solana program deploy "$PROGRAM_SO" --program-id "$PROGRAM_KEYPAIR"

PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")
echo "✅ Deployed VaultOS program ID: $PROGRAM_ID"

echo "Setup complete! Ready for indexer and frontend."
