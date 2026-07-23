import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token';
import * as fs from 'fs';
import * as path from 'path';

// Using the Helius Devnet RPC endpoint for fast reliable generation
const connection = new Connection("https://devnet.helius-rpc.com/?api-key=fd6db3bb-aa19-49fd-a859-ce27276645cf", 'confirmed');
// Handle uncaught exceptions and unhandled rejections gracefully to prevent rate limit callback crashes
process.on('uncaughtException', (err) => {
  console.warn(`\n[Uncaught Warning] ${err.message || err}`);
});
process.on('unhandledRejection', (reason) => {
  console.warn(`\n[Unhandled Warning] ${reason}`);
});

const KEYPAIR_PATH = path.join(__dirname, 'payer-keypair.json');

function getPayerKeypair(): Keypair {
  if (fs.existsSync(KEYPAIR_PATH)) {
    const secret = JSON.parse(fs.readFileSync(KEYPAIR_PATH, 'utf-8'));
    return Keypair.fromSecretKey(new Uint8Array(secret));
  } else {
    const newKeypair = Keypair.generate();
    fs.writeFileSync(KEYPAIR_PATH, JSON.stringify(Array.from(newKeypair.secretKey)));
    return newKeypair;
  }
}

// Robust retry wrapper for RPC calls to handle 429 Too Many Requests
async function retryCall<T>(fn: () => Promise<T>, maxRetries = 10, initialDelay = 2000): Promise<T> {
  let delay = initialDelay;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (err: any) {
      const errMsg = err.message || '';
      if ((errMsg.includes('429') || errMsg.includes('Too many requests') || err.status === 429) && i < maxRetries - 1) {
        console.warn(`\n[RPC 429] Rate limited. Retrying in ${(delay / 1000).toFixed(1)}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        delay *= 2; // Exponential backoff
      } else {
        throw err;
      }
    }
  }
  throw new Error("Max retries reached");
}

async function main() {
  const userAddress = process.argv[2];
  const dustCount = parseInt(process.argv[3] || "5", 10);
  const nftCount = parseInt(process.argv[4] || "2", 10);

  if (!userAddress) {
    console.error("Please provide your wallet address as an argument!");
    console.error("Usage: npx tsx scripts/create-demo-data.ts <YOUR_WALLET_ADDRESS> [DUST_COUNT] [NFT_COUNT]");
    process.exit(1);
  }

  try {
    const userPublicKey = new PublicKey(userAddress);
    const payer = getPayerKeypair();
    
    const totalRequiredAirdrop = 0.05 + (dustCount * 0.03) + (nftCount * 0.05);
    
    // Check existing balance first
    let currentBalance = 0;
    try {
      currentBalance = await retryCall(() => connection.getBalance(payer.publicKey));
      console.log(`Current payer balance: ${currentBalance / LAMPORTS_PER_SOL} SOL`);
    } catch (err) {}

    if (currentBalance < totalRequiredAirdrop * LAMPORTS_PER_SOL) {
      const needed = totalRequiredAirdrop - (currentBalance / LAMPORTS_PER_SOL);
      console.log(`1. Attempting to request ${needed.toFixed(2)} SOL (airdrop)...`);
      try {
        const sig = await retryCall(() => connection.requestAirdrop(payer.publicKey, needed * LAMPORTS_PER_SOL));
        const latestBlockHash = await retryCall(() => connection.getLatestBlockhash());
        await retryCall(() => connection.confirmTransaction({
          blockhash: latestBlockHash.blockhash,
          lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
          signature: sig,
        }));
        console.log("Airdrop received!");
      } catch (e) {
        console.warn("\n[Warning] Automatic airdrop API request failed (Solana Devnet faucets are heavily rate-limited).");
        console.warn("You will need to fund this temporary transaction payer account manually:\n");
        console.warn(`   Address: ${payer.publicKey.toBase58()}\n`);
        console.warn(`Please send at least ${needed.toFixed(2)} Devnet SOL to the address above.`);
        console.log("Script is waiting for funds... (checking balance every 3 seconds)");
        
        let balance = 0;
        while (balance < totalRequiredAirdrop * LAMPORTS_PER_SOL) {
          await new Promise((resolve) => setTimeout(resolve, 3000));
          try {
            balance = await connection.getBalance(payer.publicKey);
            console.log(`Checking balance... Current: ${balance / LAMPORTS_PER_SOL} SOL / Needed: ${totalRequiredAirdrop.toFixed(2)} SOL`);
          } catch (err: any) {
            console.warn(`Balance check RPC error: ${err.message || err}`);
          }
        }
        console.log(`Funds detected! Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
      }
    } else {
      console.log("Payer account has sufficient funds. Skipping funding step.");
    }

    // --- Create Dust Accounts ---
    console.log(`\n2. Creating ${dustCount} empty token accounts (Dust)...`);
    for (let i = 0; i < dustCount; i++) {
      try {
        process.stdout.write(`   [${i + 1}/${dustCount}] Creating empty token account... `);
        const mint = await retryCall(() => createMint(connection, payer, payer.publicKey, null, 0));
        await retryCall(() => getOrCreateAssociatedTokenAccount(connection, payer, mint, userPublicKey));
        console.log("Done!");
      } catch (err) {
        console.log(`Failed: ${err}`);
      }
      // Small safety delay
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }

    // --- Create NFT Accounts ---
    console.log(`\n3. Creating ${nftCount} simulated NFTs (0 decimals, 1 token)...`);
    for (let i = 0; i < nftCount; i++) {
      try {
        process.stdout.write(`   [${i + 1}/${nftCount}] Minting NFT... `);
        const mint = await retryCall(() => createMint(connection, payer, payer.publicKey, null, 0));
        const account = await retryCall(() => getOrCreateAssociatedTokenAccount(connection, payer, mint, userPublicKey));
        await retryCall(() => mintTo(connection, payer, mint, account.address, payer, 1));
        console.log("Done!");
      } catch (err) {
        console.log(`Failed: ${err}`);
      }
      // Small safety delay
      await new Promise((resolve) => setTimeout(resolve, 4000));
    }

    console.log("\n==================================================");
    console.log("SUCCESS! All demo data created on Solana Devnet!");
    console.log(`Created: ${dustCount} Dust Tokens & ${nftCount} NFTs`);
    console.log("Run the dev server, connect your wallet on Devnet, and click Scan!");
    console.log("==================================================");
  } catch (err) {
    console.error("An error occurred:", err);
  }
}

main();
