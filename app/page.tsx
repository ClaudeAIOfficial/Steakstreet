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
    <main className="site">
      <section className="hero" id="top">
        <div className="hero-atmosphere" aria-hidden="true">
          <div className="hero-grid-lines" />
          <div className="hero-orbit orbit-one" />
          <div className="hero-orbit orbit-two" />
          <div className="hero-glow" />
        </div>

        <header className="nav shell">
          <a className="brand" href="#top" aria-label="StakeStreet home">
            <span className="brand-word">STAKE</span><span className="brand-word brand-outline">STREET</span>
          </a>
          <nav className="nav-links">
            <a href="#portfolio">Portfolio</a>
            <a href="#markets">Markets</a>
            <a href="#how">How it works</a>
          </nav>
          <div className="nav-actions">
            <button className={`network ${onCorrectChain ? "live" : ""}`} onClick={switchNetwork}>
              <span className="dot" /> Robinhood Chain
            </button>
            <button className="wallet" onClick={connect}>{account ? shortAddress(account) : "Connect wallet"}</button>
          </div>
        </header>

        <div className="hero-inner shell">
          <div className="hero-main">
            <div className="hero-label"><span>STOCK STAKING</span><span>ROBINHOOD CHAIN</span></div>
            <h1>The yield layer<br />for your <em>stocks.</em></h1>
          </div>

          <div className="hero-bottom">
            <div className="hero-counter">
              <span>YOUR STOCKS, WORKING OVERTIME</span>
              <strong>{account ? money.format(portfolioValue) : "$0.00"}</strong>
              <small>portfolio value detected</small>
            </div>
            <div className="hero-actions">
              <p>Keep exposure to the stocks you believe in while eligible Robinhood Stock Tokens earn transparent onchain rewards.</p>
              <div className="hero-links">
                <a href="#markets">Explore markets <b>↗</b></a>
                <a href="#how">How it works <b>↓</b></a>
              </div>
            </div>
          </div>
        </div>

        <div className="hero-index">00</div>
      </section>

      <section className="light-section section" id="portfolio">
        <div className="shell section-frame">
          <div className="section-marker">S.01</div>
          <div className="section-heading-grid">
            <div>
              <span className="overline">YOUR PORTFOLIO</span>
              <h2>Holding is no longer<br />the idle option.</h2>
            </div>
            <p>StakeStreet turns supported Stock Tokens into productive onchain positions without changing the asset you chose to hold.</p>
          </div>

          <div className="portfolio-showcase">
            <div className="portfolio-visual dark-panel">
              <div className="panel-top"><span>LIVE POSITION OVERVIEW</span><span className="live-indicator"><i /> ONCHAIN</span></div>
              <div className="portfolio-total">{account ? money.format(portfolioValue) : "$—"}</div>
              <span className="portfolio-caption">Detected Robinhood Stock Token value</span>
              <div className="portfolio-lines">
                {markets.slice(0, 3).map((market, index) => (
                  <div className="portfolio-line" key={market.tokenSymbol}>
                    <span className="line-index">0{index + 1}</span>
                    <div className="asset-ident">
                      <img src={market.logoUrl || ""} alt="" />
                      <div><b>{market.tokenSymbol}</b><span>{market.tokenName?.replace(" • Robinhood Token", "")}</span></div>
                    </div>
                    <div className="asset-values">
                      <b>{market.balance == null ? "—" : `${num.format(market.balance)} shares`}</b>
                      <span>{market.price ? money.format(market.price) : "Loading"}</span>
                    </div>
                  </div>
                ))}
              </div>
              {!account && <button className="panel-action" onClick={connect}>Connect wallet <span>↗</span></button>}
              {account && !onCorrectChain && <button className="panel-action" onClick={switchNetwork}>Switch network <span>↗</span></button>}
            </div>

            <div className="metric-grid">
              <article><span>PORTFOLIO VALUE</span><strong>{account ? money.format(portfolioValue) : "—"}</strong><small>Total detected value</small></article>
              <article><span>CURRENTLY STAKED</span><strong>{account ? money.format(stakedValue) : "—"}</strong><small>Principal in active vaults</small></article>
              <article><span>REWARDS EARNED</span><strong>{account ? money.format(rewardsValue) : "—"}</strong><small>Accrued onchain rewards</small></article>
              <article><span>NETWORK</span><strong className="accent-text">4663</strong><small>Robinhood Chain</small></article>
            </div>
          </div>
        </div>
      </section>

      <section className="dark-section section" id="markets">
        <div className="shell section-frame">
          <div className="section-marker">S.02</div>
          <div className="section-heading-grid dark-heading">
            <div>
              <span className="overline">MARKETS</span>
              <h2>Put every share<br />to work.</h2>
            </div>
            <p>Live Stock Token metadata and prices come from Robinhood. Yield appears only when a StakeStreet vault is deployed and funded onchain.</p>
          </div>

          <div className="ticker-marquee" aria-hidden="true">
            <span>NVDA</span><i>•</i><span>AAPL</span><i>•</i><span>TSLA</span><i>•</i><span>SPY</span><i>•</i><span>QQQ</span>
          </div>

          <div className="market-table-wrap">
            <table className="market-table">
              <thead><tr><th>#</th><th>Asset</th><th>Price</th><th>Your balance</th><th>APY</th><th>Reward reserve</th><th></th></tr></thead>
              <tbody>
                {loading && Array.from({ length: 5 }).map((_, i) => <tr key={i} className="skeleton-row"><td colSpan={7}><div /></td></tr>)}
                {!loading && markets.map((market, index) => (
                  <tr key={market.tokenSymbol}>
                    <td className="market-index">0{index + 1}</td>
                    <td><div className="asset-cell"><img src={market.logoUrl || ""} alt="" /><div><b>{market.tokenSymbol}</b><span>{market.tokenName?.replace(" • Robinhood Token", "")}</span></div></div></td>
                    <td><b>{market.price ? money.format(market.price) : "—"}</b><span className="muted">multiplier-adjusted</span></td>
                    <td><b>{market.balance == null ? (account ? "—" : "Connect") : num.format(market.balance)}</b><span className="muted">{market.balance && market.price ? money.format(market.balance * market.price) : ""}</span></td>
                    <td>{market.apr == null ? <span className="pending">Awaiting vault</span> : <span className="apy">{market.apr.toFixed(2)}%</span>}</td>
                    <td><b>{market.reserve == null ? "—" : `${num.format(market.reserve)} ${market.tokenSymbol}`}</b></td>
                    <td><button className="stake-btn" onClick={() => { setSelected(market); setAmount(""); }}>{market.vault ? "Stake ↗" : "View ↗"}</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="light-section section" id="how">
        <div className="shell section-frame">
          <div className="section-marker">S.03</div>
          <div className="section-heading-grid">
            <div>
              <span className="overline">THE MECHANISM</span>
              <h2>Three moves.<br />One position.</h2>
            </div>
            <p>Designed to feel as simple as holding, while every state change remains visible onchain.</p>
          </div>

          <div className="process-list">
            <article>
              <div className="process-number">01</div>
              <div className="process-title"><span className="process-icon">◎</span><h3>Connect</h3></div>
              <p>Connect an EVM wallet. StakeStreet detects supported Robinhood Stock Tokens held on chain 4663.</p>
            </article>
            <article>
              <div className="process-number">02</div>
              <div className="process-title"><span className="process-icon">↘</span><h3>Stake</h3></div>
              <p>Deposit Stock Tokens into a transparent vault. Your principal remains denominated in the same Stock Token.</p>
            </article>
            <article>
              <div className="process-number">03</div>
              <div className="process-title"><span className="process-icon">↗</span><h3>Earn</h3></div>
              <p>Funded rewards accrue against the position. Withdraw principal or claim earned tokens directly onchain.</p>
            </article>
          </div>
        </div>
      </section>

      <section className="final-section">
        <div className="shell final-inner">
          <div className="section-marker">S.04</div>
          <span className="overline">THE NEW HOLD</span>
          <h2>Don&apos;t sell your winners.<br /><em>Stake them.</em></h2>
          <div className="final-bottom">
            <p>A new layer for stock exposure on Robinhood Chain.</p>
            <button onClick={account ? switchNetwork : connect}>{account ? "Open your portfolio" : "Connect wallet"} <span>↗</span></button>
          </div>
        </div>
      </section>

      <footer className="footer">
        <div className="shell footer-inner">
          <a className="brand footer-brand" href="#top"><span className="brand-word">STAKE</span><span className="brand-word brand-outline">STREET</span></a>
          <div className="footer-links"><a href="#portfolio">Portfolio</a><a href="#markets">Markets</a><a href="#how">How it works</a></div>
          <p>Independent protocol built on Robinhood Chain. Not affiliated with or endorsed by Robinhood Markets, Inc. Stock Tokens carry financial and jurisdictional risks.</p>
          <span className="copyright">© 2026 StakeStreet</span>
        </div>
      </footer>

      {selected && (
        <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) setSelected(null); }}>
          <div className="modal">
            <button className="close" onClick={() => setSelected(null)}>×</button>
            <div className="modal-head-index">MARKET / {selected.tokenSymbol}</div>
            <div className="modal-asset"><img src={selected.logoUrl || ""} alt="" /><div><span>STAKE</span><h2>{selected.tokenSymbol}</h2><p>{selected.tokenName?.replace(" • Robinhood Token", "")}</p></div></div>
            <div className="modal-metrics">
              <div><span>Live price</span><b>{selected.price ? money.format(selected.price) : "—"}</b></div>
              <div><span>Vault APY</span><b className="accent-text">{selected.apr == null ? "—" : `${selected.apr.toFixed(2)}%`}</b></div>
              <div><span>Your balance</span><b>{selected.balance == null ? "—" : num.format(selected.balance)}</b></div>
            </div>
            {selected.vault ? (
              <>
                <div className="position-box"><div><span>Currently staked</span><b>{num.format(selected.principal || 0)} {selected.tokenSymbol}</b></div><div><span>Earned</span><b className="accent-text">{num.format(selected.earned || 0)} {selected.tokenSymbol}</b></div></div>
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
