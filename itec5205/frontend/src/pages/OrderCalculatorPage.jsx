import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../api/client";
import TickerPicker, { loadCompanies } from "../components/TickerPicker";
import { InfoPanels, PageHeader, StatTiles } from "../components/PageParts";
import { computeOrders, usdCadRate } from "../features/orders/orderMath";
import { getSettings } from "../features/settings/settings";
import {
  BarChartIcon,
  CalculatorIcon,
  CloseIcon,
  DownloadIcon,
  ImageIcon,
  LayersIcon,
  PieChartIcon,
  PlusIcon,
  SpinnerIcon,
  TrendChartIcon,
  WorkflowIcon,
} from "../layout/icons";

const SAVE_DELAY_MS = 800;
const LIVE_REFRESH_MS = 60 * 1000; // prices + rate while the page is open and visible
const cad = (v) => (Number.isFinite(v) ? v.toLocaleString(undefined, { style: "currency", currency: "CAD" }) : "–");
const usd = (v) => (Number.isFinite(v) ? `US${v.toLocaleString(undefined, { style: "currency", currency: "USD" })}` : "–");
const units = (v, fractional) => (Number.isFinite(v) ? v.toLocaleString(undefined, { maximumFractionDigits: fractional ? 4 : 0 }) : "–");
const fmtTime = (iso) => (iso ? new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" }) : "");
const fmtDay = (d) => (d ? new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "");
const newId = () => Math.random().toString(36).slice(2, 10);
const STATUS_CLASS = { BUY: "green", SELL: "red", HOLD: "grey" };

/** Change since the previous close: green up, red down, neutral when flat/unknown. */
function Change({ pct }) {
  if (pct === null || pct === undefined) return null;
  const color = pct > 0 ? "#16a34a" : pct < 0 ? "#dc2626" : undefined;
  return (
    <span style={{ color, fontWeight: 600, whiteSpace: "nowrap" }} title="Change since the previous close">
      {pct > 0 ? "▲" : pct < 0 ? "▼" : ""} {pct > 0 ? "+" : ""}{pct.toFixed(2)}%
    </span>
  );
}

function defaultPlan() {
  const p = getSettings().portfolio;
  return {
    fx: { rate: p.order_usd_cad ?? 1.4, direction: "usd_cad", source: "yahoo", date: null },
    targets: [],
    prices: {},
    accounts: [{ id: newId(), name: "My account", cash: "", holdings: {} }],
    options: {
      allowSell: p.order_allow_sell ?? true,
      fractional: p.order_fractional ?? false,
      spendLeftover: p.order_spend_leftover ?? true,
    },
    activeAccount: null,
  };
}

/** Percentages that add up to exactly `total` with 2 decimals (largest remainder). */
function roundToTotal(values, total = 100) {
  const sum = values.reduce((s, v) => s + v, 0);
  if (!(sum > 0)) return values.map(() => 0);
  const raw = values.map((v) => (v / sum) * total * 100);
  const floors = raw.map(Math.floor);
  let rest = Math.round(total * 100) - floors.reduce((s, v) => s + v, 0);
  raw.map((v, i) => [v - floors[i], i]).sort((a, b) => b[0] - a[0]).forEach(([, i]) => {
    if (rest > 0) {
      floors[i] += 1;
      rest -= 1;
    }
  });
  return floors.map((v) => v / 100);
}

function Toggle({ label, help, checked, onChange }) {
  return (
    <label className="toggle" title={help}>
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="toggle-track"><span className="toggle-thumb" /></span>
      <span>{label}</span>
    </label>
  );
}

function csvCell(v) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function download(name, rows) {
  const blob = new Blob([rows.map((r) => r.map(csvCell).join(",")).join("\n")], { type: "text/csv" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function OrderCalculatorPage() {
  const [plan, setPlan] = useState(null);
  const [companies, setCompanies] = useState({});
  const [portfolios, setPortfolios] = useState([]);
  const [saveState, setSaveState] = useState("");
  const [message, setMessage] = useState(null);
  const [pricesAt, setPricesAt] = useState(null);
  const [refreshing, setRefreshing] = useState(false);
  const saveTimer = useRef(null);
  const loaded = useRef(false);

  // ---- load: saved plan, company names, portfolios; then refresh rate + prices
  useEffect(() => {
    loadCompanies().then((list) => setCompanies(Object.fromEntries(list.map((c) => [c.ticker, c])))).catch(() => {});
    apiClient
      .get("/api/portfolios")
      .then((r) => setPortfolios([...(r.data.portfolios || [])].sort((a, b) => (b.created_at || "").localeCompare(a.created_at || "")))) // newest first.catch(() => {});
    apiClient
      .get("/api/orders/plan")
      .then((r) => {
        const saved = r.data.plan;
        const base = defaultPlan();
        const p = saved ? { ...base, ...saved, fx: { ...base.fx, ...saved.fx }, options: { ...base.options, ...saved.options } } : base;
        if (!p.accounts?.length) p.accounts = base.accounts;
        setPlan(p);
        loaded.current = true;
        if (p.fx.source !== "manual") fetchRate(true);
        refreshPrices(p, false);
      })
      .catch((err) => setMessage(err.response?.data?.error || err.message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ---- autosave
  useEffect(() => {
    if (!plan || !loaded.current) return;
    clearTimeout(saveTimer.current);
    setSaveState("Saving…");
    saveTimer.current = setTimeout(() => {
      apiClient
        .put("/api/orders/plan", { plan })
        .then(() => setSaveState("Saved"))
        .catch((err) => setSaveState(`Not saved: ${err.response?.data?.error || err.message}`));
    }, SAVE_DELAY_MS);
    return () => clearTimeout(saveTimer.current);
  }, [plan]);

  const update = (fn) => setPlan((p) => ({ ...p, ...fn(p) }));

  const fetchRate = (quiet) =>
    apiClient
      .get("/api/orders/fx")
      .then(({ data }) =>
        update((p) =>
          p.fx.source === "manual" && quiet
            ? {} // typed while the request was out
            : { fx: { ...p.fx, rate: p.fx.direction === "cad_usd" ? +(1 / data.usd_cad).toFixed(4) : data.usd_cad, source: "yahoo", date: data.as_of } }
        )
      )
      .catch((err) => !quiet && setMessage(`Latest rate unavailable: ${err.response?.data?.error || err.message}`));

  // Live prices (Yahoo; the stored close when Yahoo has nothing) for every
  // ticker in the plan; typed prices are kept unless `force`.
  const refreshPrices = (p, force) => {
    const tickers = [...new Set([...p.targets.map((t) => t.ticker), ...p.accounts.flatMap((a) => Object.keys(a.holdings))])];
    if (!tickers.length) return Promise.resolve();
    setRefreshing(true);
    return apiClient
      .get("/api/orders/prices", { params: { tickers: tickers.join(",") } })
      .then(({ data }) => {
        update((cur) => {
          const prices = { ...cur.prices };
          for (const [t, row] of Object.entries(data.prices)) {
            if (row.price == null) continue;
            if (!force && prices[t]?.source === "manual") continue;
            prices[t] = { price: row.price, change_pct: row.change_pct, source: row.source, date: row.date || null, as_of: row.as_of || null };
          }
          return { prices };
        });
        setPricesAt(new Date().toISOString());
      })
      .catch((err) => setMessage(`Prices unavailable: ${err.response?.data?.error || err.message}`))
      .finally(() => setRefreshing(false));
  };

  // Keep prices and the rate current while the page is open (paused in a hidden tab).
  const planRef = useRef(null);
  planRef.current = plan;
  useEffect(() => {
    const id = setInterval(() => {
      const p = planRef.current;
      if (!p || document.hidden) return;
      refreshPrices(p, false);
      if (p.fx.source !== "manual") fetchRate(true);
    }, LIVE_REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const ensurePrices = (tickers) => {
    const missing = tickers.filter((t) => !plan.prices[t]);
    if (missing.length) refreshPrices({ targets: missing.map((ticker) => ({ ticker })), accounts: [] }, false);
  };

  // ---- targets
  const targetTickers = plan ? plan.targets.map((t) => t.ticker) : [];
  const allocSum = plan ? plan.targets.reduce((s, t) => s + (Number(t.alloc) || 0), 0) : 0;
  const setTargets = (tickers) => {
    update((p) => {
      const byTicker = Object.fromEntries(p.targets.map((t) => [t.ticker, t]));
      return { portfolioId: null, targets: tickers.map((t) => byTicker[t] || { ticker: t, alloc: "" }) };
    });
    ensurePrices(tickers);
  };
  // Typed target %: capped so all targets add up to at most 100.
  const setAlloc = (ticker, value) =>
    update((p) => {
      const others = p.targets.filter((t) => t.ticker !== ticker).reduce((s, t) => s + (Number(t.alloc) || 0), 0);
      const room = Math.max(0, +(100 - others).toFixed(2));
      const v = value === "" ? "" : String(Math.min(Math.max(0, Number(value)), room));
      return { portfolioId: null, targets: p.targets.map((t) => (t.ticker === ticker ? { ...t, alloc: v } : t)) };
    });
  const equalWeights = () => update((p) => {
    const w = roundToTotal(p.targets.map(() => 1));
    return { targets: p.targets.map((t, i) => ({ ...t, alloc: String(w[i]) })) };
  });
  const normalize = () => update((p) => {
    const w = roundToTotal(p.targets.map((t) => Number(t.alloc) || 0));
    return { targets: p.targets.map((t, i) => ({ ...t, alloc: String(w[i]) })) };
  });
  const loadPortfolio = (id) => {
    const pf = portfolios.find((x) => x._key === id);
    if (!pf) return;
    const w = roundToTotal(pf.holdings.map((h) => h.weight));
    update(() => ({ portfolioId: id, targets: pf.holdings.map((h, i) => ({ ticker: h.ticker, alloc: String(w[i]) })) }));
    ensurePrices(pf.holdings.map((h) => h.ticker));
  };
  const setPrice = (ticker, value) =>
    update((p) => ({ prices: { ...p.prices, [ticker]: { price: value, date: null, source: "manual" } } }));
  // Back to the live price for one typed price.
  const backToLive = (ticker) => {
    update((p) => {
      const prices = { ...p.prices };
      delete prices[ticker];
      return { prices };
    });
    refreshPrices({ targets: [{ ticker }], accounts: [] }, true);
  };

  // ---- accounts
  const account = plan ? plan.accounts.find((a) => a.id === plan.activeAccount) || plan.accounts[0] : null;
  const setAccount = (patch) => update((p) => ({ accounts: p.accounts.map((a) => (a.id === account.id ? { ...a, ...patch } : a)) }));
  const setUnits = (ticker, value) => setAccount({ holdings: { ...account.holdings, [ticker]: value } });
  const addAccount = () => {
    const id = newId();
    update((p) => ({ accounts: [...p.accounts, { id, name: `Account ${p.accounts.length + 1}`, cash: "", holdings: {} }], activeAccount: id }));
  };
  const removeAccount = (id) => {
    if (plan.accounts.length === 1) return;
    const a = plan.accounts.find((x) => x.id === id);
    if (!window.confirm(`Remove the account "${a.name}" and its holdings from the calculator?`)) return;
    update((p) => ({ accounts: p.accounts.filter((x) => x.id !== id), activeAccount: null }));
  };
  // Fill the account from a positions screenshot (same reader as Import
  // Portfolio): units held per US ticker, and the statement's cash as the funds.
  const [reading, setReading] = useState(false);
  const [statementNote, setStatementNote] = useState(null);
  const readStatement = async (file) => {
    if (!file) return;
    const hasUnits = Object.values(account.holdings).some((v) => Number(v) > 0);
    if (hasUnits && !window.confirm(`Replace the units held in "${account.name}" with the ones in ${file.name || "the screenshot"}?`)) return;
    setReading(true);
    setMessage(null);
    setStatementNote(null);
    try {
      const body = new FormData();
      body.append("file", file, file.name || "screenshot.png");
      const { data } = await apiClient.post("/api/portfolios/import-image", body, { headers: { "Content-Type": "multipart/form-data" } });
      const holdings = Object.fromEntries(targetTickers.map((tk) => [tk, ""]));
      const skipped = [];
      const fixed = [];
      for (const p of data.positions) {
        if (!p.usd || p.quantity == null) {
          skipped.push(`${p.ticker} ${p.security || ""} (${p.quantity ?? "?"})`.replace(/\s+/g, " "));
          continue;
        }
        if (p.read_as) fixed.push(`${p.read_as} → ${p.ticker}`);
        holdings[p.ticker] = String((Number(holdings[p.ticker]) || 0) + p.quantity);
      }
      setAccount({ holdings, ...(data.cash != null ? { cash: String(data.cash) } : {}) });
      ensurePrices(Object.keys(holdings));
      const read = data.positions.length - skipped.length;
      setStatementNote(
        [
          `Read ${read} positions from ${file.name || "the screenshot"}${data.cash != null ? ` and ${cad(data.cash)} of cash` : " (no cash found — type the funds)"}.`,
          fixed.length ? `Corrected tickers: ${fixed.join(", ")}.` : "",
          skipped.length ? `Not priced in USD, left out: ${skipped.join("; ")}.` : "",
        ].filter(Boolean).join(" ")
      );
    } catch (err) {
      setMessage(err.response?.data?.error || err.message);
    } finally {
      setReading(false);
    }
  };

  // Stocks held but not in the targets: target 0% -> sold (rebalance mode).
  const otherHeld = account ? Object.keys(account.holdings).filter((t) => !targetTickers.includes(t)) : [];

  const usdCad = plan ? usdCadRate(plan.fx.rate, plan.fx.direction) : NaN;
  const rowsFor = (acc) =>
    [...plan.targets.map((t) => ({ ticker: t.ticker, alloc: t.alloc })), ...Object.keys(acc.holdings).filter((t) => !targetTickers.includes(t)).map((ticker) => ({ ticker, alloc: 0 }))].map(
      (r) => ({ ...r, price: plan.prices[r.ticker]?.price ?? "", qty: acc.holdings[r.ticker] ?? "" })
    );
  const results = useMemo(() => {
    if (!plan) return {};
    return Object.fromEntries(
      plan.accounts.map((a) => [a.id, computeOrders({ cash: a.cash, usdCad, rows: rowsFor(a), ...plan.options })])
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [plan, usdCad]);

  if (!plan) {
    return (
      <div>
        <PageHeader icon={CalculatorIcon} color="#0ea5e9" title="Order Calculator" description="Loading…" />
        {message && <p className="error-text">{message}</p>}
      </div>
    );
  }

  const res = results[account.id];
  const t = res.totals;
  const fractional = plan.options.fractional;
  const tiles = [
    { icon: LayersIcon, color: "#0ea5e9", label: "Account value", value: cad(t.totalCad), sub: `${cad(t.cashCad)} cash + ${cad(t.holdingsCad)} stocks` },
    { icon: TrendChartIcon, color: "#16a34a", label: "Buy", value: cad(t.buysCad), sub: `${res.lines.filter((l) => l.status === "BUY").length} orders` },
    { icon: BarChartIcon, color: "#dc2626", label: "Sell", value: cad(t.sellsCad), sub: `${res.lines.filter((l) => l.status === "SELL").length} orders` },
    {
      icon: PieChartIcon,
      color: "#f59e0b",
      label: "Cash after orders",
      value: cad(t.cashAfterCad),
      sub: Number.isFinite(t.cashAfterCad) && t.totalCad > 0 ? `${((100 * t.cashAfterCad) / t.totalCad).toFixed(2)}% of the account uninvested` : "–",
    },
  ];

  const exportAccount = (acc) => {
    const r = results[acc.id];
    const head = ["Account", "Ticker", "Status", "Units", "Price USD", "Amount USD", "Amount CAD", "Units after", "Target %", "Weight after %"];
    const body = r.lines
      .filter((l) => l.status && l.status !== "HOLD")
      .map((l) => [acc.name, l.ticker, l.status, Math.abs(l.order), l.price, Math.abs(l.amountUsd).toFixed(2), Math.abs(l.amountCad).toFixed(2), l.newQty, l.alloc.toFixed(2), l.newWeight.toFixed(2)]);
    return [head, ...body];
  };
  const exportOne = () => download(`orders-${account.name.replace(/\W+/g, "-")}.csv`, exportAccount(account));
  const exportAll = () => {
    const all = plan.accounts.map(exportAccount);
    download("orders-all-accounts.csv", [all[0][0], ...all.flatMap((rows) => rows.slice(1))]);
  };

  const fxOther = Number.isFinite(usdCad) ? (plan.fx.direction === "usd_cad" ? `1 CAD = ${(1 / usdCad).toFixed(4)} USD` : `1 USD = ${usdCad.toFixed(4)} CAD`) : "";
  const sumClass = allocSum > 100.0001 ? "error-text" : Math.abs(allocSum - 100) < 0.0001 ? "" : "muted";
  const chosen = portfolios.find((x) => x._key === plan.portfolioId);
  const ready = plan.targets.length > 0 && !res.errors.length;
  const buys = res.lines.filter((l) => l.status === "BUY");
  const sells = res.lines.filter((l) => l.status === "SELL");
  const heldRows = [...plan.targets.map((tg) => tg.ticker), ...otherHeld];

  const orderRow = (l) => (
    <tr key={l.ticker}>
      <td style={{ textAlign: "left" }}>
        <strong>{l.ticker}</strong> <span className="muted">{companies[l.ticker]?.name || ""}</span>
      </td>
      <td><strong>{units(Math.abs(l.order), fractional)}</strong></td>
      <td>{usd(l.price)}</td>
      <td className="nowrap">{plan.prices[l.ticker]?.source === "live" ? <Change pct={plan.prices[l.ticker].change_pct} /> : "–"}</td>
      <td>{usd(Math.abs(l.amountUsd))}</td>
      <td>{cad(Math.abs(l.amountCad))}</td>
      <td className="muted">{units(l.qty, fractional)} → {units(l.newQty, fractional)}</td>
    </tr>
  );
  const orderHead = (
    <thead>
      <tr>
        <th style={{ textAlign: "left" }}>Stock</th>
        <th>Units</th>
        <th>Price</th>
        <th>Change</th>
        <th>Amount (USD)</th>
        <th>Amount (CAD)</th>
        <th>Units held → after</th>
      </tr>
    </thead>
  );

  return (
    <div>
      <PageHeader
        icon={CalculatorIcon}
        color="#0ea5e9"
        title="Order Calculator"
        description="For a Canadian investor buying US stocks: choose a portfolio, enter your funds and what you hold, and get the shares to buy and sell."
        actions={<span className="muted" style={{ fontSize: "0.8rem" }}>{saveState}</span>}
      />
      {message && (
        <p className="error-text" onClick={() => setMessage(null)} style={{ cursor: "pointer" }} title="Click to dismiss">{message}</p>
      )}

      {/* ---- 1. portfolio ---- */}
      <div className="card">
        <div className="card-header" style={{ flexWrap: "wrap" }}>
          <span className="step-number">1</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0 }}>Choose a portfolio</h3>
            <p className="muted" style={{ margin: 0 }}>Its stocks and weights become the targets; live prices and the USD/CAD rate are filled in automatically.</p>
          </div>
        </div>
        <div className="order-inputs">
          <div style={{ flex: "2 1 360px" }}>
            <label>Portfolio</label>
            <select value={plan.portfolioId || ""} onChange={(e) => loadPortfolio(e.target.value)}>
              <option value="">{plan.targets.length ? "— custom targets —" : "— choose a portfolio —"}</option>
              {portfolios.map((p) => (
                <option key={p._key} value={p._key}>{p.name} ({p.holdings.length} stocks)</option>
              ))}
            </select>
            <span className="muted field-hint">
              {chosen
                ? `${chosen.holdings.length} stocks · targets add up to ${+allocSum.toFixed(2)}%`
                : plan.targets.length
                ? `${plan.targets.length} stocks typed by hand · ${+allocSum.toFixed(2)}%`
                : "Portfolios come from My Portfolios (RL or hand-built)."}
            </span>
          </div>
          <div>
            <label>Exchange rate</label>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type="number"
                min="0"
                step="0.0001"
                value={plan.fx.rate}
                onChange={(e) => update((p) => ({ fx: { ...p.fx, rate: e.target.value, source: "manual", date: null } }))}
                style={{ flex: "1 1 90px", minWidth: 80 }}
              />
              <select
                value={plan.fx.direction}
                onChange={(e) => {
                  const direction = e.target.value;
                  update((p) => ({ fx: { ...p.fx, direction, rate: Number(p.fx.rate) > 0 ? +(1 / Number(p.fx.rate)).toFixed(4) : p.fx.rate } }));
                }}
                style={{ flex: "1 1 130px", width: "auto" }}
              >
                <option value="usd_cad">CAD for 1 USD</option>
                <option value="cad_usd">USD for 1 CAD</option>
              </select>
            </div>
            <span className="muted field-hint">
              {fxOther}
              {plan.fx.source === "yahoo" && plan.fx.date ? ` · live, ${fmtTime(plan.fx.date)}` : ""}
              {plan.fx.source === "manual" && (
                <>
                  {" · typed by you · "}
                  <a onClick={() => fetchRate(false)} style={{ cursor: "pointer" }}>Use live rate</a>
                </>
              )}
            </span>
          </div>
        </div>

        <details className="order-details">
          <summary>
            Targets &amp; prices ({plan.targets.length} stocks · <span className={sumClass}>{+allocSum.toFixed(2)}%</span>)
            {pricesAt && <span className="muted"> · prices updated {fmtTime(pricesAt)}, every minute</span>}
          </summary>
          <div className="toolbar" style={{ flexWrap: "wrap", margin: "10px 0 8px" }}>
            <div style={{ flex: "1 1 320px", minWidth: 0 }}>
              <TickerPicker value={targetTickers} onChange={setTargets} showChips={false} placeholder="Add a stock — type a ticker or company name, then Enter" />
            </div>
            <button type="button" className="btn secondary" onClick={equalWeights} disabled={!plan.targets.length}>Equal weights</button>
            <button type="button" className="btn secondary" onClick={normalize} disabled={!plan.targets.length || allocSum === 0} title="Scale the targets so they add up to exactly 100%">Normalize to 100%</button>
            <button
              type="button"
              className="btn secondary"
              onClick={() => {
                refreshPrices(plan, true);
                if (plan.fx.source !== "manual") fetchRate(false);
              }}
              disabled={!plan.targets.length || refreshing}
              title="Fetch the live prices now, replacing typed ones too"
            >
              {refreshing ? "Refreshing…" : "Refresh prices"}
            </button>
          </div>
          <div className="order-toggles" style={{ flexDirection: "row", flexWrap: "wrap", gap: 18, padding: "0 0 10px" }}>
            <Toggle label="Allow selling" help="On: rebalance (sell what is above target). Off: buy only, with the funds available." checked={plan.options.allowSell} onChange={(v) => update((p) => ({ options: { ...p.options, allowSell: v } }))} />
            <Toggle label="Use as much cash as possible" help="After rounding down to whole shares, keep buying one share at a time (where it keeps the allocation closest to the targets) until no target stock fits the cash left." checked={plan.options.spendLeftover} onChange={(v) => update((p) => ({ options: { ...p.options, spendLeftover: v } }))} />
            <Toggle label="Fractional shares" help="Quantities with up to 4 decimals, for brokers that allow fractional shares." checked={plan.options.fractional} onChange={(v) => update((p) => ({ options: { ...p.options, fractional: v } }))} />
          </div>
          {plan.targets.length > 0 && (
            <table className="order-table">
              <thead>
                <tr>
                  <th style={{ textAlign: "left" }}>Ticker</th>
                  <th style={{ textAlign: "left" }}>Company</th>
                  <th>Price (USD)</th>
                  <th>Change</th>
                  <th>Price (CAD)</th>
                  <th>Target %</th>
                  <th aria-label="Remove" />
                </tr>
              </thead>
              <tbody>
                {plan.targets.map((tg) => {
                  const pr = plan.prices[tg.ticker];
                  return (
                    <tr key={tg.ticker}>
                      <td style={{ textAlign: "left" }}>
                        <a href={`https://finance.yahoo.com/quote/${tg.ticker}`} target="_blank" rel="noreferrer" title="Open on Yahoo Finance"><strong>{tg.ticker}</strong></a>
                      </td>
                      <td style={{ textAlign: "left" }} className="muted">{companies[tg.ticker]?.name || "—"}</td>
                      <td>
                        <input type="number" min="0" step="0.01" value={pr?.price ?? ""} placeholder="price" onChange={(e) => setPrice(tg.ticker, e.target.value)} className="num-input" />
                      </td>
                      <td className="nowrap">
                        {pr?.source === "manual" ? (
                          <span className="muted">typed · <a onClick={() => backToLive(tg.ticker)} style={{ cursor: "pointer" }}>use live</a></span>
                        ) : pr?.source === "live" ? (
                          <Change pct={pr.change_pct} />
                        ) : pr?.source === "stored" ? (
                          <span className="muted">close {fmtDay(pr.date)}</span>
                        ) : (
                          <span className="error-text">type a price</span>
                        )}
                      </td>
                      <td>{Number(pr?.price) > 0 && Number.isFinite(usdCad) ? cad(Number(pr.price) * usdCad) : "–"}</td>
                      <td>
                        <input type="number" min="0" max="100" step="0.01" value={tg.alloc} placeholder="0" onChange={(e) => setAlloc(tg.ticker, e.target.value)} className="num-input" />
                      </td>
                      <td>
                        <button type="button" className="icon-btn" onClick={() => setTargets(targetTickers.filter((x) => x !== tg.ticker))} title={`Remove ${tg.ticker}`} aria-label={`Remove ${tg.ticker}`}>
                          <CloseIcon width={14} height={14} />
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={5} style={{ textAlign: "right" }}><strong>Total</strong></td>
                  <td className={sumClass}>
                    <strong>{+allocSum.toFixed(2)}%</strong>
                    {allocSum < 99.9999 && <span className="muted"> · {+(100 - allocSum).toFixed(2)}% stays in cash</span>}
                  </td>
                  <td />
                </tr>
              </tfoot>
            </table>
          )}
        </details>
      </div>

      {/* ---- 2. funds + holdings ---- */}
      <div className="card">
        <div className="card-header" style={{ flexWrap: "wrap" }}>
          <span className="step-number">2</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0 }}>Your funds and what you hold</h3>
            <p className="muted" style={{ margin: 0 }}>Per account (e.g. RRSP, LIRA, TFSA): the funds available in CAD and the units you already own.</p>
          </div>
        </div>

        <div className="account-tabs" role="tablist">
          {plan.accounts.map((a) => (
            <div key={a.id} className={`account-tab${a.id === account.id ? " active" : ""}`}>
              <button type="button" role="tab" aria-selected={a.id === account.id} onClick={() => update(() => ({ activeAccount: a.id }))}>
                {a.name || "Unnamed"}
              </button>
              {plan.accounts.length > 1 && (
                <button type="button" className="tab-close" onClick={() => removeAccount(a.id)} title={`Remove ${a.name}`} aria-label={`Remove ${a.name}`}>×</button>
              )}
            </div>
          ))}
          <button type="button" className="account-tab add" onClick={addAccount} title="Add an account"><PlusIcon width={13} height={13} /> Account</button>
        </div>

        <div className="statement-bar">
          <label className={`btn secondary${reading ? " disabled" : ""}`} title="A screenshot of this account's positions (symbol, quantity, market value…): fills the units you hold and the funds">
            <input type="file" accept="image/*" hidden disabled={reading} onChange={(e) => { readStatement(e.target.files?.[0]); e.target.value = ""; }} />
            {reading ? <SpinnerIcon width={14} height={14} className="spin" /> : <ImageIcon width={14} height={14} />}
            {reading ? " Reading…" : " Read from a screenshot"}
          </label>
          <span className="muted" style={{ fontSize: "0.8rem" }}>
            {statementNote || "Fill this account's units and funds from a screenshot of its positions, then see what to sell and buy in step 3."}
          </span>
        </div>

        <div className="order-inputs" style={{ marginTop: 12 }}>
          <div>
            <label>Account name</label>
            <input value={account.name} onChange={(e) => setAccount({ name: e.target.value })} placeholder="e.g. RRSP" />
          </div>
          <div>
            <label>Available funds (CAD)</label>
            <input type="number" min="0" step="0.01" value={account.cash} onChange={(e) => setAccount({ cash: e.target.value })} placeholder="0" autoFocus={!!plan.targets.length} />
            <span className="muted field-hint">Cash to invest, besides the stocks you hold (their value is added).</span>
          </div>
          <div style={{ flex: "2 1 320px" }}>
            <label>Other stocks you hold</label>
            <TickerPicker
              value={otherHeld}
              onChange={(list) => {
                const holdings = { ...account.holdings };
                for (const tk of otherHeld) if (!list.includes(tk)) delete holdings[tk];
                for (const tk of list) if (!(tk in holdings)) holdings[tk] = "";
                setAccount({ holdings });
                ensurePrices(list);
              }}
              blocked={targetTickers}
              blockedReason="is in the portfolio — enter its units below"
              variant="excluded"
              placeholder="Not in the portfolio? Add them here — they will be sold"
            />
          </div>
        </div>

        {heldRows.length > 0 && (
          <table className="order-table" style={{ marginTop: 10 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Stock</th>
                <th>Price</th>
                <th>Change</th>
                <th>Units you hold</th>
                <th>Value (CAD)</th>
              </tr>
            </thead>
            <tbody>
              {heldRows.map((tk) => {
                const pr = plan.prices[tk];
                const line = res.lines.find((l) => l.ticker === tk);
                return (
                  <tr key={tk}>
                    <td style={{ textAlign: "left" }}>
                      <strong>{tk}</strong> <span className="muted">{companies[tk]?.name || ""}</span>
                      {otherHeld.includes(tk) && <span className="muted"> · not in the portfolio</span>}
                    </td>
                    <td>{Number(pr?.price) > 0 ? usd(Number(pr.price)) : "–"}</td>
                    <td className="nowrap">{pr?.source === "live" ? <Change pct={pr.change_pct} /> : "–"}</td>
                    <td>
                      <input type="number" min="0" step={fractional ? "0.0001" : "1"} value={account.holdings[tk] ?? ""} placeholder="0" onChange={(e) => setUnits(tk, e.target.value)} className="num-input" />
                    </td>
                    <td>{line ? cad(line.valueCad) : "–"}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* ---- 3. orders ---- */}
      <div className="card">
        <div className="card-header" style={{ flexWrap: "wrap" }}>
          <span className="step-number">3</span>
          <div style={{ minWidth: 0, flex: 1 }}>
            <h3 style={{ margin: 0 }}>Orders for {account.name || "this account"}</h3>
            <p className="muted" style={{ margin: 0 }}>What to buy and what to sell, in whole shares{plan.options.fractional ? " (fractions allowed)" : ""}, at the current prices.</p>
          </div>
          <div className="toolbar">
            <button type="button" className="btn secondary" onClick={exportOne} disabled={!ready}><DownloadIcon /> Export orders</button>
            {plan.accounts.length > 1 && <button type="button" className="btn secondary" onClick={exportAll}><DownloadIcon /> Export all accounts</button>}
          </div>
        </div>

        {!plan.targets.length ? (
          <p className="muted">Choose a portfolio in step 1.</p>
        ) : (
          <>
            <StatTiles tiles={tiles} />
            {res.errors.map((e) => <p key={e} className="error-text" style={{ margin: "4px 0" }}>{e}</p>)}
            {res.notes?.map((n) => <p key={n} className="muted" style={{ margin: "4px 0" }}>{n}</p>)}
            {ready && (
              <div className="orders-grid">
                <div className="orders-box buy">
                  <h4>Buy ({buys.length})</h4>
                  {buys.length ? <table className="order-table">{orderHead}<tbody>{buys.map(orderRow)}</tbody></table> : <p className="muted">Nothing to buy.</p>}
                </div>
                <div className="orders-box sell">
                  <h4>Sell ({sells.length})</h4>
                  {sells.length ? (
                    <table className="order-table">{orderHead}<tbody>{sells.map(orderRow)}</tbody></table>
                  ) : (
                    <p className="muted">{plan.options.allowSell ? "Nothing to sell." : "Selling is off (buy only)."}</p>
                  )}
                </div>
              </div>
            )}
            {ready && (
              <details className="order-details">
                <summary>Full breakdown (target units and values, weight after the orders)</summary>
                <table className="order-table">
                  <thead>
                    <tr>
                      <th style={{ textAlign: "left" }}>Ticker</th>
                      <th>Target %</th>
                      <th>Price (CAD)</th>
                      <th>Units held</th>
                      <th>Value now (CAD)</th>
                      <th>Target units</th>
                      <th>Target value (CAD)</th>
                      <th>Order</th>
                      <th>Weight after</th>
                    </tr>
                  </thead>
                  <tbody>
                    {res.lines.map((l) => (
                      <tr key={l.ticker}>
                        <td style={{ textAlign: "left" }}><strong>{l.ticker}</strong></td>
                        <td>{`${+l.alloc.toFixed(2)}%`}</td>
                        <td>{cad(l.priceCad)}</td>
                        <td>{units(l.qty, fractional)}</td>
                        <td>{cad(l.valueCad)}</td>
                        <td>{units(l.newQty, fractional)}</td>
                        <td>{cad(l.targetCad)}</td>
                        <td>
                          <span className={`count-badge ${STATUS_CLASS[l.status]}`}>
                            {l.status}{l.status !== "HOLD" && ` ${units(Math.abs(l.order), fractional)}`}
                          </span>
                        </td>
                        <td>{l.newWeight.toFixed(2)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            )}
          </>
        )}
      </div>

      {/* ---- all accounts ---- */}
      {plan.accounts.length > 1 && (
        <div className="card">
          <h3 style={{ marginTop: 0 }}>All accounts</h3>
          <table className="order-table">
            <thead>
              <tr>
                <th style={{ textAlign: "left" }}>Account</th>
                <th>Value (CAD)</th>
                <th>Buy (CAD)</th>
                <th>Sell (CAD)</th>
                <th>Cash after (CAD)</th>
                <th>Orders</th>
              </tr>
            </thead>
            <tbody>
              {plan.accounts.map((a) => {
                const r = results[a.id];
                return (
                  <tr key={a.id}>
                    <td style={{ textAlign: "left" }}><a onClick={() => update(() => ({ activeAccount: a.id }))} style={{ cursor: "pointer" }}>{a.name}</a></td>
                    <td>{cad(r.totals.totalCad)}</td>
                    <td>{r.errors.length ? "–" : cad(r.totals.buysCad)}</td>
                    <td>{r.errors.length ? "–" : cad(r.totals.sellsCad)}</td>
                    <td>{r.errors.length ? "–" : cad(r.totals.cashAfterCad)}</td>
                    <td>{r.errors.length ? <span className="error-text">check inputs</span> : r.lines.filter((l) => l.status !== "HOLD").length}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <InfoPanels
        about={{
          icon: CalculatorIcon,
          color: "#0ea5e9",
          title: "About the Order Calculator",
          text: "Turns a portfolio into orders. Each account's value is its funds plus its stocks at the live prices; each stock's target value is that value × its weight, and its target units are what that buys.",
          features: [
            { icon: WorkflowIcon, color: "#0ea5e9", title: "From a portfolio", text: "Pick a saved portfolio: its stocks and weights become the targets." },
            { icon: LayersIcon, color: "#16a34a", title: "Several accounts", text: "RRSP, LIRA, TFSA… each with its own funds and units held." },
            { icon: PieChartIcon, color: "#f59e0b", title: "Most of the funds invested", text: "After rounding down, extra shares go where they keep the allocation closest to the targets." },
            { icon: TrendChartIcon, color: "#8b5cf6", title: "Live prices", text: "Prices (green up, red down since the previous close) and the USD/CAD rate from Yahoo Finance, refreshed every minute; both can be typed over." },
          ],
        }}
        tips={[
          { title: "Prices move", text: "Live prices and the rate refresh every minute; check them just before placing the orders." },
          { title: "Selling is optional", text: "Turn off Allow selling (step 1, Targets & prices) to only invest new funds." },
          { title: "Stocks you no longer want", text: "Add them under Other stocks you hold: they are not in the portfolio, so they are sold." },
        ]}
      />
    </div>
  );
}
