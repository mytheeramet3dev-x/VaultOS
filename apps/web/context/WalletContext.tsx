"use client";

import React, { createContext, useContext, useState, useEffect } from "react";
import { PublicKey } from "@solana/web3.js";

export interface DemoWallet {
  id: string;
  name: string;
  address: string;
  roles: string[];
  roleMask: number; // 1 = Admin, 2 = Proposer, 4 = Approver, 8 = Executor
}

export const DEMO_WALLETS: DemoWallet[] = [
  {
    id: "alice",
    name: "Alice (Admin)",
    address: "AL1CE7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ2k",
    roles: ["Admin", "Proposer", "Approver", "Executor"],
    roleMask: 15,
  },
  {
    id: "bob",
    name: "Bob (Approver)",
    address: "B0B88K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ3m",
    roles: ["Approver"],
    roleMask: 4,
  },
  {
    id: "charlie",
    name: "Charlie (Approver & Executor)",
    address: "CH4RL1E7K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ4n",
    roles: ["Approver", "Executor"],
    roleMask: 12,
  },
  {
    id: "dave",
    name: "Dave (Viewer)",
    address: "D4V399K7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ5p",
    roles: ["Viewer"],
    roleMask: 0,
  },
];

interface WalletContextType {
  activeWallet: DemoWallet;
  setActiveWallet: (w: DemoWallet) => void;
  network: "localnet" | "devnet";
  setNetwork: (n: "localnet" | "devnet") => void;
  selectedVaultAddress: string;
  setSelectedVaultAddress: (addr: string) => void;
  isBrowserWalletConnected: boolean;
  connectBrowserWallet: () => Promise<void>;
  disconnectBrowserWallet: () => void;
}

const WalletContext = createContext<WalletContextType | undefined>(undefined);

export function WalletProvider({ children }: { children: React.ReactNode }) {
  const [activeWallet, setActiveWallet] = useState<DemoWallet>(DEMO_WALLETS[0]);
  const [network, setNetwork] = useState<"localnet" | "devnet">("localnet");
  const [selectedVaultAddress, setSelectedVaultAddress] = useState<string>(
    "9vau1tK7ZkK2n1N4eP2oW8yT7qR6vM3bC5dE9fG1hJ9z"
  );
  const [isBrowserWalletConnected, setIsBrowserWalletConnected] = useState(false);

  const connectBrowserWallet = async () => {
    try {
      const anyWindow = typeof window !== "undefined" ? (window as any) : null;
      const solana = anyWindow?.solana || anyWindow?.phantom?.solana;
      if (!solana) {
        alert("No Solana browser wallet found. Please install Phantom or Solflare.");
        return;
      }
      const response = await solana.connect();
      const pubkeyStr = response?.publicKey ? response.publicKey.toString() : solana.publicKey?.toString();
      if (pubkeyStr) {
        const knownMember = DEMO_WALLETS.find((w) => w.address === pubkeyStr);
        const browserWallet: DemoWallet = knownMember || {
          id: "browser-wallet",
          name: "Connected Wallet (Viewer)",
          address: pubkeyStr,
          roles: ["Viewer"],
          roleMask: 0,
        };
        setActiveWallet(browserWallet);
        setIsBrowserWalletConnected(true);
      }
    } catch (err: any) {
      console.error("Failed to connect wallet:", err);
    }
  };

  const disconnectBrowserWallet = () => {
    setActiveWallet(DEMO_WALLETS[0]);
    setIsBrowserWalletConnected(false);
  };

  return (
    <WalletContext.Provider
      value={{
        activeWallet,
        setActiveWallet,
        network,
        setNetwork,
        selectedVaultAddress,
        setSelectedVaultAddress,
        isBrowserWalletConnected,
        connectBrowserWallet,
        disconnectBrowserWallet,
      }}
    >
      {children}
    </WalletContext.Provider>
  );
}

export function useWallet() {
  const context = useContext(WalletContext);
  if (!context) {
    throw new Error("useWallet must be used within a WalletProvider");
  }
  return context;
}
