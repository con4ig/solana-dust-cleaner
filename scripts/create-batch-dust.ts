import { Connection, Keypair, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import { createMint, getOrCreateAssociatedTokenAccount } from '@solana/spl-token';

const connection = new Connection("https://api.devnet.solana.com", 'confirmed');

async function main() {
  const userAddress = process.argv[2];
  const count = parseInt(process.argv[3] || "15", 10);
  
  if (!userAddress) {
    console.error("Please provide your wallet address as an argument!");
    console.error("Usage: npx tsx scripts/create-batch-dust.ts <YOUR_WALLET_ADDRESS> [COUNT]");
    process.exit(1);
  }

  try {
    const userPublicKey = new PublicKey(userAddress);
    const payer = Keypair.generate();
    
    console.log(`1. Attempting to automatically request 0.5 SOL (airdrop) for ${count} tokens...`);
    try {
      const sig = await connection.requestAirdrop(payer.publicKey, 0.5 * LAMPORTS_PER_SOL);
      const latestBlockHash = await connection.getLatestBlockhash();
      await connection.confirmTransaction({
        blockhash: latestBlockHash.blockhash,
        lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
        signature: sig,
      });
      console.log("Airdrop received!");
    } catch (e) {
      console.warn("\n[Warning] Automatic airdrop API request failed (public Solana Devnet faucets are frequently rate-limited/overloaded).");
      console.warn("You will need to fund this temporary transaction payer account manually.\n");
      console.warn("1. Visit: https://faucet.solana.com/ or https://solfaucet.com/");
      console.warn("2. Paste this temporary payer address (generated for this transaction):");
      console.warn(`   => ${payer.publicKey.toBase58()}`);
      console.warn("3. Request airdrop to the address above (min. 0.1 SOL).\n");
      console.warn("Alternatively: If you already have Devnet SOL on your Phantom wallet, send 0.1 SOL to the address above.");
      console.log("\nScript is waiting for funds... (checking balance every 3 seconds)");
      
      let balance = 0;
      while (balance < 0.05 * LAMPORTS_PER_SOL) {
        await new Promise((resolve) => setTimeout(resolve, 3000));
        try {
          balance = await connection.getBalance(payer.publicKey);
        } catch (err) {
          // ignore network hiccups
        }
      }
      console.log(`Funds detected! Balance: ${balance / LAMPORTS_PER_SOL} SOL`);
    }

    console.log(`\n2. Creating ${count} random test tokens (Mints)...`);
    for (let i = 0; i < count; i++) {
      try {
        process.stdout.write(`   [${i + 1}/${count}] Creating token... `);
        const mint = await createMint(connection, payer, payer.publicKey, null, 0);
        
        await getOrCreateAssociatedTokenAccount(
          connection, 
          payer, 
          mint, 
          userPublicKey
        );
        console.log("Done!");
      } catch (err) {
        console.log(`Failed: ${err}`);
      }
    }
    
    console.log("\nSuccess! Created multiple empty token accounts on Solana Devnet for address:", userAddress);
    console.log("You can now click 'Rescan' in the web app to find them!");
  } catch (err) {
    console.error("An error occurred:", err);
  }
}

main();
