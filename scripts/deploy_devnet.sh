#!/usr/bin/env bash
set -euo pipefail

echo "=========================================="
echo "🛡️  VaultOS Solana Devnet Deployment"
echo "=========================================="

if ! command -v solana &> /dev/null; then
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi

RPC_URL="${SOLANA_RPC_URL:-https://api.devnet.solana.com}"
solana config set --url "$RPC_URL"

DEPLOYER_PUBKEY=$(solana address)
BALANCE=$(solana balance | awk '{print $1}')
echo "Deployer Wallet : $DEPLOYER_PUBKEY"
echo "Current Balance : $BALANCE SOL (Devnet)"

PROGRAM_KEYPAIR="target/deploy/vaultos-keypair.json"
PROGRAM_SO="target/deploy/vaultos.so"
PROGRAM_ID=$(solana-keygen pubkey "$PROGRAM_KEYPAIR")

echo "Target Program  : $PROGRAM_ID"
echo "Building SBF release binary..."
cargo build-sbf --manifest-path programs/vaultos/Cargo.toml

echo "Deploying $PROGRAM_SO to Solana Devnet..."
solana program deploy "$PROGRAM_SO" \
  --program-id "$PROGRAM_KEYPAIR" \
  --url "$RPC_URL" \
  --with-compute-unit-price 1000

echo "✅ Successfully deployed VaultOS to Devnet: $PROGRAM_ID"
