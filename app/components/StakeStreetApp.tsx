"use client";

import { BrowserProvider, Contract, formatEther, formatUnits, parseUnits } from "ethers";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ERC20_ABI, VAULT_ABI } from "@/app/lib/abi";
import { FEATURED, ROBINHOOD_CHAIN, VAULTS } from "@/app/lib/chain";

type Eip1193 = {
  request(args: { method: string; params?: unknown[] | object }): Promise<unknown>;
  on?: (event: string, handler: (...args: unknown[]) => void) => void;
  removeListener?: (event: string, handler: (...args: unknown[]) => void) => void;
};

declare global {
  interface Window { ethereum?: Eip1193; }
}

type Asset = {
  tokenSymbol: string;
  tokenName: string;
  logoUrl?: string;
  currentMultiplier?: string;
  status?: string;
  deployments?: Array<{ contractAddress: string; chainId: number }>;
};

type Market = Asset & {
  address: string;
  price: number | null;
  rawPrice: number | null;
  balance: number | null;
  apr: number | null;
  principal: number | null;
  earned: number | null;
  reserve: number | null;
  vault?: string;
};

const money = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 2 });
const num = new Intl.NumberFormat("en-US", { maximumFractionDigits: 4 });

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function getInjectedProvider() {
  return typeof window !== "undefined" ? window.ethereum : undefined;
}

export default function StakeStreetApp() {
  const [account, setAccount] = useState("");
  const [chainId, setChainId] = useState<number | null>(null);
  const [assets, setAssets] = useState<Asset[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selected, setSelected] = useState<Market | null>(null);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState("");
  const [toast, setToast] = useState("");
  const [loading, setLoading] = useState(true);

  const onCorrectChain = chainId === ROBINHOOD_CHAIN.id;

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 4200);
  }, []);

  const switchNetwork = useCallback(async () => {
    const eth = getInjectedProvider();
    if (!eth) return showToast("Install an EVM wallet such as MetaMask or Robinhood Wallet.");

    try {
      await eth.request({ method: "wallet_switchEthereumChain", params: [{ chainId: ROBINHOOD_CHAIN.hexId }] });
    } catch (error: unknown) {
      const code = typeof error === "object" && error && "code" in error ? Number((error as { code: unknown }).code) : 0;
      if (code === 4902) {
        await eth.request({
          method: "wallet_addEthereumChain",
          params: [{
            chainId: ROBINHOOD_CHAIN.hexId,
            chainName: ROBINHOOD_CHAIN.name,
            nativeCurrency: ROBINHOOD_CHAIN.nativeCurrency,
            rpcUrls: [ROBINHOOD_CHAIN.rpcUrl],
            blockExplorerUrls: [ROBINHOOD_CHAIN.explorer]
          }]
        });
      } else {
        showToast("Network switch was cancelled.");
      }
    }
  }, [showToast]);

  const connect = useCallback(async () => {
    const eth = getInjectedProvider();
    if (!eth) return showToast("Install an EVM wallet such as MetaMask or Robinhood Wallet.");
    try {
      const accounts = await eth.request({ method: "eth_requestAccounts" }) as string[];
      const hex = await eth.request({ method: "eth_chainId" }) as string;
      setAccount(accounts?.[0] || "");
      setChainId(parseInt(hex, 16));
      if (parseInt(hex, 16) !== ROBINHOOD_CHAIN.id) await switchNetwork();
    } catch {
      showToast("Wallet connection was cancelled.");
    }
  }, [showToast, switchNetwork]);

  useEffect(() => {
    const eth = getInjectedProvider();
    if (!eth) return;

    eth.request({ method: "eth_accounts" }).then((v) => {
      const accounts = v as string[];
      if (accounts?.[0]) setAccount(accounts[0]);
    }).catch(() => {});
    eth.request({ method: "eth_chainId" }).then((v) => setChainId(parseInt(v as string, 16))).catch(() => {});

    const onAccounts = (...args: unknown[]) => setAccount(((args[0] as string[])?.[0]) || "");
    const onChain = (...args: unknown[]) => setChainId(parseInt(args[0] as string, 16));
    eth.on?.("accountsChanged", onAccounts);
    eth.on?.("chainChanged", onChain);
    return () => {
      eth.removeListener?.("accountsChanged", onAccounts);
      eth.removeListener?.("chainChanged", onChain);
    };
  }, []);

  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const response = await fetch("/api/assets");
        const data = await response.json();
        const all = (data.assets || []) as Asset[];
        setAssets(all);
        const featured = FEATURED.map((symbol) => all.find((a) => a.tokenSymbol === symbol)).filter(Boolean) as Asset[];

        const base: Market[] = featured.flatMap((asset) => {
          const deployment = asset.deployments?.find((d) => d.chainId === ROBINHOOD_CHAIN.id);
          if (!deployment) return [];
          return [{
            ...asset,
            address: deployment.contractAddress,
            price: null,
            rawPrice: null,
            balance: null,
            apr: null,
            principal: null,
            earned: null,
            reserve: null,
            vault: VAULTS[asset.tokenSymbol]
          }];
        });
        setMarkets(base);

        const withQuotes = await Promise.all(base.map(async (market) => {
          try {
            const q = await fetch(`/api/quote/${market.tokenSymbol}`).then((r) => r.json());
            const quote = q.quotes?.[0];
            const raw = quote ? (Number(quote.bid) + Number(quote.ask)) / 2 : null;
            const multiplier = Number(market.currentMultiplier || "1");
            return { ...market, rawPrice: raw, price: raw == null ? null : raw * multiplier };
          } catch {
            return market;
          }
        }));
        setMarkets(withQuotes);
      } catch {
        showToast("Could not load Robinhood Stock Token data.");
      } finally {
        setLoading(false);
      }
    })();
  }, [showToast]);

  const refreshWalletData = useCallback(async () => {
    const eth = getInjectedProvider();
    if (!eth || !account || !onCorrectChain || markets.length === 0) return;

    try {
      const provider = new BrowserProvider(eth as never);
      const enriched = await Promise.all(markets.map(async (market) => {
        try {
          const token = new Contract(market.address, ERC20_ABI, provider);
          const decimals = Number(await token.decimals());
          const balance = Number(formatUnits(await token.balanceOf(account), decimals));

          if (!market.vault) return { ...market, balance };
          const vault = new Contract(market.vault, VAULT_ABI, provider);
          const [aprBps, principal, earned, reserve] = await Promise.all([
            vault.aprBps(), vault.principalOf(account), vault.earned(account), vault.rewardReserve()
          ]);
          return {
            ...market,
            balance,
            apr: Number(aprBps) / 100,
            principal: Number(formatUnits(principal, decimals)),
            earned: Number(formatUnits(earned, decimals)),
            reserve: Number(formatUnits(reserve, decimals))
          };
        } catch {
          return market;
        }
      }));
      setMarkets(enriched);
      if (selected) setSelected(enriched.find((m) => m.tokenSymbol === selected.tokenSymbol) || selected);
    } catch {
      // Wallet reads can fail while switching networks; no intrusive error needed.
    }
  }, [account, markets.length, onCorrectChain, selected]);

  useEffect(() => {
    if (account && onCorrectChain) refreshWalletData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [account, onCorrectChain, markets.length]);

  const portfolioValue = useMemo(() => markets.reduce((sum, m) => sum + ((m.balance || 0) * (m.price || 0)), 0), [markets]);
  const stakedValue = useMemo(() => markets.reduce((sum, m) => sum + ((m.principal || 0) * (m.price || 0)), 0), [markets]);
  const rewardsValue = useMemo(() => markets.reduce((sum, m) => sum + ((m.earned || 0) * (m.price || 0)), 0), [markets]);

  async function transact(action: "stake" | "withdraw" | "claim") {
    if (!selected?.vault || !account) return;
    const eth = getInjectedProvider();
    if (!eth) return;
    if (!onCorrectChain) return switchNetwork();

    try {
      setBusy(action);
      const provider = new BrowserProvider(eth as never);
      const signer = await provider.getSigner();
      const token = new Contract(selected.address, ERC20_ABI, signer);
      const vault = new Contract(selected.vault, VAULT_ABI, signer);
      const decimals = Number(await token.decimals());

      if (action === "stake") {
        const value = parseUnits(amount || "0", decimals);
        if (value <= BigInt(0)) throw new Error("Enter an amount");
        const allowance = await token.allowance(account, selected.vault);
        if (allowance < value) {
          showToast("Approve the Stock Token first…");
          const approval = await token.approve(selected.vault, value);
          await approval.wait();
        }
        showToast("Staking transaction submitted…");
        const tx = await vault.stake(value);
        await tx.wait();
        setAmount("");
        showToast(`${selected.tokenSymbol} staked successfully.`);
      }

      if (action === "withdraw") {
        const value = parseUnits(amount || "0", decimals);
        if (value <= BigInt(0)) throw new Error("Enter an amount");
        showToast("Withdrawal submitted…");
        const tx = await vault.withdraw(value);
        await tx.wait();
        setAmount("");
        showToast(`${selected.tokenSymbol} withdrawn.`);
      }

      if (action === "claim") {
        showToast("Claim submitted…");
        const tx = await vault.claim();
        await tx.wait();
        showToast("Rewards claimed.");
      }

      await refreshWalletData();
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Transaction failed";
      showToast(message.includes("user rejected") ? "Transaction cancelled." : message.slice(0, 110));
    } finally {
      setBusy("");
    }
  }

  return (
    <main>
      <header className="nav shell">
        <a className="brand" href="#top" aria-label="StakeStreet home">
          <span className="brand-mark">S</span>
          <span>StakeStreet</span>
        </a>
        <nav className="nav-links">
          <a href="#markets">Markets</a>
          <a href="#portfolio">Portfolio</a>
          <a href="#how">How it works</a>
        </nav>
        <div className="nav-actions">
          <button className={`network ${onCorrectChain ? "live" : ""}`} onClick={switchNetwork}>
            <span className="dot" /> Robinhood Chain
          </button>
          <button className="wallet" onClick={connect}>{account ? shortAddress(account) : "Connect wallet"}</button>
        </div>
      </header>

      <section className="hero shell" id="top">
        <div className="hero-copy">
          <div className="eyebrow"><span className="pulse" /> BUILT ON ROBINHOOD CHAIN</div>
          <h1>Don&apos;t sell your winners.<br /><span>Put them to work.</span></h1>
          <p>Stake eligible Robinhood Stock Tokens, keep your market exposure, and earn transparent onchain rewards while you hold.</p>
          <div className="hero-buttons">
            <a className="primary" href="#markets">Explore markets <span>↗</span></a>
            <a className="secondary" href="#how">How StakeStreet works</a>
          </div>
          <div className="trust-row"><span>Self-custody</span><i /> <span>Onchain positions</span><i /> <span>Live Robinhood data</span></div>
        </div>
        <div className="hero-card">
          <div className="card-top"><span>YOUR PORTFOLIO</span><span className="live-tag">LIVE</span></div>
          <div className="portfolio-number">{account ? money.format(portfolioValue) : "$—"}</div>
          <div className="portfolio-sub">Detected Robinhood Stock Tokens</div>
          <div className="mini-list">
            {markets.slice(0, 3).map((market) => (
              <div className="mini-row" key={market.tokenSymbol}>
                <img src={market.logoUrl || ""} alt="" />
                <div><b>{market.tokenSymbol}</b><span>{market.tokenName?.replace(" • Robinhood Token", "")}</span></div>
                <div className="mini-right"><b>{market.balance == null ? "—" : `${num.format(market.balance)} shares`}</b><span>{market.price ? money.format(market.price) : "Loading"}</span></div>
              </div>
            ))}
          </div>
          {!account && <button className="card-connect" onClick={connect}>Connect to detect your stocks</button>}
          {account && !onCorrectChain && <button className="card-connect" onClick={switchNetwork}>Switch to Robinhood Chain</button>}
        </div>
      </section>

      <section className="stats shell" id="portfolio">
        <div><span>Portfolio value</span><b>{account ? money.format(portfolioValue) : "—"}</b></div>
        <div><span>Currently staked</span><b>{account ? money.format(stakedValue) : "—"}</b></div>
        <div><span>Rewards earned</span><b>{account ? money.format(rewardsValue) : "—"}</b></div>
        <div><span>Network</span><b className="green">Robinhood Chain</b></div>
      </section>

      <section className="markets-section shell" id="markets">
        <div className="section-head">
          <div><span className="kicker">STOCK STAKING</span><h2>Make every share work harder.</h2></div>
          <p>Live Stock Token metadata and prices come directly from Robinhood. APY appears only when a real StakeStreet vault is deployed and funded.</p>
        </div>
        <div className="market-table-wrap">
          <table className="market-table">
            <thead><tr><th>Asset</th><th>Price</th><th>Your balance</th><th>APY</th><th>Reward reserve</th><th></th></tr></thead>
            <tbody>
              {loading && Array.from({ length: 5 }).map((_, i) => <tr key={i} className="skeleton-row"><td colSpan={6}><div /></td></tr>)}
              {!loading && markets.map((market) => (
                <tr key={market.tokenSymbol}>
                  <td><div className="asset-cell"><img src={market.logoUrl || ""} alt="" /><div><b>{market.tokenSymbol}</b><span>{market.tokenName?.replace(" • Robinhood Token", "")}</span></div></div></td>
                  <td><b>{market.price ? money.format(market.price) : "—"}</b><span className="muted">multiplier-adjusted</span></td>
                  <td><b>{market.balance == null ? (account ? "—" : "Connect") : num.format(market.balance)}</b><span className="muted">{market.balance && market.price ? money.format(market.balance * market.price) : ""}</span></td>
                  <td>{market.apr == null ? <span className="pending">Awaiting vault</span> : <span className="apy">{market.apr.toFixed(2)}%</span>}</td>
                  <td><b>{market.reserve == null ? "—" : `${num.format(market.reserve)} ${market.tokenSymbol}`}</b></td>
                  <td><button className="stake-btn" onClick={() => { setSelected(market); setAmount(""); }}>{market.vault ? "Stake" : "View"}</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="how shell" id="how">
        <div className="section-head"><div><span className="kicker">THE MODEL</span><h2>Hold the stock. Earn on the stock.</h2></div></div>
        <div className="steps">
          <article><span>01</span><div className="step-icon">◎</div><h3>Connect</h3><p>Connect an EVM wallet and StakeStreet detects eligible Robinhood Stock Tokens on chain 4663.</p></article>
          <article><span>02</span><div className="step-icon">↘</div><h3>Stake</h3><p>Deposit Stock Tokens into a transparent vault contract. Your principal remains denominated in the same Stock Token.</p></article>
          <article><span>03</span><div className="step-icon">↗</div><h3>Earn</h3><p>Rewards accrue block by block from the funded reward reserve. Withdraw principal or claim rewards onchain.</p></article>
        </div>
      </section>

      <footer className="footer shell">
        <div className="brand"><span className="brand-mark">S</span><span>StakeStreet</span></div>
        <p>Independent protocol built on Robinhood Chain. Not affiliated with or endorsed by Robinhood Markets, Inc. Stock Tokens carry financial and jurisdictional risks.</p>
        <span>© 2026 StakeStreet</span>
      </footer>

      {selected && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div className="modal">
            <button className="close" onClick={() => setSelected(null)}>×</button>
            <div className="modal-asset"><img src={selected.logoUrl || ""} alt="" /><div><span>STAKE</span><h2>{selected.tokenSymbol}</h2><p>{selected.tokenName?.replace(" • Robinhood Token", "")}</p></div></div>
            <div className="modal-metrics">
              <div><span>Live price</span><b>{selected.price ? money.format(selected.price) : "—"}</b></div>
              <div><span>Vault APY</span><b className="green">{selected.apr == null ? "—" : `${selected.apr.toFixed(2)}%`}</b></div>
              <div><span>Your balance</span><b>{selected.balance == null ? "—" : num.format(selected.balance)}</b></div>
            </div>
            {selected.vault ? (
              <>
                <div className="position-box"><div><span>Currently staked</span><b>{num.format(selected.principal || 0)} {selected.tokenSymbol}</b></div><div><span>Earned</span><b className="green">{num.format(selected.earned || 0)} {selected.tokenSymbol}</b></div></div>
                <label className="amount-label"><span>Amount</span><button onClick={() => setAmount(String(selected.balance || 0))}>MAX</button></label>
                <div className="amount-input"><input inputMode="decimal" placeholder="0.00" value={amount} onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ""))} /><span>{selected.tokenSymbol}</span></div>
                <div className="modal-actions"><button disabled={!!busy || !account} onClick={() => transact("stake")}>{busy === "stake" ? "Confirming…" : "Stake shares"}</button><button className="outline" disabled={!!busy || !account} onClick={() => transact("withdraw")}>Withdraw</button></div>
                <button className="claim" disabled={!!busy || !account || !(selected.earned && selected.earned > 0)} onClick={() => transact("claim")}>Claim {selected.earned ? `${num.format(selected.earned)} ${selected.tokenSymbol}` : "rewards"}</button>
                <p className="modal-note">Rewards are paid from the vault&apos;s onchain reward reserve. APY is not guaranteed if the reserve is depleted.</p>
              </>
            ) : (
              <div className="undeployed">
                <span>VAULT NOT DEPLOYED</span>
                <h3>The market data is live. The staking contract is ready to deploy.</h3>
                <p>Deploy <code>StakeStreetVault.sol</code> for {selected.tokenSymbol}, fund its reward reserve, then add the contract address to your Vercel environment variables. The Stake button activates automatically.</p>
              </div>
            )}
            <a className="contract-link" href={`${ROBINHOOD_CHAIN.explorer}/address/${selected.address}`} target="_blank" rel="noreferrer">View official Stock Token contract ↗</a>
          </div>
        </div>
      )}

      {toast && <div className="toast">{toast}</div>}
    </main>
  );
}
