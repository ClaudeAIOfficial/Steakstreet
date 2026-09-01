# StakeStreet

A real Robinhood Chain website starter for staking Robinhood Stock Tokens.

## What is already live / real

- Connects an injected EVM wallet.
- Adds / switches to Robinhood Chain mainnet (chain ID 4663).
- Pulls the current canonical Stock Token metadata from Robinhood's public RHJ API.
- Pulls current Robinhood Stock Token quotes and applies `currentMultiplier` to display token-equivalent USD value.
- Reads real ERC-20 balances from the connected wallet.
- Once vault addresses are configured, reads onchain APR, staked principal, accrued rewards, and reward reserve.
- Executes real ERC-20 approve, stake, withdraw, and claim transactions.

## Reward model in this starter

`StakeStreetVault.sol` pays rewards in the **same Stock Token** that the user stakes. Example: a 5% APR AAPL vault pays AAPL Stock Tokens, not made-up UI points.

The yield is **protocol-funded**. The vault owner or treasury must transfer Stock Tokens into the vault's reward reserve with `fundRewards()`. The UI explicitly tells users this and never displays an APY unless a real vault exists.

This is intentionally transparent. A later version can replace or extend the reward source with a real lending strategy (for example Morpho markets on Robinhood Chain) without changing the basic user experience.

## Run the website

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Deploy to Vercel

1. Push this folder to GitHub.
2. Import the repo into Vercel.
3. Add the environment variables from `.env.example`.
4. Deploy.

The site works with live Robinhood market data before vaults are deployed. Staking buttons become active only for vault addresses you configure.

## Deploy a real vault

The contract is deliberately separated from the frontend. Do **not** put a private key into Vercel or any `NEXT_PUBLIC_*` variable.

Install deployment dependencies:

```bash
npm install --save-dev hardhat @nomicfoundation/hardhat-toolbox dotenv
```

Create `.env`:

```bash
PRIVATE_KEY=0xYOUR_DEPLOYER_PRIVATE_KEY
RH_RPC_URL=https://rpc.mainnet.chain.robinhood.com
```

Find the canonical Stock Token address from Robinhood's `/rhj/assets` endpoint or official Token Contracts page, then deploy:

```bash
STOCK_TOKEN=0xOFFICIAL_STOCK_TOKEN APR_BPS=500 npx hardhat run scripts/deploy-vault.cjs --network robinhood
```

`500` basis points = 5.00% APR.

Then fund the reward reserve. You must first `approve()` the vault to spend the reward Stock Tokens, then call:

```solidity
fundRewards(amount)
```

Finally add the deployed address to the matching Vercel variable, for example:

```bash
NEXT_PUBLIC_VAULT_AAPL=0xYourVault
```

Redeploy the frontend. The AAPL staking market becomes live.

## Important production work before real user funds

This code is an initial real implementation, **not an audited production protocol**. Before accepting public deposits:

- Have independent smart-contract auditors review the vault.
- Use a multisig / timelock for ownership.
- Add explicit jurisdiction and eligibility controls appropriate for Stock Tokens.
- Add monitoring for corporate actions and Stock Token status changes.
- Decide whether rewards remain treasury-funded or are generated through a lending strategy.
- Add rate-change rules so users are not surprised by APR changes.
- Add emergency procedures and public docs.

Robinhood Stock Tokens are tokenised debt securities that provide economic exposure to underlying securities; they are not direct ownership of the underlying shares. StakeStreet is an independent project and must not imply endorsement or affiliation with Robinhood.
