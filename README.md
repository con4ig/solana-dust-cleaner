# Solana Dust Cleaner (Open-Source Reclaim Tool)

Solana Dust Cleaner is a secure, open-source Web3 utility designed to help Solana users close empty, unused SPL Token accounts and reclaim the SOL rent deposit (approximately **0.002039 SOL** per account) locked inside them.

## Security & Trust First

Connecting your wallet and signing transactions online can feel risky. This tool is built from the ground up with **transparency and safety** as its primary design principles:

1. **No Custom Smart Contracts:** This tool does not use any custom or unverified smart contracts. All operations are built entirely client-side using the official, audited **Solana System Program** and **SPL Token Program**.
2. **Strict Zero-Balance Checks:** The Solana blockchain's official Token Program enforces that **only accounts with a balance of exactly 0 tokens can be closed**. If an account has any remaining balance, the transaction will fail automatically on-chain—your assets are mathematically secure.
3. **Auditable Transactions:** Before you sign any transaction in your wallet (e.g., Phantom, Solflare), your wallet will show you the exact list of instructions:
   - `CloseAccount` instructions pointing to the empty token accounts.
   - A single `Transfer` instruction for the developer commission.
4. **100% Open Source:** Every line of code is public, auditable, and can be run locally on your own machine.

---

## How it Works & Rent Mechanics

On the Solana blockchain, storing data requires a deposit of SOL to keep the account "rent-exempt".

- Creating a standard SPL Token account (e.g., when you buy a new token on a DEX or receive an airdrop) locks exactly **2,039,280 lamports (~0.002039 SOL)**.
- Over time, as you trade or sell tokens, you are left with many empty accounts that still hold this deposit.
- This tool bundles the closure of these empty accounts into a single transaction. The official Token Program burns the account state and returns the locked SOL directly to your wallet.

---

## Dynamic Commission Structure (Tiered Fees)

To maintain this tool, support open-source development, and pay for hosting, a small dynamic fee is deducted directly inside the transaction:

| Reclaimed SOL            | Commission Rate | Creator Fee Example                         |
| :----------------------- | :-------------: | :------------------------------------------ |
| **Below 0.05 SOL**       |     **5%**      | e.g., 0.0010 SOL fee on 0.020 SOL reclaimed |
| **0.05 SOL to 0.20 SOL** |     **2%**      | e.g., 0.0020 SOL fee on 0.100 SOL reclaimed |
| **Above 0.20 SOL**       |     **1%**      | e.g., 0.0030 SOL fee on 0.300 SOL reclaimed |

The fee is processed via a standard `SystemProgram.transfer` instruction included in the very same transaction.

---

## Run Locally

You don't have to trust our hosted website. You can clone this repository, inspect the code, and run it locally:

1. **Clone the repository:**

   ```bash
   git clone https://github.com/con4ig/solana-dust-cleaner.git
   cd solana-dust-cleaner
   ```

2. **Install dependencies:**

   ```bash
   npm install --ignore-scripts
   ```

3. **Start the development server:**

   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser to run the application locally.

---

## License

This project is open-source and released under the [MIT License](LICENSE). Feel free to audit, fork, or contribute.
