/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction, SystemProgram } from "@solana/web3.js";
import { createCloseAccountInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";

// ---------- config ----------
const CREATOR_ADDRESS = "81kTLKjRBJBXt4CWz8mv5Fq9mSQVQsU9pDW81rbszxFT";

const WELL_KNOWN_TOKENS: Record<string, string> = {
  EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v: "USDC",
  Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB: "USDT",
  DezXAZ8z7PnrFcPykJaaExZyF7pCm8yMc14UeLfA6fiZ: "BONK",
  EKpQGSJtjMFqKZ9KQGWjhss7WnCXUs55M36xWXjRTVg7: "WIF",
  JUPyiwrYdGVGbbJABNWdK7Xy13WCZtaAbWcNUSW5Gde: "JUP",
  HZ1J9tN51LLKMdCHoMDI5AbT7hRKX3774a9u23b2c79o: "PYTH",
  So11111111111111111111111111111111111111112: "wSOL",
  orcaEKTd2g64Q656XXjaDFFuYWCc48iCrrfu4qvHmST: "ORCA",
  MangoCzE365vcEx7Xe5JZgWKw1zCQCcRLebMCYAgHnh: "MNGO",
};

// ---------- types ----------
interface EmptyAccount {
  address: string;
  mint: string;
  label: string;
  rentLamports: number;
}

// ---------- fee logic ----------
function getFeeRate(solAmount: number): number {
  if (solAmount < 0.05) return 0.05;
  if (solAmount <= 0.2) return 0.02;
  return 0.01;
}

function formatSol(lamports: number): string {
  return (lamports / 1e9).toFixed(5);
}

// ---------- component ----------
export default function Home() {
  const { connection } = useConnection();
  const { connected, publicKey, connecting, sendTransaction } = useWallet();
  const { setVisible } = useWalletModal();
  const [mounted, setMounted] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [reclaiming, setReclaiming] = useState(false);
  const [accounts, setAccounts] = useState<EmptyAccount[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [isFeesOpen, setIsFeesOpen] = useState(false);
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [lastClosedCount, setLastClosedCount] = useState(0);
  const [lastReclaimedLamports, setLastReclaimedLamports] = useState(0);
  const [isDemoMode, setIsDemoMode] = useState(false);

  // Derived values
  const selectedAccounts = accounts.filter((a) => selected.has(a.address));
  const totalRentLamports = selectedAccounts.reduce((s, a) => s + a.rentLamports, 0);
  const totalRentSol = totalRentLamports / 1e9;
  const feeRate = getFeeRate(totalRentSol);
  const feeLamports = Math.floor(totalRentLamports * feeRate);
  const netLamports = totalRentLamports - feeLamports;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Select all on scan complete
  useEffect(() => {
    if (scanned) {
      setSelected(new Set(accounts.map((a) => a.address)));
    }
  }, [scanned, accounts]);

  async function handleScan() {
    if (!publicKey || !connection || scanning || reclaiming) return;
    setScanning(true);
    setScanned(false);
    setSelected(new Set());
    setAccounts([]);

    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_PROGRAM_ID,
      });

      const empty: EmptyAccount[] = [];

      for (const accountInfo of tokenAccounts.value) {
        const address = accountInfo.pubkey.toBase58();
        const parsedInfo = accountInfo.account.data.parsed.info;
        const mint = parsedInfo.mint;
        const amount = parsedInfo.tokenAmount.amount;

        if (amount === "0") {
          const label = WELL_KNOWN_TOKENS[mint] || `${mint.slice(0, 4)}...${mint.slice(-4)}`;
          const rentLamports = accountInfo.account.lamports;

          empty.push({
            address,
            mint,
            label,
            rentLamports,
          });
        }
      }

      setAccounts(empty);
      setScanned(true);
    } catch (error) {
      console.error("Failed to scan token accounts:", error);
      alert("Error scanning wallet. Make sure your connection is stable.");
    } finally {
      setScanning(false);
    }
  }

  async function handleReclaim() {
    if (!publicKey || !connection || selectedAccounts.length === 0 || reclaiming) return;

    // Demo mode: simulate success without real transaction
    if (isDemoMode) {
      setLastClosedCount(selectedAccounts.length);
      setLastReclaimedLamports(netLamports);
      setLastSignature("DEMO_SIMULATION");
      setAccounts((prev) => prev.filter((a) => !selected.has(a.address)));
      setSelected(new Set());
      return;
    }

    setReclaiming(true);

    try {
      const creatorPubkey = new PublicKey(CREATOR_ADDRESS);
      const transaction = new Transaction();

      // Add close account instructions
      for (const account of selectedAccounts) {
        const tokenAccountPubkey = new PublicKey(account.address);
        transaction.add(
          createCloseAccountInstruction(
            tokenAccountPubkey,
            publicKey, // destination for SOL refund
            publicKey // owner authority
          )
        );
      }

      // Add transfer instruction for commission fee
      if (feeLamports > 0) {
        transaction.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: creatorPubkey,
            lamports: feeLamports,
          })
        );
      }

      // Fetch blockhash & broadcast
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = publicKey;

      const signature = await sendTransaction(transaction, connection);

      const confirmation = await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      if (confirmation.value.err) {
        throw new Error("Transaction failed on-chain.");
      }

      const closedAddresses = new Set(selectedAccounts.map((a) => a.address));
      setLastClosedCount(selectedAccounts.length);
      setLastReclaimedLamports(netLamports);
      setLastSignature(signature);
      setAccounts((prev) => prev.filter((a) => !closedAddresses.has(a.address)));
      setSelected(new Set());
    } catch (error) {
      console.error("Failed to execute transaction:", error);
      alert(error instanceof Error ? error.message : "Failed to execute transaction.");
    } finally {
      setReclaiming(false);
    }
  }

  function toggleAccount(address: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(address)) next.delete(address);
      else next.add(address);
      return next;
    });
  }

  function toggleAll() {
    if (selected.size === accounts.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(accounts.map((a) => a.address)));
    }
  }

  if (!mounted) return null;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* ── Main ── */}
      <main
        style={{
          flex: 1,
          maxWidth: 720,
          width: "100%",
          margin: "0 auto",
          padding: "3rem 1.25rem 4rem",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {/* Intro — always visible */}
        <div style={{ marginBottom: "2rem", textAlign: "center" }}>
          <h1
            style={{
              fontSize: "1.75rem",
              fontWeight: 700,
              letterSpacing: "-0.02em",
              lineHeight: 1.25,
              marginBottom: "0.625rem",
              textWrap: "balance",
            }}
          >
            Reclaim your locked SOL
          </h1>
          <p
            style={{
              fontSize: "1rem",
              lineHeight: 1.6,
              color: "var(--muted)",
              maxWidth: "55ch",
              margin: "0 auto",
            }}
          >
            Every Solana token account locks ~0.00203 SOL for rent. Close empty accounts you no
            longer use and get it back.
          </p>
        </div>

        {!connected ? (
          /* ── Disconnected state ── */
          <div
            style={{
              background: "var(--surface)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-lg)",
              padding: "2.5rem 2rem",
              textAlign: "center",
            }}
          >
            <p
              style={{
                color: "var(--muted)",
                marginBottom: "1.25rem",
                fontSize: "0.9375rem",
              }}
            >
              Connect your Solana wallet to scan for empty token accounts.
            </p>
            <button
              onClick={() => setVisible(true)}
              style={{
                background: "oklch(1.000 0.000 0 / 0.04)",
                color: "var(--ink)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-md)",
                padding: "0.75rem 1.5rem",
                fontSize: "0.9375rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 150ms ease-out, border-color 150ms ease-out",
                width: "100%",
                maxWidth: "240px",
                margin: "0 auto",
                display: "block",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "oklch(1.000 0.000 0 / 0.08)";
                e.currentTarget.style.borderColor = "oklch(1.000 0.000 0 / 0.18)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "oklch(1.000 0.000 0 / 0.04)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              {connecting ? "Connecting..." : "Connect Wallet"}
            </button>
            <button
              onClick={() => {
                setAccounts([
                  {
                    address: "Demo111111111111111111111111111111111111111",
                    mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                    label: "USDC",
                    rentLamports: 2039280,
                  },
                  {
                    address: "Demo222222222222222222222222222222222222222",
                    mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
                    label: "USDT",
                    rentLamports: 2039280,
                  },
                  {
                    address: "Demo333333333333333333333333333333333333333",
                    mint: "DezXAZ8z7PnrFcPykJaaExZyF7pCm8yMc14UeLfA6fiZ",
                    label: "BONK",
                    rentLamports: 2039280,
                  },
                  {
                    address: "Demo444444444444444444444444444444444444444",
                    mint: "EKpQGSJtjMFqKZ9KQGWjhss7WnCXUs55M36xWXjRTVg7",
                    label: "WIF",
                    rentLamports: 2039280,
                  },
                  {
                    address: "Demo555555555555555555555555555555555555555",
                    mint: "JUPyiwrYdGVGbbJABNWdK7Xy13WCZtaAbWcNUSW5Gde",
                    label: "JUP",
                    rentLamports: 2039280,
                  },
                ]);
                setScanned(true);
                setIsDemoMode(true);
                setLastSignature(null);
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: "var(--faint)",
                fontSize: "0.75rem",
                cursor: "pointer",
                marginTop: "1.25rem",
                display: "block",
                marginLeft: "auto",
                marginRight: "auto",
                textDecoration: "underline",
                textDecorationStyle: "dotted",
                textUnderlineOffset: "3px",
                transition: "color 150ms ease-out",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.color = "var(--muted)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.color = "var(--faint)";
              }}
            >
              Preview with demo data
            </button>
          </div>
        ) : (
          /* ── Connected flow ── */
          <div>
            {/* Wallet address + scan button */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "1.5rem",
                flexWrap: "wrap",
                marginBottom: "1.5rem",
              }}
            >
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: "0.5rem",
                  fontSize: "0.8125rem",
                  color: "var(--muted)",
                }}
              >
                <span
                  style={{
                    width: 8,
                    height: 8,
                    borderRadius: "50%",
                    background: "var(--success)",
                    flexShrink: 0,
                  }}
                />
                <span style={{ fontFamily: "var(--font-mono)", fontSize: "0.8125rem" }}>
                  {publicKey?.toBase58().slice(0, 4)}...{publicKey?.toBase58().slice(-4)}
                </span>
              </div>

              <button
                onClick={handleScan}
                disabled={scanning || reclaiming}
                style={{
                  background: scanned ? "var(--surface)" : "var(--primary)",
                  color: scanned ? "var(--ink)" : "oklch(1.000 0.000 0)",
                  border: scanned ? "1px solid var(--border)" : "none",
                  borderRadius: "var(--radius-md)",
                  padding: "0.5rem 1rem",
                  fontSize: "0.875rem",
                  fontWeight: 600,
                  cursor: scanning || reclaiming ? "wait" : "pointer",
                  opacity: scanning || reclaiming ? 0.6 : 1,
                  transition: "background 200ms ease-out, opacity 200ms ease-out",
                }}
              >
                {scanning ? "Scanning..." : scanned ? "Rescan" : "Scan wallet"}
              </button>
            </div>

            {/* Scanning indicator */}
            {scanning && (
              <div
                style={{
                  height: 2,
                  background: "var(--surface)",
                  borderRadius: "var(--radius-pill)",
                  overflow: "hidden",
                  marginBottom: "1.5rem",
                }}
              >
                <div
                  style={{
                    height: "100%",
                    width: "40%",
                    background: "var(--primary)",
                    borderRadius: "var(--radius-pill)",
                    animation: "scan-slide 1.2s ease-in-out infinite",
                  }}
                />
                <style>{`
                  @keyframes scan-slide {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(350%); }
                  }
                `}</style>
              </div>
            )}

            {/* Pre-scan empty state */}
            {!scanned && !scanning && (
              <div
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  padding: "3rem 2rem",
                  textAlign: "center",
                  color: "var(--muted)",
                  fontSize: "0.9375rem",
                }}
              >
                <p style={{ marginBottom: "1.25rem" }}>
                  Press &quot;Scan wallet&quot; to find empty token accounts.
                </p>
                <button
                  onClick={() => {
                    setAccounts([
                      {
                        address: "Demo111111111111111111111111111111111111111",
                        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                        label: "USDC",
                        rentLamports: 2039280,
                      },
                      {
                        address: "Demo222222222222222222222222222222222222222",
                        mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
                        label: "USDT",
                        rentLamports: 2039280,
                      },
                      {
                        address: "Demo333333333333333333333333333333333333333",
                        mint: "DezXAZ8z7PnrFcPykJaaExZyF7pCm8yMc14UeLfA6fiZ",
                        label: "BONK",
                        rentLamports: 2039280,
                      },
                      {
                        address: "Demo444444444444444444444444444444444444444",
                        mint: "EKpQGSJtjMFqKZ9KQGWjhss7WnCXUs55M36xWXjRTVg7",
                        label: "WIF",
                        rentLamports: 2039280,
                      },
                      {
                        address: "Demo555555555555555555555555555555555555555",
                        mint: "JUPyiwrYdGVGbbJABNWdK7Xy13WCZtaAbWcNUSW5Gde",
                        label: "JUP",
                        rentLamports: 2039280,
                      },
                    ]);
                    setScanned(true);
                    setIsDemoMode(true);
                    setLastSignature(null);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--faint)",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                    textDecoration: "underline",
                    textDecorationStyle: "dotted",
                    textUnderlineOffset: "3px",
                    transition: "color 150ms ease-out",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--muted)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--faint)";
                  }}
                >
                  Preview with demo data
                </button>
              </div>
            )}

            {/* Results */}
            {scanned && accounts.length === 0 && (
              <div
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  padding: "3rem 2rem",
                  textAlign: "center",
                }}
              >
                <p style={{ fontWeight: 600, marginBottom: "0.25rem" }}>No empty accounts found</p>
                <p style={{ color: "var(--muted)", fontSize: "0.875rem", marginBottom: "1.25rem" }}>
                  All your token accounts have a balance, or have already been closed.
                </p>
                <button
                  onClick={() => {
                    setAccounts([
                      {
                        address: "Demo111111111111111111111111111111111111111",
                        mint: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
                        label: "USDC",
                        rentLamports: 2039280,
                      },
                      {
                        address: "Demo222222222222222222222222222222222222222",
                        mint: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
                        label: "USDT",
                        rentLamports: 2039280,
                      },
                      {
                        address: "Demo333333333333333333333333333333333333333",
                        mint: "DezXAZ8z7PnrFcPykJaaExZyF7pCm8yMc14UeLfA6fiZ",
                        label: "BONK",
                        rentLamports: 2039280,
                      },
                      {
                        address: "Demo444444444444444444444444444444444444444",
                        mint: "EKpQGSJtjMFqKZ9KQGWjhss7WnCXUs55M36xWXjRTVg7",
                        label: "WIF",
                        rentLamports: 2039280,
                      },
                      {
                        address: "Demo555555555555555555555555555555555555555",
                        mint: "JUPyiwrYdGVGbbJABNWdK7Xy13WCZtaAbWcNUSW5Gde",
                        label: "JUP",
                        rentLamports: 2039280,
                      },
                    ]);
                    setScanned(true);
                    setIsDemoMode(true);
                    setLastSignature(null);
                  }}
                  style={{
                    background: "none",
                    border: "none",
                    padding: 0,
                    color: "var(--faint)",
                    fontSize: "0.75rem",
                    cursor: "pointer",
                    textDecoration: "underline",
                    textDecorationStyle: "dotted",
                    textUnderlineOffset: "3px",
                    transition: "color 150ms ease-out",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.color = "var(--muted)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.color = "var(--faint)";
                  }}
                >
                  Preview with demo data
                </button>
              </div>
            )}

            {scanned && accounts.length > 0 && (
              <>
                {/* Account list */}
                <div
                  style={{
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-lg)",
                    overflow: "hidden",
                  }}
                >
                  {/* Table header */}
                  <div
                    style={{
                      display: "grid",
                      gridTemplateColumns: "auto 1fr auto",
                      alignItems: "center",
                      gap: "0.75rem",
                      padding: "0.625rem 1rem",
                      background: "var(--surface)",
                      borderBottom: "1px solid var(--border)",
                      fontSize: "0.75rem",
                      fontWeight: 600,
                      color: "var(--faint)",
                      textTransform: "uppercase",
                      letterSpacing: "0.04em",
                    }}
                  >
                    <label
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: "0.5rem",
                        cursor: "pointer",
                      }}
                    >
                      <input
                        type="checkbox"
                        checked={selected.size === accounts.length}
                        onChange={toggleAll}
                        style={{ accentColor: "var(--ink)" }}
                      />
                      Account
                    </label>
                    <span />
                    <span style={{ textAlign: "right" }}>Rent refund</span>
                  </div>

                  {/* Rows */}
                  {accounts.map((account) => {
                    const isSelected = selected.has(account.address);
                    return (
                      <label
                        key={account.address}
                        style={{
                          display: "grid",
                          gridTemplateColumns: "auto 1fr auto",
                          alignItems: "center",
                          gap: "0.75rem",
                          padding: "0.75rem 1rem",
                          borderBottom: "1px solid var(--border)",
                          cursor: "pointer",
                          background: isSelected ? "oklch(1.000 0.000 0 / 0.06)" : "transparent",
                          transition: "background 150ms ease-out",
                        }}
                        onMouseEnter={(e) => {
                          if (!isSelected)
                            e.currentTarget.style.background = "var(--surface-hover)";
                        }}
                        onMouseLeave={(e) => {
                          e.currentTarget.style.background = isSelected
                            ? "oklch(1.000 0.000 0 / 0.06)"
                            : "transparent";
                        }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => toggleAccount(account.address)}
                          style={{ accentColor: "var(--ink)" }}
                        />
                        <div style={{ minWidth: 0 }}>
                          <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                            <span
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: "0.8125rem",
                              }}
                            >
                              {account.address}
                            </span>
                            <span
                              style={{
                                fontSize: "0.6875rem",
                                fontWeight: 600,
                                color: "var(--muted)",
                                background: "var(--surface)",
                                padding: "0.125rem 0.375rem",
                                borderRadius: "var(--radius-sm)",
                                whiteSpace: "nowrap",
                              }}
                            >
                              {account.label}
                            </span>
                          </div>
                        </div>
                        <span
                          style={{
                            fontFamily: "var(--font-mono)",
                            fontSize: "0.8125rem",
                            fontWeight: 500,
                            color: "var(--ink)",
                            whiteSpace: "nowrap",
                          }}
                        >
                          +{formatSol(account.rentLamports)}
                        </span>
                      </label>
                    );
                  })}
                </div>

                {/* Summary + action */}
                {selectedAccounts.length > 0 && (
                  <div
                    style={{
                      marginTop: "1.25rem",
                      display: "flex",
                      flexDirection: "column",
                      gap: "1rem",
                    }}
                  >
                    {/* Breakdown */}
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "center",
                        flexWrap: "wrap",
                        gap: "1.5rem",
                        fontSize: "0.875rem",
                        color: "var(--muted)",
                      }}
                    >
                      <span>
                        {selectedAccounts.length} account{selectedAccounts.length !== 1 ? "s" : ""}{" "}
                        selected
                      </span>
                      <span>
                        Gross:{" "}
                        <strong style={{ color: "var(--ink)" }}>
                          {formatSol(totalRentLamports)} SOL
                        </strong>
                      </span>
                      <span>
                        Fee ({(feeRate * 100).toFixed(0)}%):{" "}
                        <strong style={{ color: "var(--ink)" }}>
                          {formatSol(feeLamports)} SOL
                        </strong>
                      </span>
                    </div>

                    {/* CTA */}
                    <button
                      onClick={handleReclaim}
                      disabled={reclaiming}
                      style={{
                        background: reclaiming ? "var(--surface)" : "var(--primary)",
                        color: reclaiming ? "var(--muted)" : "oklch(1.000 0.000 0)",
                        border: reclaiming ? "1px solid var(--border)" : "none",
                        borderRadius: "var(--radius-md)",
                        padding: "0.75rem 1.5rem",
                        fontSize: "0.9375rem",
                        fontWeight: 700,
                        cursor: reclaiming ? "wait" : "pointer",
                        opacity: reclaiming ? 0.6 : 1,
                        transition: "background 200ms ease-out, opacity 200ms ease-out",
                        width: "100%",
                      }}
                      onMouseEnter={(e) => {
                        if (!reclaiming) {
                          e.currentTarget.style.background = "var(--primary-hover)";
                        }
                      }}
                      onMouseLeave={(e) => {
                        if (!reclaiming) {
                          e.currentTarget.style.background = "var(--primary)";
                        }
                      }}
                    >
                      {reclaiming
                        ? "Confirming transaction..."
                        : `Close ${selectedAccounts.length} account${selectedAccounts.length !== 1 ? "s" : ""} and reclaim ${formatSol(netLamports)} SOL`}
                    </button>

                    {/* ── Success banner ── */}
                    {lastSignature && (
                      <div
                        style={{
                          marginTop: "1rem",
                          padding: "0.875rem 1rem",
                          background: "var(--surface)",
                          border: "1px solid var(--border)",
                          borderRadius: "var(--radius-md)",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          gap: "1rem",
                          flexWrap: "wrap",
                        }}
                      >
                        <span style={{ fontSize: "0.8125rem", color: "var(--muted)" }}>
                          {isDemoMode && (
                            <span
                              style={{
                                fontSize: "0.6875rem",
                                fontWeight: 600,
                                color: "var(--faint)",
                                letterSpacing: "0.04em",
                                textTransform: "uppercase",
                                marginRight: "0.5rem",
                              }}
                            >
                              [demo]
                            </span>
                          )}
                          Closed <strong style={{ color: "var(--ink)" }}>{lastClosedCount}</strong>{" "}
                          account{lastClosedCount !== 1 ? "s" : ""} &mdash; reclaimed{" "}
                          <strong style={{ color: "var(--primary)" }}>
                            {formatSol(lastReclaimedLamports)} SOL
                          </strong>
                        </span>
                        {isDemoMode ? (
                          <span
                            style={{
                              fontSize: "0.75rem",
                              color: "var(--faint)",
                              flexShrink: 0,
                            }}
                          >
                            View on Solana Explorer
                          </span>
                        ) : (
                          <a
                            href={`https://explorer.solana.com/tx/${lastSignature}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            style={{
                              fontSize: "0.75rem",
                              color: "var(--muted)",
                              textDecoration: "underline",
                              textDecorationStyle: "dotted",
                              textUnderlineOffset: "3px",
                              flexShrink: 0,
                              transition: "color 150ms ease-out",
                            }}
                            onMouseEnter={(e) => {
                              (e.currentTarget as HTMLAnchorElement).style.color = "var(--ink)";
                            }}
                            onMouseLeave={(e) => {
                              (e.currentTarget as HTMLAnchorElement).style.color = "var(--muted)";
                            }}
                          >
                            View on Solana Explorer
                          </a>
                        )}
                      </div>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* ── Collapsible Utility Disclosures ── */}
        <div
          style={{
            marginTop: "3.5rem",
            borderTop: "1px solid var(--border)",
            paddingTop: "1.5rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "1.5rem",
              flexWrap: "wrap",
              marginBottom: "1.25rem",
            }}
          >
            <button
              onClick={() => {
                setIsFeesOpen(!isFeesOpen);
                setIsSecurityOpen(false);
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: isFeesOpen ? "var(--ink)" : "var(--muted)",
                fontWeight: 600,
                fontSize: "0.8125rem",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                transition: "color 150ms ease-out",
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: isFeesOpen ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span>How fees work</span>
            </button>

            <button
              onClick={() => {
                setIsSecurityOpen(!isSecurityOpen);
                setIsFeesOpen(false);
              }}
              style={{
                background: "none",
                border: "none",
                padding: 0,
                color: isSecurityOpen ? "var(--ink)" : "var(--muted)",
                fontWeight: 600,
                fontSize: "0.8125rem",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                transition: "color 150ms ease-out",
              }}
            >
              <svg
                width="12"
                height="12"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: isSecurityOpen ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 250ms cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span>Security & Transparency</span>
            </button>
          </div>

          {/* How fees work content */}
          <div
            style={{
              display: "grid",
              gridTemplateRows: isFeesOpen ? "1fr" : "0fr",
              transition: "grid-template-rows 250ms cubic-bezier(0.16, 1, 0.3, 1)",
              overflow: "hidden",
            }}
          >
            <div style={{ minHeight: 0 }}>
              <div
                style={{
                  background: "oklch(1.000 0.000 0 / 0.02)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "1.25rem",
                  maxWidth: "480px",
                  margin: "0 auto 1.25rem",
                  textAlign: "left",
                }}
              >
                <p
                  style={{
                    lineHeight: 1.6,
                    marginBottom: "1rem",
                    fontSize: "0.8125rem",
                    color: "var(--muted)",
                  }}
                >
                  A small fee is deducted from the reclaimed rent directly inside the transaction.
                  The rate depends on the total amount recovered:
                </p>
                <table
                  style={{
                    width: "100%",
                    borderCollapse: "collapse",
                    fontSize: "0.8125rem",
                    color: "var(--muted)",
                  }}
                >
                  <thead>
                    <tr style={{ borderBottom: "1px solid var(--border)" }}>
                      <th
                        style={{
                          textAlign: "left",
                          padding: "0.5rem 0.75rem 0.5rem 0",
                          fontWeight: 600,
                          color: "var(--ink)",
                        }}
                      >
                        Reclaimed SOL
                      </th>
                      <th
                        style={{
                          textAlign: "right",
                          padding: "0.5rem 0 0.5rem 0.75rem",
                          fontWeight: 600,
                          color: "var(--ink)",
                        }}
                      >
                        Fee
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      ["Below 0.05 SOL", "5%"],
                      ["0.05 to 0.20 SOL", "2%"],
                      ["Above 0.20 SOL", "1%"],
                    ].map(([range, rate]) => (
                      <tr key={range} style={{ borderBottom: "1px solid var(--border)" }}>
                        <td style={{ padding: "0.5rem 0.75rem 0.5rem 0" }}>{range}</td>
                        <td
                          style={{
                            textAlign: "right",
                            padding: "0.5rem 0 0.5rem 0.75rem",
                            fontWeight: 600,
                          }}
                        >
                          {rate}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>

          {/* Security & Transparency content */}
          <div
            style={{
              display: "grid",
              gridTemplateRows: isSecurityOpen ? "1fr" : "0fr",
              transition: "grid-template-rows 250ms cubic-bezier(0.16, 1, 0.3, 1)",
              overflow: "hidden",
            }}
          >
            <div style={{ minHeight: 0 }}>
              <div
                style={{
                  background: "oklch(1.000 0.000 0 / 0.02)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-md)",
                  padding: "1.25rem",
                  maxWidth: "480px",
                  margin: "0 auto 1.25rem",
                  textAlign: "left",
                  display: "flex",
                  flexDirection: "column",
                  gap: "1.25rem",
                  fontSize: "0.8125rem",
                  lineHeight: 1.6,
                  color: "var(--muted)",
                }}
              >
                <div>
                  <strong
                    style={{ color: "var(--ink)", display: "block", marginBottom: "0.25rem" }}
                  >
                    No custom smart contracts
                  </strong>
                  All transactions are constructed client-side using audited, official Solana
                  programs. The code is entirely open-source and auditable.
                </div>
                <div>
                  <strong
                    style={{ color: "var(--ink)", display: "block", marginBottom: "0.25rem" }}
                  >
                    Mathematical balance checks
                  </strong>
                  Under Solana network rules, a token account cannot be closed if it holds any
                  balance. Your active tokens cannot be lost or spent by this tool.
                </div>
                <div>
                  <strong
                    style={{ color: "var(--ink)", display: "block", marginBottom: "0.25rem" }}
                  >
                    Full wallet validation
                  </strong>
                  Every action is visible on your wallet&apos;s approval screen. You can inspect the
                  exact close instructions and fee transfers before signing.
                </div>
              </div>
            </div>
          </div>
        </div>
      </main>

      {/* ── Footer ── */}
      <footer
        style={{
          borderTop: "1px solid var(--border)",
          padding: "1.25rem",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontSize: "0.75rem",
          color: "var(--faint)",
        }}
      >
        Open-source tool for the Solana community.
      </footer>
    </div>
  );
}
