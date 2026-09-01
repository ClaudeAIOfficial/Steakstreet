export const ROBINHOOD_CHAIN = {
  id: 4663,
  hexId: "0x1237",
  name: "Robinhood Chain",
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrl: process.env.NEXT_PUBLIC_RH_RPC_URL || "https://rpc.mainnet.chain.robinhood.com",
  explorer: "https://robinhoodchain.blockscout.com"
} as const;

export const FEATURED = ["AAPL", "NVDA", "TSLA", "SPY", "QQQ"] as const;

export const VAULTS: Record<string, string | undefined> = {
  AAPL: process.env.NEXT_PUBLIC_VAULT_AAPL,
  NVDA: process.env.NEXT_PUBLIC_VAULT_NVDA,
  TSLA: process.env.NEXT_PUBLIC_VAULT_TSLA,
  SPY: process.env.NEXT_PUBLIC_VAULT_SPY,
  QQQ: process.env.NEXT_PUBLIC_VAULT_QQQ
};
