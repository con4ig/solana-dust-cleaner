/* eslint-disable react-hooks/set-state-in-effect */
"use client";

import { useEffect, useState, useRef } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { PublicKey, Transaction, SystemProgram, ComputeBudgetProgram } from "@solana/web3.js";
import {
  createCloseAccountInstruction,
  createBurnInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { motion, AnimatePresence } from "framer-motion";

// ---------- config ----------
const CREATOR_ADDRESS =
  process.env.NEXT_PUBLIC_CREATOR_ADDRESS || "81kTLKjRBJBXt4CWz8mv5Fq9mSQVQsU9pDW81rbszxFT";
const REFERRER_FEE_SHARE = 0.5; // 50% of fees go to referrer

const METADATA_PROGRAM_ID = new PublicKey("metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s");

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

interface NftAccount {
  address: string;
  mint: string;
  name: string;
  symbol: string;
  image?: string;
  rentLamports: number;
}

type TabType = "dust" | "nft";

// ---------- util logic ----------
function getFeeRate(solAmount: number): number {
  if (solAmount < 0.05) return 0.05;
  if (solAmount <= 0.2) return 0.02;
  return 0.01;
}

function formatSol(lamports: number): string {
  return (lamports / 1e9).toFixed(5);
}

/** Read a u32 little-endian directly from Uint8Array indices – no DataView needed. */
function readU32LE(arr: Uint8Array, off: number): number {
  return (arr[off] | (arr[off + 1] << 8) | (arr[off + 2] << 16) | (arr[off + 3] << 24)) >>> 0;
}

function parseMetaplexMetadata(
  buffer: Uint8Array
): { name: string; symbol: string; uri: string } | null {
  try {
    // Metaplex Metadata V1 layout: key(1) + updateAuthority(32) + mint(32) = 65 byte header
    let offset = 65;

    // --- Name ---
    if (offset + 4 > buffer.length) return null;
    const nameLen = readU32LE(buffer, offset);
    offset += 4;
    if (nameLen < 0 || nameLen > 256 || offset + nameLen > buffer.length) return null;
    const name = new TextDecoder("utf-8")
      .decode(buffer.subarray(offset, offset + nameLen))
      .replace(/\0/g, "")
      .trim();
    offset += nameLen;

    // --- Symbol ---
    if (offset + 4 > buffer.length) return null;
    const symbolLen = readU32LE(buffer, offset);
    offset += 4;
    if (symbolLen < 0 || symbolLen > 64 || offset + symbolLen > buffer.length) return null;
    const symbol = new TextDecoder("utf-8")
      .decode(buffer.subarray(offset, offset + symbolLen))
      .replace(/\0/g, "")
      .trim();
    offset += symbolLen;

    // --- URI ---
    if (offset + 4 > buffer.length) return null;
    const uriLen = readU32LE(buffer, offset);
    offset += 4;
    if (uriLen < 0 || uriLen > 512 || offset + uriLen > buffer.length) return null;
    const uri = new TextDecoder("utf-8")
      .decode(buffer.subarray(offset, offset + uriLen))
      .replace(/\0/g, "")
      .trim();

    return { name, symbol, uri };
  } catch {
    // Malformed on-chain data for this account – skip it, don't crash the scan
    return null;
  }
}

// ---------- component ----------
export default function Home() {
  const { connection } = useConnection();
  const { connected, publicKey, connecting, sendTransaction, disconnect } = useWallet();
  const { setVisible } = useWalletModal();
  const [mounted, setMounted] = useState(false);
  const [walletMenuOpen, setWalletMenuOpen] = useState(false);
  const walletMenuRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<TabType>("dust");

  // Unified Scanning State
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);

  // State for Dust Cleaner
  const [dustAccounts, setDustAccounts] = useState<EmptyAccount[]>([]);
  const [selectedDust, setSelectedDust] = useState<Set<string>>(new Set());

  // State for NFT Burner
  const [nftAccounts, setNftAccounts] = useState<NftAccount[]>([]);
  const [selectedNft, setSelectedNft] = useState<Set<string>>(new Set());

  // Shared state
  const [reclaiming, setReclaiming] = useState(false);
  const [isFeesOpen, setIsFeesOpen] = useState(false);
  const [isSecurityOpen, setIsSecurityOpen] = useState(false);
  const [lastSignature, setLastSignature] = useState<string | null>(null);
  const [lastClosedCount, setLastClosedCount] = useState(0);
  const [lastReclaimedLamports, setLastReclaimedLamports] = useState(0);
  const [closingAccounts, setClosingAccounts] = useState<Set<string>>(new Set());
  const [batchProgress, setBatchProgress] = useState<string | null>(null);

  // Refs for stale-wallet / abort guard (Fix 3)
  const walletKeyRef = useRef<string | null>(null);
  const scanAbortRef = useRef<AbortController | null>(null);

  // Referral system state
  const [referrerAddress, setReferrerAddress] = useState<string | null>(null);
  const [partnerWalletInput, setPartnerWalletInput] = useState("");
  const [generatedRefLink, setGeneratedRefLink] = useState<string | null>(null);
  const [refLinkCopied, setRefLinkCopied] = useState(false);
  const [isPartnerOpen, setIsPartnerOpen] = useState(false);

  const feesRef = useRef<HTMLDivElement>(null);
  const securityRef = useRef<HTMLDivElement>(null);

  // Derived values for active tab
  const isDustTab = activeTab === "dust";
  const selectedCount = isDustTab ? selectedDust.size : selectedNft.size;
  const totalItems = isDustTab ? dustAccounts.length : nftAccounts.length;

  const selectedRentLamports = isDustTab
    ? dustAccounts
        .filter((a) => selectedDust.has(a.address))
        .reduce((s, a) => s + a.rentLamports, 0)
    : nftAccounts.filter((a) => selectedNft.has(a.address)).reduce((s, a) => s + a.rentLamports, 0);

  const totalRentSol = selectedRentLamports / 1e9;
  const feeRate = getFeeRate(totalRentSol);
  const feeLamports = Math.floor(selectedRentLamports * feeRate);
  const netLamports = selectedRentLamports - feeLamports;

  useEffect(() => {
    setMounted(true);
    console.log("Reclaim Fee Wallet:", CREATOR_ADDRESS);

    // Read referral param from URL or localStorage
    try {
      const params = new URLSearchParams(window.location.search);
      const refParam = params.get("ref");
      if (refParam) {
        // Validate that it's a real Solana address
        const refPubkey = new PublicKey(refParam);
        if (PublicKey.isOnCurve(refPubkey.toBytes())) {
          setReferrerAddress(refParam);
          localStorage.setItem("referrer", refParam);
        }
      } else {
        const stored = localStorage.getItem("referrer");
        if (stored) {
          const storedPubkey = new PublicKey(stored);
          if (PublicKey.isOnCurve(storedPubkey.toBytes())) {
            setReferrerAddress(stored);
          }
        }
      }
    } catch {
      // Invalid address, ignore
    }
  }, []);

  // Abort scan on wallet disconnect
  useEffect(() => {
    if (!connected) {
      scanAbortRef.current?.abort();
      walletKeyRef.current = null;
    }
  }, [connected]);

  // Close wallet menu on outside click
  useEffect(() => {
    if (!walletMenuOpen) return;
    function handleOutside(e: MouseEvent) {
      if (walletMenuRef.current && !walletMenuRef.current.contains(e.target as Node)) {
        setWalletMenuOpen(false);
      }
    }
    document.addEventListener("mousedown", handleOutside);
    return () => document.removeEventListener("mousedown", handleOutside);
  }, [walletMenuOpen]);

  useEffect(() => {
    if (isFeesOpen || isSecurityOpen) {
      const startTime = Date.now();
      const duration = 500; // matches transition duration
      const interval = setInterval(() => {
        const elapsed = Date.now() - startTime;
        if (elapsed >= duration) {
          clearInterval(interval);
        }
        window.scrollTo(0, document.documentElement.scrollHeight);
      }, 16); // ~60fps
      return () => clearInterval(interval);
    }
  }, [isFeesOpen, isSecurityOpen]);

  async function handleScan() {
    if (!publicKey || !connection || scanning || reclaiming) return;

    // Abort any previously running scan
    scanAbortRef.current?.abort();
    const abortController = new AbortController();
    scanAbortRef.current = abortController;
    const signal = abortController.signal;

    // Snapshot the wallet that initiated this scan
    const scanWalletKey = publicKey.toBase58();
    walletKeyRef.current = scanWalletKey;

    /** Returns true if the wallet has changed or the scan was aborted. */
    const isStale = () => signal.aborted || walletKeyRef.current !== scanWalletKey;

    setScanning(true);
    setScanned(false);
    setSelectedDust(new Set());
    setSelectedNft(new Set());
    setDustAccounts([]);
    setNftAccounts([]);

    const startTime = Date.now();

    try {
      const tokenAccounts = await connection.getParsedTokenAccountsByOwner(publicKey, {
        programId: TOKEN_PROGRAM_ID,
      });
      if (isStale()) return;

      const empty: EmptyAccount[] = [];
      const nftCandidates: {
        address: string;
        mint: string;
        rentLamports: number;
        pda: PublicKey;
      }[] = [];

      for (const accountInfo of tokenAccounts.value) {
        const address = accountInfo.pubkey.toBase58();
        const parsedInfo = accountInfo.account.data.parsed.info;
        const mint = parsedInfo.mint;
        const amount = parsedInfo.tokenAmount.amount;
        const decimals = parsedInfo.tokenAmount.decimals;
        const rentLamports = accountInfo.account.lamports;

        if (amount === "0") {
          const label = WELL_KNOWN_TOKENS[mint] || `${mint.slice(0, 4)}...${mint.slice(-4)}`;
          empty.push({ address, mint, label, rentLamports });
        } else if (amount === "1" && decimals === 0) {
          const mintPubkey = new PublicKey(mint);
          const [pda] = PublicKey.findProgramAddressSync(
            [
              new TextEncoder().encode("metadata"),
              METADATA_PROGRAM_ID.toBytes(),
              mintPubkey.toBytes(),
            ],
            METADATA_PROGRAM_ID
          );
          nftCandidates.push({ address, mint, rentLamports, pda });
        }
      }

      if (isStale()) return;

      // Process dust
      setDustAccounts(empty);
      setSelectedDust(new Set(empty.map((a) => a.address)));

      // Process NFTs
      if (nftCandidates.length === 0) {
        setNftAccounts([]);
        setSelectedNft(new Set());
      } else {
        const nfts: NftAccount[] = [];
        const chunkSize = 100;
        for (let i = 0; i < nftCandidates.length; i += chunkSize) {
          if (isStale()) return;

          const chunk = nftCandidates.slice(i, i + chunkSize);
          const pdas = chunk.map((c) => c.pda);
          const accountInfos = await connection.getMultipleAccountsInfo(pdas);

          if (isStale()) return;

          for (let j = 0; j < chunk.length; j++) {
            const info = accountInfos[j];
            let name = "Unknown NFT";
            let symbol = "";
            let uri = "";

            if (info && info.data) {
              const parsed = parseMetaplexMetadata(info.data);
              if (parsed) {
                name = parsed.name || name;
                symbol = parsed.symbol || "";
                uri = parsed.uri || "";
              }
            }

            let image: string | undefined;
            if (uri.startsWith("http")) {
              try {
                const res = await fetch(`/api/proxy?url=${encodeURIComponent(uri)}`, { signal });
                const json = await res.json();
                if (json.image) image = json.image;
              } catch {
                // Aborted or network error – skip image
              }
            }

            if (isStale()) return;

            nfts.push({
              address: chunk[j].address,
              mint: chunk[j].mint,
              rentLamports: chunk[j].rentLamports,
              name,
              symbol,
              image,
            });
          }
        }

        if (isStale()) return;
        setNftAccounts(nfts);
        setSelectedNft(new Set(nfts.map((a) => a.address)));
      }

      if (isStale()) return;
      setScanned(true);
    } catch (error) {
      if (signal.aborted) return; // intentional abort, not an error
      console.error("Failed to scan token accounts:", error);
      alert("Error scanning wallet. Make sure your connection is stable.");
    } finally {
      // Only clear scanning state if this is still the active scan
      if (!isStale()) {
        const elapsed = Date.now() - startTime;
        const minDelay = 1500;
        if (elapsed < minDelay) await new Promise((r) => setTimeout(r, minDelay - elapsed));
        setScanning(false);
      }
    }
  }

  // --- Batch size limits (accounts per transaction) ---
  // CloseAccount = ~1 instruction = ~40 bytes overhead per account
  // Burn+Close   = ~2 instructions = ~80 bytes overhead per account
  // Leaving room for ComputeBudget (2 ixs), fee transfer (1-2 ixs), blockhash, sigs (~200 bytes)
  // Max serialized tx = 1232 bytes → safe limits:
  const DUST_BATCH_SIZE = 10;
  const NFT_BATCH_SIZE = 4;

  async function handleReclaim() {
    if (!publicKey || !connection || selectedCount === 0 || reclaiming) return;

    setReclaiming(true);
    setBatchProgress(null);

    const creatorPubkey = new PublicKey(CREATOR_ADDRESS);

    // Gather accounts to process
    type AccountItem = { address: string; mint: string; rentLamports: number };
    const accountsToProcess: AccountItem[] = isDustTab
      ? dustAccounts.filter((a) => selectedDust.has(a.address))
      : nftAccounts.filter((a) => selectedNft.has(a.address));

    const batchSize = isDustTab ? DUST_BATCH_SIZE : NFT_BATCH_SIZE;

    // Split into batches
    const batches: AccountItem[][] = [];
    for (let i = 0; i < accountsToProcess.length; i += batchSize) {
      batches.push(accountsToProcess.slice(i, i + batchSize));
    }

    // Recalculate total rent for ALL selected accounts to determine the overall fee rate
    const totalSelectedRent = accountsToProcess.reduce((s, a) => s + a.rentLamports, 0);
    const totalSol = totalSelectedRent / 1e9;
    const feeRateLocal = getFeeRate(totalSol);

    const allClosedAddresses = new Set<string>();
    const failedAddresses = new Set<string>();
    let lastSig: string | null = null;
    let totalFeePaid = 0;

    try {
      for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
        const batch = batches[batchIdx];
        setBatchProgress(`Processing batch ${batchIdx + 1} of ${batches.length}...`);

        try {
          const transaction = new Transaction();

          // Priority fee + compute budget
          transaction.add(
            ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
            ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1_000 })
          );

          const batchAddresses = new Set<string>();

          if (isDustTab) {
            for (const account of batch) {
              batchAddresses.add(account.address);
              const tokenAccountPubkey = new PublicKey(account.address);
              transaction.add(
                createCloseAccountInstruction(tokenAccountPubkey, publicKey, publicKey)
              );
            }
          } else {
            for (const account of batch) {
              batchAddresses.add(account.address);
              const tokenAccountPubkey = new PublicKey(account.address);
              const mintPubkey = new PublicKey(account.mint);
              transaction.add(createBurnInstruction(tokenAccountPubkey, mintPubkey, publicKey, 1));
              transaction.add(
                createCloseAccountInstruction(tokenAccountPubkey, publicKey, publicKey)
              );
            }
          }

          // Calculate fee for this specific batch
          const batchRent = batch.reduce((s, a) => s + a.rentLamports, 0);
          const batchFeeLamports = Math.floor(batchRent * feeRateLocal);

          // Add fee transfer for this batch
          if (batchFeeLamports > 0) {
            if (referrerAddress && referrerAddress !== publicKey.toBase58()) {
              const referrerPubkey = new PublicKey(referrerAddress);
              const referrerLamports = Math.floor(batchFeeLamports * REFERRER_FEE_SHARE);
              const creatorLamports = batchFeeLamports - referrerLamports;

              if (creatorLamports > 0 && !publicKey.equals(creatorPubkey)) {
                transaction.add(
                  SystemProgram.transfer({
                    fromPubkey: publicKey,
                    toPubkey: creatorPubkey,
                    lamports: creatorLamports,
                  })
                );
              }
              if (referrerLamports > 0 && !publicKey.equals(referrerPubkey)) {
                transaction.add(
                  SystemProgram.transfer({
                    fromPubkey: publicKey,
                    toPubkey: referrerPubkey,
                    lamports: referrerLamports,
                  })
                );
              }
            } else {
              if (!publicKey.equals(creatorPubkey)) {
                transaction.add(
                  SystemProgram.transfer({
                    fromPubkey: publicKey,
                    toPubkey: creatorPubkey,
                    lamports: batchFeeLamports,
                  })
                );
              }
            }
          }

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
            throw new Error(`Batch ${batchIdx + 1} failed on-chain.`);
          }

          // Batch succeeded
          lastSig = signature;
          totalFeePaid += batchFeeLamports;
          batchAddresses.forEach((addr) => allClosedAddresses.add(addr));

          // Progressively remove closed accounts from the UI
          setClosingAccounts((prev) => {
            const next = new Set(prev);
            batchAddresses.forEach((addr) => next.add(addr));
            return next;
          });

          // Remove closed accounts from data after a brief animation delay
          await new Promise((r) => setTimeout(r, 400));
          if (isDustTab) {
            setDustAccounts((prev) => prev.filter((a) => !batchAddresses.has(a.address)));
            setSelectedDust((prev) => {
              const next = new Set(prev);
              batchAddresses.forEach((addr) => next.delete(addr));
              return next;
            });
          } else {
            setNftAccounts((prev) => prev.filter((a) => !batchAddresses.has(a.address)));
            setSelectedNft((prev) => {
              const next = new Set(prev);
              batchAddresses.forEach((addr) => next.delete(addr));
              return next;
            });
          }
        } catch (batchError) {
          console.error(`Batch ${batchIdx + 1} failed:`, batchError);
          // Mark these accounts as failed but continue with remaining batches
          batch.forEach((a) => failedAddresses.add(a.address));
        }
      }

      // Final summary
      if (allClosedAddresses.size > 0) {
        const closedRent = accountsToProcess
          .filter((a) => allClosedAddresses.has(a.address))
          .reduce((s, a) => s + a.rentLamports, 0);
        const closedNet = closedRent - totalFeePaid;

        setLastClosedCount(allClosedAddresses.size);
        setLastReclaimedLamports(closedNet);
        setLastSignature(lastSig);
      }

      if (failedAddresses.size > 0) {
        alert(
          `${allClosedAddresses.size} account(s) closed successfully. ` +
            `${failedAddresses.size} account(s) failed – they remain selected so you can retry.`
        );
      }
    } catch (error) {
      console.error("Failed to execute transactions:", error);
      alert(error instanceof Error ? error.message : "Failed to execute transactions.");
    } finally {
      setReclaiming(false);
      setBatchProgress(null);
      setClosingAccounts(new Set());
    }
  }

  function toggleAccount(address: string) {
    if (isDustTab) {
      setSelectedDust((prev) => {
        const next = new Set(prev);
        if (next.has(address)) next.delete(address);
        else next.add(address);
        return next;
      });
    } else {
      setSelectedNft((prev) => {
        const next = new Set(prev);
        if (next.has(address)) next.delete(address);
        else next.add(address);
        return next;
      });
    }
  }

  function toggleAll() {
    if (isDustTab) {
      if (selectedDust.size === dustAccounts.length) setSelectedDust(new Set());
      else setSelectedDust(new Set(dustAccounts.map((a) => a.address)));
    } else {
      if (selectedNft.size === nftAccounts.length) setSelectedNft(new Set());
      else setSelectedNft(new Set(nftAccounts.map((a) => a.address)));
    }
  }

  if (!mounted) return null;

  const currentScanning = scanning;
  const currentScanned = scanned;

  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      {/* �� Sticky Nav �� */}
      <header
        style={{
          position: "sticky",
          top: 0,
          zIndex: 50,
          borderBottom: "1px solid var(--border)",
          background: "rgba(9, 9, 11, 0.8)",
          backdropFilter: "blur(12px)",
          WebkitBackdropFilter: "blur(12px)",
          padding: "0.75rem 1.5rem",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "0.65rem" }}>
          {/* Logo */}
          <div
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 44,
              height: 44,
            }}
          >
            <img
              src="/icon.png?v=2"
              alt="Solana Dust Cleaner Logo"
              style={{
                width: "70%",
                height: "70%",
                objectFit: "contain",
              }}
            />
          </div>
          <span
            style={{
              fontFamily: "var(--font-mono)",
              fontWeight: 600,
              fontSize: "0.875rem",
              letterSpacing: "0.05em",
              color: "var(--ink)",
            }}
          >
            Solana Dust Cleaner
          </span>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: "1rem" }}>
          {/* Earn SOL (Partner Program) Button */}
          <button
            onClick={() => setIsPartnerOpen(true)}
            style={{
              background: "none",
              border: "none",
              color: "oklch(0.75 0.12 145)",
              fontSize: "0.8125rem",
              fontWeight: 600,
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: "0.375rem",
              padding: "0.375rem 0.75rem",
              borderRadius: "var(--radius-pill)",
              transition: "background 150ms ease-out, color 150ms ease-out",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "oklch(0.75 0.12 145 / 0.08)";
              e.currentTarget.style.color = "oklch(0.85 0.15 145)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "none";
              e.currentTarget.style.color = "oklch(0.75 0.12 145)";
            }}
          >
            <svg
              width="13"
              height="13"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <line x1="12" y1="1" x2="12" y2="23" />
              <path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
            </svg>
            <span>Earn SOL</span>
          </button>

          {connected && publicKey ? (
            <div style={{ display: "flex", alignItems: "center", gap: "0.75rem" }}>
              <button
                onClick={handleScan}
                disabled={currentScanning || reclaiming}
                style={{
                  background: "oklch(1 0 0 / 0.04)",
                  color: "var(--ink)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-pill)",
                  padding: "0.375rem 1rem",
                  fontSize: "0.8125rem",
                  fontWeight: 600,
                  cursor: currentScanning || reclaiming ? "wait" : "pointer",
                  transition:
                    "background 150ms ease-out, border-color 150ms ease-out, opacity 200ms ease-out",
                }}
                onMouseEnter={(e) => {
                  if (!currentScanning && !reclaiming) {
                    e.currentTarget.style.background = "oklch(1 0 0 / 0.08)";
                    e.currentTarget.style.borderColor = "oklch(1 0 0 / 0.14)";
                  }
                }}
                onMouseLeave={(e) => {
                  if (!currentScanning && !reclaiming) {
                    e.currentTarget.style.background = "oklch(1 0 0 / 0.04)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }
                }}
              >
                {currentScanning ? "Scanning..." : currentScanned ? "Rescan" : "Scan Wallet"}
              </button>
              {/* Wallet address button with popover */}
              <div ref={walletMenuRef} style={{ position: "relative" }}>
                <div
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "0.5rem",
                    background: walletMenuOpen ? "oklch(1 0 0 / 0.08)" : "oklch(1 0 0 / 0.04)",
                    border: `1px solid ${walletMenuOpen ? "oklch(1 0 0 / 0.14)" : "var(--border)"}`,
                    borderRadius: "var(--radius-pill)",
                    padding: "0.375rem 0.875rem 0.375rem 0.625rem",
                    cursor: "pointer",
                    transition: "background 150ms ease-out, border-color 150ms ease-out",
                    userSelect: "none",
                  }}
                  onClick={() => setWalletMenuOpen((v) => !v)}
                  onMouseEnter={(e) => {
                    if (!walletMenuOpen) {
                      e.currentTarget.style.background = "oklch(1 0 0 / 0.08)";
                      e.currentTarget.style.borderColor = "oklch(1 0 0 / 0.14)";
                    }
                  }}
                  onMouseLeave={(e) => {
                    if (!walletMenuOpen) {
                      e.currentTarget.style.background = "oklch(1 0 0 / 0.04)";
                      e.currentTarget.style.borderColor = "var(--border)";
                    }
                  }}
                >
                  <span
                    style={{
                      width: 7,
                      height: 7,
                      borderRadius: "50%",
                      background: "var(--success)",
                      flexShrink: 0,
                      boxShadow: "0 0 6px var(--success)",
                    }}
                  />
                  <span
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.8125rem",
                      color: "var(--ink)",
                      fontWeight: 500,
                    }}
                  >
                    {publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}
                  </span>
                  {/* chevron */}
                  <svg
                    width="10"
                    height="10"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    style={{
                      color: "var(--muted)",
                      transform: walletMenuOpen ? "rotate(180deg)" : "rotate(0deg)",
                      transition: "transform 200ms ease-out",
                      flexShrink: 0,
                    }}
                  >
                    <polyline points="6 9 12 15 18 9" />
                  </svg>
                </div>

                {/* Popover menu */}
                <AnimatePresence>
                  {walletMenuOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: -8, scale: 0.95 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: -8, scale: 0.95 }}
                      transition={{ duration: 0.15, ease: [0.16, 1, 0.3, 1] }}
                      style={{
                        position: "absolute",
                        top: "calc(100% + 8px)",
                        right: 0,
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-md)",
                        padding: "0.375rem",
                        minWidth: "180px",
                        boxShadow: "0 8px 24px oklch(0 0 0 / 0.35)",
                        zIndex: 100,
                        transformOrigin: "top right",
                      }}
                    >
                      {(
                        [
                          {
                            label: "Change Wallet",
                            icon: (
                              <svg
                                width="13"
                                height="13"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
                                <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
                                <path d="M18 12a2 2 0 0 0 0 4h4v-4Z" />
                              </svg>
                            ),
                            onClick: () => {
                              setVisible(true);
                              setWalletMenuOpen(false);
                            },
                            danger: false,
                          },
                          {
                            label: "Disconnect",
                            icon: (
                              <svg
                                width="13"
                                height="13"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                                <polyline points="16 17 21 12 16 7" />
                                <line x1="21" y1="12" x2="9" y2="12" />
                              </svg>
                            ),
                            onClick: () => {
                              disconnect();
                              setWalletMenuOpen(false);
                            },
                            danger: true,
                          },
                        ] as const
                      ).map((item) => (
                        <button
                          key={item.label}
                          onClick={item.onClick}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: "0.625rem",
                            width: "100%",
                            background: "none",
                            border: "none",
                            borderRadius: "var(--radius-sm)",
                            padding: "0.5rem 0.75rem",
                            fontSize: "0.8125rem",
                            fontWeight: 500,
                            color: item.danger ? "var(--error)" : "var(--ink)",
                            cursor: "pointer",
                            textAlign: "left",
                            transition: "background 100ms ease-out",
                          }}
                          onMouseEnter={(e) => {
                            e.currentTarget.style.background = "oklch(1 0 0 / 0.06)";
                          }}
                          onMouseLeave={(e) => {
                            e.currentTarget.style.background = "none";
                          }}
                        >
                          {item.icon}
                          {item.label}
                        </button>
                      ))}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setVisible(true)}
              style={{
                background: "oklch(1 0 0 / 0.04)",
                color: "var(--ink)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-pill)",
                padding: "0.375rem 1rem",
                fontSize: "0.8125rem",
                fontWeight: 600,
                cursor: "pointer",
                transition: "background 150ms ease-out, border-color 150ms ease-out",
              }}
              onMouseEnter={(e) => {
                e.currentTarget.style.background = "oklch(1 0 0 / 0.08)";
                e.currentTarget.style.borderColor = "oklch(1 0 0 / 0.14)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.background = "oklch(1 0 0 / 0.04)";
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            >
              {connecting ? "Connecting..." : "Connect Wallet"}
            </button>
          )}
        </div>
      </header>

      {/* Referral Banner */}
      <AnimatePresence>
        {referrerAddress && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
            style={{ overflow: "hidden" }}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "0.5rem",
                padding: "0.5rem 1.5rem",
                background: "oklch(0.55 0.15 145 / 0.1)",
                borderBottom: "1px solid oklch(0.55 0.15 145 / 0.2)",
                fontSize: "0.75rem",
                color: "oklch(0.75 0.12 145)",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
              <span>
                Referred by{" "}
                <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600 }}>
                  {referrerAddress.slice(0, 4)}...{referrerAddress.slice(-4)}
                </span>
                {" - "}
                Partner earns {Math.round(REFERRER_FEE_SHARE * 100)}% of fees
              </span>
              <button
                onClick={() => {
                  setReferrerAddress(null);
                  localStorage.removeItem("referrer");
                }}
                style={{
                  background: "none",
                  border: "none",
                  color: "oklch(0.75 0.12 145)",
                  cursor: "pointer",
                  padding: "0 0.25rem",
                  fontSize: "0.875rem",
                  lineHeight: 1,
                  opacity: 0.6,
                  transition: "opacity 150ms ease",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.opacity = "1")}
                onMouseLeave={(e) => (e.currentTarget.style.opacity = "0.6")}
                title="Remove referral"
              >
                x
              </button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Main */}
      <main
        style={{
          flex: 1,
          maxWidth: 760,
          width: "100%",
          margin: "0 auto",
          padding: "3.5rem 1.5rem 4.5rem",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {/* Intro */}
        <AnimatePresence mode="wait">
          <motion.div
            key={activeTab}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
            style={{ marginBottom: "2.5rem", textAlign: "center" }}
          >
            <h1
              style={{
                fontSize: "2rem",
                fontWeight: 700,
                letterSpacing: "-0.02em",
                lineHeight: 1.2,
                marginBottom: "0.75rem",
                textWrap: "balance",
              }}
            >
              {isDustTab ? "Reclaim your locked SOL" : "Burn Spam NFTs"}
            </h1>
            <p
              style={{
                fontSize: "1rem",
                lineHeight: 1.6,
                color: "var(--muted)",
                maxWidth: "50ch",
                margin: "0 auto",
              }}
            >
              {isDustTab
                ? "Every token account on Solana requires a rent deposit. Clean up empty accounts to get it back."
                : "Destroy unwanted spam tokens and reclaim their locked rent deposits safely."}
            </p>
          </motion.div>
        </AnimatePresence>

        {/* �� Tabs �� */}
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginBottom: "2.5rem",
          }}
        >
          <div
            style={{
              display: "flex",
              background: "oklch(1 0 0 / 0.03)",
              border: "1px solid var(--border)",
              borderRadius: "var(--radius-pill)",
              padding: "0.1875rem",
              position: "relative",
              width: "260px",
            }}
          >
            <button
              onClick={() => setActiveTab("dust")}
              style={{
                padding: "0.375rem 0",
                borderRadius: "var(--radius-pill)",
                fontSize: "0.8125rem",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: "transparent",
                color: isDustTab ? "var(--ink)" : "var(--muted)",
                transition: "color 200ms ease-out",
                position: "relative",
                zIndex: 1,
                flex: 1,
              }}
            >
              {isDustTab && (
                <motion.div
                  layoutId="tab-pill"
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "var(--surface-hover)",
                    borderRadius: "var(--radius-pill)",
                    zIndex: -1,
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              Empty Accounts
            </button>
            <button
              onClick={() => setActiveTab("nft")}
              style={{
                padding: "0.375rem 0",
                borderRadius: "var(--radius-pill)",
                fontSize: "0.8125rem",
                fontWeight: 600,
                border: "none",
                cursor: "pointer",
                background: "transparent",
                color: !isDustTab ? "var(--ink)" : "var(--muted)",
                transition: "color 200ms ease-out",
                position: "relative",
                zIndex: 1,
                flex: 1,
              }}
            >
              {!isDustTab && (
                <motion.div
                  layoutId="tab-pill"
                  style={{
                    position: "absolute",
                    inset: 0,
                    background: "var(--surface-hover)",
                    borderRadius: "var(--radius-pill)",
                    zIndex: -1,
                  }}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              Spam NFTs
            </button>
          </div>
        </div>

        <AnimatePresence mode="wait">
          <motion.div
            key={`${activeTab}-${connected}`}
            initial={{ opacity: 0, y: 15 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -15 }}
            transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          >
            {!connected ? (
              /* �� Disconnected state �� */
              <div
                style={{
                  background: "var(--surface)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--radius-lg)",
                  padding: "2.5rem 2rem",
                  textAlign: "center",
                }}
              >
                <button
                  onClick={() => setVisible(true)}
                  style={{
                    background: "oklch(1 0 0 / 0.04)",
                    color: "var(--ink)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-md)",
                    padding: "0.4375rem 1.25rem",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    transition: "background 150ms ease-out, border-color 150ms ease-out",
                    width: "100%",
                    maxWidth: "180px",
                    margin: "0 auto",
                    display: "block",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "oklch(1 0 0 / 0.08)";
                    e.currentTarget.style.borderColor = "oklch(1 0 0 / 0.18)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "oklch(1 0 0 / 0.04)";
                    e.currentTarget.style.borderColor = "var(--border)";
                  }}
                >
                  {connecting ? "Connecting..." : "Connect Wallet"}
                </button>
              </div>
            ) : (
              /* �� Connected flow �� */
              <div>
                {/* Scanning indicator */}
                {currentScanning && (
                  <div
                    style={{
                      height: 2,
                      background: "var(--surface)",
                      borderRadius: "var(--radius-pill)",
                      overflow: "hidden",
                      marginBottom: "2rem",
                      animation: "fade-in-up 400ms cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    <div
                      style={{
                        height: "100%",
                        width: "40%",
                        background: "var(--ink)",
                        borderRadius: "var(--radius-pill)",
                        animation: "scan-slide 1.2s ease-in-out infinite",
                      }}
                    />
                    <style>{`
                  @keyframes scan-slide {
                    0% { transform: translateX(-100%); }
                    100% { transform: translateX(350%); }
                  }
                  @keyframes pulse-closing {
                    0% { opacity: 0.4; }
                    50% { opacity: 0.15; }
                    100% { opacity: 0.4; }
                  }
                  @keyframes fade-in-up {
                    0% { opacity: 0; transform: translateY(10px); }
                    100% { opacity: 1; transform: translateY(0); }
                  }
                `}</style>
                  </div>
                )}

                {/* Pre-scan empty state */}
                {!currentScanned && !currentScanning && (
                  <div
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-lg)",
                      padding: "3rem 2rem",
                      textAlign: "center",
                      color: "var(--muted)",
                      fontSize: "0.9375rem",
                      animation: "fade-in-up 400ms cubic-bezier(0.16, 1, 0.3, 1)",
                    }}
                  >
                    <p style={{ margin: 0 }}>
                      Scan your wallet to find {isDustTab ? "empty token accounts" : "spam NFTs"}.
                    </p>
                  </div>
                )}

                {/* Results */}
                {currentScanned && totalItems === 0 && (
                  <div
                    style={{
                      animation: "fade-in-up 500ms cubic-bezier(0.4, 0, 0.2, 1)",
                      display: "flex",
                      flexDirection: "column",
                      gap: "1.25rem",
                    }}
                  >
                    <div
                      style={{
                        background: "var(--surface)",
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-lg)",
                        padding: "3rem 2rem",
                        textAlign: "center",
                      }}
                    >
                      <p style={{ fontWeight: 600, marginBottom: "0.5rem" }}>
                        {isDustTab ? "No empty accounts found" : "No Spam NFTs found"}
                      </p>
                      <p style={{ color: "var(--muted)", fontSize: "0.875rem" }}>
                        {isDustTab
                          ? "All your token accounts have a balance, or have already been closed."
                          : "Your wallet looks clean from standard 0-decimal spam NFTs."}
                      </p>
                    </div>

                    {lastSignature && (
                      <div
                        style={{
                          padding: "1rem 1.25rem",
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
                          Closed <strong style={{ color: "var(--ink)" }}>{lastClosedCount}</strong>{" "}
                          account{lastClosedCount !== 1 ? "s" : ""}, reclaimed{" "}
                          <strong style={{ color: "var(--success)" }}>
                            {formatSol(lastReclaimedLamports)} SOL
                          </strong>
                        </span>
                        <a
                          href={`https://explorer.solana.com/tx/${lastSignature}?cluster=devnet`}
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
                          View on Explorer
                        </a>
                      </div>
                    )}
                  </div>
                )}

                {currentScanned && totalItems > 0 && (
                  <div
                    style={{
                      animation: "fade-in-up 500ms cubic-bezier(0.4, 0, 0.2, 1)",
                    }}
                  >
                    <div
                      style={{
                        border: "1px solid var(--border)",
                        borderRadius: "var(--radius-lg)",
                        overflow: "hidden",
                        background: "var(--surface)",
                      }}
                    >
                      {/* Table header */}
                      <div
                        style={{
                          display: "grid",
                          gridTemplateColumns: isDustTab ? "auto 1fr auto" : "auto 32px 1fr auto",
                          alignItems: "center",
                          gap: "1rem",
                          padding: "0.75rem 1.25rem",
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
                            checked={selectedCount === totalItems}
                            onChange={toggleAll}
                            style={{ accentColor: "var(--ink)" }}
                          />
                          Account
                        </label>
                        {!isDustTab && <span />}
                        <span />
                        <span style={{ textAlign: "right" }}>Rent refund</span>
                      </div>

                      {/* Rows */}
                      {(isDustTab ? dustAccounts : nftAccounts).map((account) => {
                        const isSelected = isDustTab
                          ? selectedDust.has(account.address)
                          : selectedNft.has(account.address);
                        const isClosing = closingAccounts.has(account.address);
                        const isNft = !isDustTab;
                        const nftAcc = account as NftAccount;

                        return (
                          <label
                            key={account.address}
                            style={{
                              display: "grid",
                              gridTemplateColumns: isNft ? "auto 32px 1fr auto" : "auto 1fr auto",
                              alignItems: "center",
                              gap: "1rem",
                              padding: "0.875rem 1.25rem",
                              borderBottom: "1px solid var(--border)",
                              cursor: isClosing ? "default" : "pointer",
                              background:
                                isSelected && !isClosing
                                  ? "oklch(1.000 0.000 0 / 0.06)"
                                  : "transparent",
                              transition: "background 300ms ease-out, opacity 300ms ease-out",
                              opacity: isClosing ? 0.4 : 1,
                              filter: isClosing ? "grayscale(100%)" : "none",
                              animation: isClosing
                                ? "pulse-closing 1.5s infinite ease-in-out"
                                : "none",
                              pointerEvents: isClosing ? "none" : "auto",
                            }}
                            onMouseEnter={(e) => {
                              if (!isSelected && !isClosing)
                                e.currentTarget.style.background = "var(--surface-hover)";
                            }}
                            onMouseLeave={(e) => {
                              if (!isClosing)
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

                            {isNft && (
                              <div
                                style={{
                                  width: 32,
                                  height: 32,
                                  borderRadius: "4px",
                                  background: "var(--border)",
                                  overflow: "hidden",
                                  display: "flex",
                                  alignItems: "center",
                                  justifyContent: "center",
                                }}
                              >
                                {nftAcc.image ? (
                                  <img
                                    src={nftAcc.image}
                                    alt={nftAcc.name}
                                    style={{ width: "100%", height: "100%", objectFit: "cover" }}
                                  />
                                ) : (
                                  <span style={{ fontSize: "10px", color: "var(--faint)" }}>
                                    NFT
                                  </span>
                                )}
                              </div>
                            )}

                            <div
                              style={{
                                minWidth: 0,
                                display: "flex",
                                flexDirection: "column",
                                gap: "2px",
                              }}
                            >
                              <div style={{ display: "flex", alignItems: "center", gap: "0.5rem" }}>
                                <span
                                  style={{
                                    fontFamily: "var(--font-mono)",
                                    fontSize: "0.8125rem",
                                    color: "var(--ink)",
                                  }}
                                >
                                  {isNft
                                    ? nftAcc.name || "Unknown NFT"
                                    : (account as EmptyAccount).label}
                                </span>
                              </div>
                              <span
                                style={{
                                  fontSize: "0.6875rem",
                                  color: "var(--muted)",
                                  fontFamily: "var(--font-mono)",
                                }}
                              >
                                {account.address.slice(0, 6)}...{account.address.slice(-6)}
                              </span>
                            </div>
                            <span
                              style={{
                                fontFamily: "var(--font-mono)",
                                fontSize: "0.8125rem",
                                fontWeight: 500,
                                color: isNft ? "var(--accent)" : "var(--success)",
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
                    <div
                      style={{
                        display: "grid",
                        gridTemplateRows: selectedCount > 0 ? "1fr" : "0fr",
                        opacity: selectedCount > 0 ? 1 : 0,
                        transition: "all 400ms cubic-bezier(0.16, 1, 0.3, 1)",
                      }}
                    >
                      <div style={{ overflow: "hidden" }}>
                        <div
                          style={{
                            marginTop: selectedCount > 0 ? "1.5rem" : "0",
                            display: "flex",
                            flexDirection: "column",
                            gap: "1.25rem",
                            paddingBottom: "2px",
                          }}
                        >
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
                              {selectedCount} item{selectedCount !== 1 ? "s" : ""} selected
                            </span>
                            <span>
                              Gross:{" "}
                              <strong style={{ color: "var(--ink)" }}>
                                {formatSol(selectedRentLamports)} SOL
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
                              background: reclaiming ? "var(--surface)" : "oklch(1 0 0 / 0.04)",
                              color: reclaiming ? "var(--muted)" : "var(--ink)",
                              border: "1px solid var(--border)",
                              borderRadius: "var(--radius-md)",
                              padding: "0.875rem 1.5rem",
                              fontSize: "0.9375rem",
                              fontWeight: 600,
                              cursor: reclaiming ? "wait" : "pointer",
                              opacity: reclaiming ? 0.6 : 1,
                              transition:
                                "background 150ms ease-out, border-color 150ms ease-out, transform 150ms ease-out, opacity 200ms ease-out",
                              width: "100%",
                              boxShadow: "none",
                            }}
                            onMouseEnter={(e) => {
                              if (!reclaiming) {
                                e.currentTarget.style.transform = "translateY(-1px)";
                                e.currentTarget.style.background = "oklch(1 0 0 / 0.08)";
                                e.currentTarget.style.borderColor = "oklch(1 0 0 / 0.14)";
                              }
                            }}
                            onMouseLeave={(e) => {
                              if (!reclaiming) {
                                e.currentTarget.style.transform = "translateY(0)";
                                e.currentTarget.style.background = "oklch(1 0 0 / 0.04)";
                                e.currentTarget.style.borderColor = "var(--border)";
                              }
                            }}
                          >
                            {reclaiming
                              ? batchProgress || "Confirming transaction..."
                              : `${isDustTab ? "Close" : "Burn & Close"} ${selectedCount} account${selectedCount !== 1 ? "s" : ""} and reclaim ${formatSol(netLamports)} SOL`}
                          </button>

                          {!isDustTab && selectedCount > 0 && (
                            <div
                              style={{
                                textAlign: "center",
                                fontSize: "0.75rem",
                                color: "var(--error)",
                                fontWeight: 500,
                              }}
                            >
                              Warning: Burning an NFT is permanent and irreversible.
                            </div>
                          )}

                          {/* Success banner */}
                          {lastSignature && (
                            <div
                              style={{
                                marginTop: "0.5rem",
                                padding: "1rem 1.25rem",
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
                                Closed{" "}
                                <strong style={{ color: "var(--ink)" }}>{lastClosedCount}</strong>{" "}
                                account{lastClosedCount !== 1 ? "s" : ""}, reclaimed{" "}
                                <strong
                                  style={{ color: isDustTab ? "var(--primary)" : "var(--accent)" }}
                                >
                                  {formatSol(lastReclaimedLamports)} SOL
                                </strong>
                              </span>
                              <a
                                href={`https://explorer.solana.com/tx/${lastSignature}?cluster=devnet`}
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
                                  (e.currentTarget as HTMLAnchorElement).style.color =
                                    "var(--muted)";
                                }}
                              >
                                View on Solana Explorer
                              </a>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}
          </motion.div>
        </AnimatePresence>

        {/* �� Collapsible Utility Disclosures �� */}
        <div
          style={{
            marginTop: "4rem",
            borderTop: "1px solid var(--border)",
            paddingTop: "2rem",
          }}
        >
          <div
            style={{
              display: "flex",
              justifyContent: "center",
              gap: "2rem",
              flexWrap: "wrap",
              marginBottom: "1.5rem",
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
                fontSize: "0.875rem",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                transition: "color 150ms ease-out",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: isFeesOpen ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 350ms cubic-bezier(0.16, 1, 0.3, 1)",
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
                fontSize: "0.875rem",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                gap: "0.375rem",
                transition: "color 150ms ease-out",
              }}
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
                style={{
                  transform: isSecurityOpen ? "rotate(90deg)" : "rotate(0deg)",
                  transition: "transform 350ms cubic-bezier(0.16, 1, 0.3, 1)",
                }}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span>Security & Trust</span>
            </button>
          </div>

          {/* How fees work content */}
          <AnimatePresence initial={false}>
            {isFeesOpen && (
              <motion.div
                ref={feesRef}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
                style={{ overflow: "hidden" }}
              >
                <div style={{ paddingBottom: "1.5rem" }}>
                  <div
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-lg)",
                      padding: "1.5rem",
                      maxWidth: "500px",
                      margin: "0 auto",
                      textAlign: "left",
                    }}
                  >
                    <p
                      style={{
                        lineHeight: 1.6,
                        marginBottom: "1.25rem",
                        fontSize: "0.875rem",
                        color: "var(--muted)",
                      }}
                    >
                      A small fee is deducted from the reclaimed rent directly inside the
                      transaction. The rate depends on the total amount recovered:
                    </p>
                    <table
                      style={{
                        width: "100%",
                        borderCollapse: "collapse",
                        fontSize: "0.875rem",
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
                            <td style={{ padding: "0.75rem 0.75rem 0.75rem 0" }}>{range}</td>
                            <td
                              style={{
                                textAlign: "right",
                                padding: "0.75rem 0 0.75rem 0.75rem",
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
              </motion.div>
            )}
          </AnimatePresence>

          {/* Security & Transparency content */}
          <AnimatePresence initial={false}>
            {isSecurityOpen && (
              <motion.div
                ref={securityRef}
                initial={{ height: 0, opacity: 0 }}
                animate={{ height: "auto", opacity: 1 }}
                exit={{ height: 0, opacity: 0 }}
                transition={{ duration: 0.5, ease: "easeInOut" }}
                style={{ overflow: "hidden" }}
              >
                <div style={{ paddingBottom: "1.5rem" }}>
                  <div
                    style={{
                      background: "var(--surface)",
                      border: "1px solid var(--border)",
                      borderRadius: "var(--radius-lg)",
                      padding: "1.75rem",
                      maxWidth: "500px",
                      margin: "0 auto",
                      textAlign: "left",
                      display: "flex",
                      flexDirection: "column",
                      gap: "1.5rem",
                      fontSize: "0.875rem",
                      lineHeight: 1.6,
                      color: "var(--muted)",
                    }}
                  >
                    <div>
                      <strong
                        style={{
                          color: "var(--ink)",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          marginBottom: "0.375rem",
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path>
                        </svg>
                        Non-Custodial & No Smart Contracts
                      </strong>
                      All transactions are constructed client-side using audited, official Solana
                      programs (SPL Token). The code is entirely open-source and auditable. We never
                      have access to your private keys.
                    </div>
                    <div>
                      <strong
                        style={{
                          color: "var(--ink)",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          marginBottom: "0.375rem",
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <circle cx="12" cy="12" r="10"></circle>
                          <path d="M12 16v-4"></path>
                          <path d="M12 8h.01"></path>
                        </svg>
                        Mathematical Balance Checks
                      </strong>
                      Under Solana network rules, a token account cannot be closed if it holds any
                      active balance (except when using the Spam NFT burner, which explicitly burns
                      exactly 1 token before closing). Your active tokens cannot be lost.
                    </div>
                    <div>
                      <strong
                        style={{
                          color: "var(--ink)",
                          display: "flex",
                          alignItems: "center",
                          gap: "0.5rem",
                          marginBottom: "0.375rem",
                        }}
                      >
                        <svg
                          width="16"
                          height="16"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                          <circle cx="12" cy="12" r="3"></circle>
                        </svg>
                        Full Wallet Validation
                      </strong>
                      Every action is visible on your wallet&apos;s approval screen. You can inspect
                      the exact burn/close instructions and fee transfers before signing.
                    </div>
                  </div>
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>

      {/* �� Footer �� */}
      <footer
        style={{
          borderTop: "1px solid var(--border)",
          padding: "1.5rem",
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          fontSize: "0.8125rem",
          color: "var(--faint)",
        }}
      >
        <a
          href="https://github.com/con4ig/solana-dust-cleaner"
          target="_blank"
          rel="noopener noreferrer"
          style={{
            color: "var(--primary)",
            textDecoration: "none",
            transition: "color 150ms ease",
          }}
          onMouseEnter={(e) => (e.currentTarget.style.color = "var(--primary-hover)")}
          onMouseLeave={(e) => (e.currentTarget.style.color = "var(--primary)")}
        >
          Open-source
        </a>
        &nbsp;tool for the Solana community.
      </footer>

      {/* �� Partner Program Modal �� */}
      <AnimatePresence>
        {isPartnerOpen && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            style={{
              position: "fixed",
              inset: 0,
              zIndex: 100,
              background: "rgba(9, 9, 11, 0.75)",
              backdropFilter: "blur(8px)",
              WebkitBackdropFilter: "blur(8px)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "1.5rem",
            }}
            onClick={() => setIsPartnerOpen(false)}
          >
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 16 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 16 }}
              transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
              style={{
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: "var(--radius-lg)",
                padding: "2rem",
                maxWidth: "480px",
                width: "100%",
                position: "relative",
              }}
              onClick={(e) => e.stopPropagation()}
            >
              {/* Close button */}
              <button
                onClick={() => setIsPartnerOpen(false)}
                style={{
                  position: "absolute",
                  top: "1rem",
                  right: "1rem",
                  background: "none",
                  border: "none",
                  color: "var(--muted)",
                  cursor: "pointer",
                  padding: "0.25rem",
                  transition: "color 150ms ease",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
                onMouseEnter={(e) => (e.currentTarget.style.color = "var(--ink)")}
                onMouseLeave={(e) => (e.currentTarget.style.color = "var(--muted)")}
              >
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  width="18"
                  height="18"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M18 6 6 18" />
                  <path d="m6 6 12 12" />
                </svg>
              </button>

              <div style={{ textAlign: "center", marginBottom: "1.5rem" }}>
                <h2
                  style={{
                    fontSize: "1.25rem",
                    fontWeight: 700,
                    letterSpacing: "-0.01em",
                    marginBottom: "0.5rem",
                  }}
                >
                  Earn SOL - Partner Program
                </h2>
                <p
                  style={{
                    fontSize: "0.875rem",
                    color: "var(--muted)",
                    lineHeight: 1.6,
                  }}
                >
                  Share your referral link and earn{" "}
                  <strong style={{ color: "oklch(0.75 0.12 145)" }}>
                    {Math.round(REFERRER_FEE_SHARE * 100)}%
                  </strong>{" "}
                  of all transaction fees generated by your users. Paid automatically on-chain.
                </p>
              </div>

              {/* How it works mini-steps */}
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  marginBottom: "1.5rem",
                  gap: "0.5rem",
                }}
              >
                {[
                  { step: "1", label: "Paste wallet" },
                  { step: "2", label: "Share link" },
                  { step: "3", label: "Earn SOL" },
                ].map((item) => (
                  <div
                    key={item.step}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.375rem",
                      fontSize: "0.75rem",
                      color: "var(--muted)",
                    }}
                  >
                    <span
                      style={{
                        display: "inline-flex",
                        alignItems: "center",
                        justifyContent: "center",
                        width: 20,
                        height: 20,
                        borderRadius: "50%",
                        background: "oklch(1 0 0 / 0.06)",
                        border: "1px solid var(--border)",
                        fontSize: "0.6875rem",
                        fontWeight: 700,
                        color: "var(--ink)",
                        flexShrink: 0,
                      }}
                    >
                      {item.step}
                    </span>
                    {item.label}
                  </div>
                ))}
              </div>

              {/* Input + Generate */}
              <div style={{ display: "flex", gap: "0.5rem", marginBottom: "0.75rem" }}>
                <input
                  type="text"
                  placeholder="Your Solana wallet address"
                  value={partnerWalletInput}
                  onChange={(e) => {
                    setPartnerWalletInput(e.target.value);
                    setGeneratedRefLink(null);
                    setRefLinkCopied(false);
                  }}
                  style={{
                    flex: 1,
                    background: "oklch(1 0 0 / 0.03)",
                    border: "1px solid var(--border)",
                    borderRadius: "var(--radius-sm)",
                    padding: "0.5rem 0.75rem",
                    fontSize: "0.8125rem",
                    color: "var(--ink)",
                    fontFamily: "var(--font-mono)",
                    outline: "none",
                    transition: "border-color 150ms ease",
                  }}
                  onFocus={(e) => (e.currentTarget.style.borderColor = "oklch(1 0 0 / 0.2)")}
                  onBlur={(e) => (e.currentTarget.style.borderColor = "var(--border)")}
                />
                <button
                  onClick={() => {
                    try {
                      const pubkey = new PublicKey(partnerWalletInput.trim());
                      if (!PublicKey.isOnCurve(pubkey.toBytes())) {
                        alert("Invalid Solana wallet address.");
                        return;
                      }
                      const baseUrl = window.location.origin + window.location.pathname;
                      const link = `${baseUrl}?ref=${pubkey.toBase58()}`;
                      setGeneratedRefLink(link);
                      navigator.clipboard.writeText(link);
                      setRefLinkCopied(true);
                      setTimeout(() => setRefLinkCopied(false), 2500);
                    } catch {
                      alert("Invalid Solana wallet address. Please paste a valid public key.");
                    }
                  }}
                  style={{
                    background: "oklch(0.75 0.12 145 / 0.1)",
                    color: "oklch(0.75 0.12 145)",
                    border: "1px solid oklch(0.75 0.12 145 / 0.2)",
                    borderRadius: "var(--radius-sm)",
                    padding: "0.5rem 1rem",
                    fontSize: "0.8125rem",
                    fontWeight: 600,
                    cursor: "pointer",
                    whiteSpace: "nowrap",
                    transition: "background 150ms ease, border-color 150ms ease",
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.background = "oklch(0.75 0.12 145 / 0.18)";
                    e.currentTarget.style.borderColor = "oklch(0.75 0.12 145 / 0.3)";
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.background = "oklch(0.75 0.12 145 / 0.1)";
                    e.currentTarget.style.borderColor = "oklch(0.75 0.12 145 / 0.2)";
                  }}
                >
                  {refLinkCopied ? "Copied!" : "Generate Link"}
                </button>
              </div>

              {/* Generated link display */}
              <AnimatePresence>
                {generatedRefLink && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
                    style={{ overflow: "hidden" }}
                  >
                    <div
                      style={{
                        background: "oklch(0.55 0.15 145 / 0.08)",
                        border: "1px solid oklch(0.55 0.15 145 / 0.2)",
                        borderRadius: "var(--radius-sm)",
                        padding: "0.625rem 0.75rem",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        gap: "0.5rem",
                        marginTop: "0.5rem",
                      }}
                    >
                      <span
                        style={{
                          fontSize: "0.75rem",
                          fontFamily: "var(--font-mono)",
                          color: "oklch(0.75 0.12 145)",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                          whiteSpace: "nowrap",
                        }}
                      >
                        {generatedRefLink}
                      </span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(generatedRefLink);
                          setRefLinkCopied(true);
                          setTimeout(() => setRefLinkCopied(false), 2500);
                        }}
                        style={{
                          background: "none",
                          border: "none",
                          color: "oklch(0.75 0.12 145)",
                          cursor: "pointer",
                          padding: "0.125rem",
                          flexShrink: 0,
                        }}
                        title="Copy to clipboard"
                      >
                        <svg
                          width="14"
                          height="14"
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        >
                          <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                          <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
                        </svg>
                      </button>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Fee split info */}
              <p
                style={{
                  fontSize: "0.6875rem",
                  color: "var(--faint)",
                  marginTop: "1rem",
                  textAlign: "center",
                  lineHeight: 1.5,
                }}
              >
                Fees are split on-chain in the same transaction. Your users pay the same rate - your
                share comes from our cut.
              </p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
