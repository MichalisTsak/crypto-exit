import { useState, useEffect, useCallback } from "react";

// ————————————————————————————————————————————————————————
// EXIT MONITOR v2 — regime engine + risk rails + AI sitrep
// Philosophy: the read is an opinion, the rails are law.
// ————————————————————————————————————————————————————————
const C = {
  chassis: "#0F1317",
  panel: "#181E24",
  panelUp: "#1F2730",
  etch: "#2B343D",
  text: "#E9EEF3",
  dim: "#8C99A6",
  faint: "#5C6873",
  amber: "#FFC24B",
  green: "#3ECF8E",
  teal: "#4FD1C5",
  warn: "#F5A742",
  orange: "#F58742",
  red: "#F16D6D",
  redDeep: "#C0392B",
};
const MONO = "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace";

const DEFAULT_TH = { caution: 52000, structural: 48000, capitulation: 42000, velocity: -12 };

const COINS = [
  { id: "bitcoin", sym: "BTC", name: "Bitcoin", core: true },
  { id: "ethereum", sym: "ETH", name: "Ethereum", core: true },
  { id: "solana", sym: "SOL", name: "Solana", floorKey: "sol" },
  { id: "near", sym: "NEAR", name: "NEAR Protocol", floorKey: "near" },
  { id: "bittensor", sym: "TAO", name: "Bittensor", floorKey: "tao" },
  { id: "sui", sym: "SUI", name: "Sui", floorKey: "sui" },
  { id: "render-token", sym: "RENDER", name: "Render", floorKey: "render" },
];

const fmtPrice = (n) => {
  if (n == null || isNaN(n)) return "—";
  if (n >= 1000) return n.toLocaleString("en-US", { maximumFractionDigits: 0 });
  if (n >= 1) return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return n.toLocaleString("en-US", { minimumFractionDigits: 3, maximumFractionDigits: 4 });
};
const fmtPct = (n) => (n == null || isNaN(n) ? "—" : `${n > 0 ? "+" : ""}${n.toFixed(1)}%`);
const fmt1 = (n) => (n == null || isNaN(n) ? "—" : n.toFixed(1));

// Wilder RSI
function rsi(closes, period = 14) {
  if (!closes || closes.length < period + 1) return null;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d > 0) g += d; else l -= d;
  }
  let ag = g / period, al = l / period;
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    ag = (ag * (period - 1) + Math.max(d, 0)) / period;
    al = (al * (period - 1) + Math.max(-d, 0)) / period;
  }
  if (al === 0) return 100;
  return 100 - 100 / (1 + ag / al);
}
const sma = (arr, n) => (arr && arr.length >= n ? arr.slice(-n).reduce((a, b) => a + b, 0) / n : null);
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ————————————————————————————————————————————————————————
export default function ExitMonitorV2() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [source, setSource] = useState(null);
  const [updated, setUpdated] = useState(null);

  const [coins, setCoins] = useState({});
  const [ind, setInd] = useState({}); // computed indicators
  const [globalM, setGlobalM] = useState({}); // dominance etc.
  const [fng, setFng] = useState(null);
  const [fngTrend, setFngTrend] = useState(null);
  const [srcStatus, setSrcStatus] = useState({});
  const [ccy, setCcy] = useState("EUR"); // display currency
  const [fx, setFx] = useState(null); // EUR per 1 USD

  const [th, setTh] = useState(DEFAULT_TH);
  const [floors, setFloors] = useState(null);
  const [metrics, setMetrics] = useState({ mvrvZ: null, ma200w: null, ts: null }); // manual / sitrep-filled

  const [sitrep, setSitrep] = useState(null);
  const [sitrepLoading, setSitrepLoading] = useState(false);
  const [sitrepErr, setSitrepErr] = useState(null);

  const [showRails, setShowRails] = useState(false);
  const [showExit, setShowExit] = useState(false);
  const [showProfit, setShowProfit] = useState(false);
  const [showConfig, setShowConfig] = useState(false);
  const [saveMsg, setSaveMsg] = useState("");

  // ——— storage ———
  const persist = useCallback(async (nextTh, nextFloors, nextMetrics) => {
    try {
      await window.storage.set(
        "exitmon2:cfg",
        JSON.stringify({ th: nextTh, floors: nextFloors, metrics: nextMetrics })
      );
      return true;
    } catch (e) { return false; }
  }, []);

  const loadCfg = useCallback(async () => {
    try {
      const r = await window.storage.get("exitmon2:cfg");
      if (r && r.value) {
        const cfg = JSON.parse(r.value);
        if (cfg.th) setTh({ ...DEFAULT_TH, ...cfg.th });
        if (cfg.floors) setFloors(cfg.floors);
        if (cfg.metrics) setMetrics(cfg.metrics);
        return cfg;
      }
    } catch (e) { /* none yet */ }
    // migrate v1 config if present
    try {
      const old = await window.storage.get("exitmon:cfg");
      if (old && old.value) {
        const cfg = JSON.parse(old.value);
        if (cfg.th) setTh({ ...DEFAULT_TH, ...cfg.th });
        if (cfg.floors) setFloors(cfg.floors);
        return cfg;
      }
    } catch (e) { /* none */ }
    return null;
  }, []);

  useEffect(() => {
    try {
      window.storage.get("exitmon2:sitrep").then((r) => {
        if (r && r.value) setSitrep(JSON.parse(r.value));
      }).catch(() => {});
      window.storage.get("exitmon2:ccy").then((r) => {
        if (r && r.value) setCcy(JSON.parse(r.value));
      }).catch(() => {});
      window.storage.get("exitmon2:fx").then((r) => {
        if (r && r.value) {
          const o = JSON.parse(r.value);
          if (o && o.rate) setFx(o.rate);
        }
      }).catch(() => {});
    } catch (e) { /* ignore */ }
  }, []);

  // ——— data ———
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  const getJson = async (url, tries = 2) => {
    let lastErr;
    for (let i = 0; i < tries; i++) {
      try {
        const res = await fetch(url);
        if (res.ok) return await res.json();
        lastErr = new Error(`HTTP ${res.status}`);
        if (i < tries - 1) await sleep(res.status === 429 ? 2500 : 1200);
      } catch (e) {
        lastErr = e;
        if (i < tries - 1) await sleep(1200);
      }
    }
    throw lastErr;
  };

  const computeInd = (closes) => {
    if (!closes || closes.length < 210) return {};
    const weekly = [];
    for (let i = closes.length - 1; i >= 0; i -= 7) weekly.unshift(closes[i]);
    const ma50 = sma(closes, 50);
    const ma200 = sma(closes, 200);
    const ma200prev = sma(closes.slice(0, -10), 200); // MA200 ~10d ago, for slope
    const price = closes[closes.length - 1];
    const last90 = closes.slice(-90);
    const prev90 = closes.slice(-180, -90);
    const minL = Math.min(...last90);
    const minP = Math.min(...prev90);
    let structure = 0;
    if (minL > minP * 1.02) structure = 2;
    else if (minL < minP * 0.98) structure = -2;
    const distMA = ma200 != null && price != null ? (price - ma200) / ma200 : null; // fractional
    const maSlope = ma200 != null && ma200prev != null ? (ma200 - ma200prev) / ma200prev : null;
    return {
      ma50, ma200, distMA, maSlope,
      cross: ma50 != null && ma200 != null ? (ma50 >= ma200 ? "golden" : "death") : null,
      rsiD: rsi(closes.slice(-120), 14),
      rsiW: rsi(weekly, 14),
      structure, minL, minP,
    };
  };

  // Binance USDT symbols for the watchlist
  const BINANCE = { BTC: "BTCUSDT", ETH: "ETHUSDT", SOL: "SOLUSDT", NEAR: "NEARUSDT", TAO: "TAOUSDT", SUI: "SUIUSDT", RENDER: "RENDERUSDT" };

  const fetchAll = async () => {
    const ids = COINS.map((c) => c.id).join(",");
    const status = {};
    const out = { coins: {}, ind: {}, global: {}, fng: null, fngTrend: null, source: "coingecko" };

    // Fear & Greed first — separate API, no shared rate limit with CoinGecko
    try {
      const j = await getJson("https://api.alternative.me/fng/?limit=30");
      const arr = (j?.data || []).map((d) => parseInt(d.value, 10)).filter((n) => !isNaN(n));
      if (arr.length) {
        out.fng = arr[0];
        if (arr.length >= 14) {
          const recent = arr.slice(0, 7).reduce((a, b) => a + b, 0) / 7;
          const prior = arr.slice(7, 14).reduce((a, b) => a + b, 0) / 7;
          out.fngTrend = recent - prior;
        }
      }
      status.fng = "ok";
    } catch (e) { status.fng = "fail"; }

    // FX rate (EUR per USD) — ECB via frankfurter, cached 24h
    try {
      let rate = null;
      try {
        const fr = await window.storage.get("exitmon2:fx");
        if (fr && fr.value) {
          const o = JSON.parse(fr.value);
          if (o && o.rate && Date.now() - o.ts < 24 * 3600 * 1000) rate = o.rate;
        }
      } catch (e) { /* no cache */ }
      if (rate == null) {
        const j = await getJson("https://api.frankfurter.app/latest?from=USD&to=EUR");
        rate = j?.rates?.EUR ?? null;
        if (rate) { try { await window.storage.set("exitmon2:fx", JSON.stringify({ ts: Date.now(), rate })); } catch (e) {} }
      }
      out.fx = rate;
    } catch (e) { out.fx = null; }

    // ——— PRICES: Binance ticker first (permissive CORS, no key), CoinGecko as enrichment ———
    let gotPrices = false;
    try {
      const syms = Object.values(BINANCE);
      const q = encodeURIComponent(JSON.stringify(syms));
      const rows = await getJson(`https://api.binance.com/api/v3/ticker/24hr?symbols=${q}`, 2);
      const bySym = {};
      for (const r of rows || []) bySym[r.symbol] = r;
      for (const c of COINS) {
        const r = bySym[BINANCE[c.sym]];
        if (!r) continue;
        out.coins[c.sym] = {
          price: parseFloat(r.lastPrice),
          ch24: parseFloat(r.priceChangePercent),
          ch7: null, ch30: null, ath: null, athPct: null,
        };
      }
      if (out.coins.BTC?.price) { gotPrices = true; status.mkt = "binance"; out.source = "live"; }
    } catch (e) { /* try CoinGecko next */ }

    // Fallback prices via CoinGecko (also enriches with 7d/30d/ATH when it works)
    try {
      const rows = await getJson(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${ids}&price_change_percentage=24h,7d,30d`, gotPrices ? 1 : 3);
      for (const r of rows) {
        const meta = COINS.find((cc) => cc.id === r.id);
        if (!meta) continue;
        const ex = out.coins[meta.sym] || {};
        out.coins[meta.sym] = {
          price: ex.price ?? r.current_price,
          ch24: ex.ch24 ?? (r.price_change_percentage_24h_in_currency ?? r.price_change_percentage_24h),
          ch7: r.price_change_percentage_7d_in_currency ?? ex.ch7 ?? null,
          ch30: r.price_change_percentage_30d_in_currency ?? ex.ch30 ?? null,
          ath: r.ath ?? ex.ath ?? null,
          athPct: r.ath_change_percentage ?? ex.athPct ?? null,
        };
      }
      if (!gotPrices && out.coins.BTC?.price) { gotPrices = true; out.source = "coingecko"; }
      status.cg = "ok";
    } catch (e) { status.cg = gotPrices ? "skip" : "fail"; }

    if (!gotPrices) { setSrcStatus(status); throw new Error("all price sources failed"); }

    // ——— HISTORY: Binance klines (reliable), CoinGecko chart fallback, 12h cache ———
    let closes = null, cached = null;
    try {
      const cr = await window.storage.get("exitmon2:closes");
      if (cr && cr.value) cached = JSON.parse(cr.value);
    } catch (e) { /* none */ }
    const cacheGood = cached && Array.isArray(cached.closes) && cached.closes.length >= 210;
    if (cacheGood && Date.now() - cached.ts < 12 * 3600 * 1000) {
      closes = cached.closes.slice(); status.chart = "cached";
    } else {
      try {
        const kl = await getJson("https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=1d&limit=365", 2);
        const c = (kl || []).map((row) => parseFloat(row[4])).filter((x) => !isNaN(x));
        if (c.length >= 210) {
          closes = c; status.chart = "binance";
          try { await window.storage.set("exitmon2:closes", JSON.stringify({ ts: Date.now(), closes: c })); } catch (e) {}
        } else throw new Error("short klines");
      } catch (e1) {
        try {
          const j = await getJson("https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=365", 2);
          const c = (j.prices || []).map((x) => x[1]);
          if (c.length >= 210) {
            closes = c; status.chart = "coingecko";
            try { await window.storage.set("exitmon2:closes", JSON.stringify({ ts: Date.now(), closes: c })); } catch (e) {}
          } else if (cacheGood) { closes = cached.closes.slice(); status.chart = "stale-cache"; }
          else status.chart = "fail";
        } catch (e2) {
          if (cacheGood) { closes = cached.closes.slice(); status.chart = "stale-cache"; }
          else status.chart = "fail";
        }
      }
    }
    if (closes) {
      const bp = out.coins.BTC?.price;
      if (bp) closes[closes.length - 1] = bp; // pin last close to live price
      out.ind = computeInd(closes);
      // derive BTC 7d/30d from history if CoinGecko didn't supply them
      if (out.coins.BTC) {
        const n = closes.length;
        if (out.coins.BTC.ch7 == null && n > 7) out.coins.BTC.ch7 = ((closes[n - 1] - closes[n - 8]) / closes[n - 8]) * 100;
        if (out.coins.BTC.ch30 == null && n > 30) out.coins.BTC.ch30 = ((closes[n - 1] - closes[n - 31]) / closes[n - 31]) * 100;
      }
      // drawdown proxy from 1y high when ATH unavailable
      if (out.coins.BTC && out.coins.BTC.athPct == null) {
        const hi = Math.max(...closes);
        if (hi > 0) out.coins.BTC.athPct = ((out.coins.BTC.price - hi) / hi) * 100; // negative
        out.ind.ddProxy = "1y";
      }
    }

    // ——— Global (dominance) — best effort ———
    try {
      const j = await getJson("https://api.coingecko.com/api/v3/global", 1);
      out.global = { btcDom: j?.data?.market_cap_percentage?.btc ?? null, mcap24: j?.data?.market_cap_change_percentage_24h_usd ?? null };
      status.global = "ok";
    } catch (e) { status.global = "fail"; }

    setSrcStatus(status);
    return out;
  };

  const fetchViaClaude = async () => {
    const prompt =
      'Search the web for CURRENT crypto data. Respond ONLY with minified JSON, no markdown: {"btc":N,"eth":N,"sol":N,"near":N,"tao":N,"sui":N,"render":N,"fng":N,"btc7d":N,"ma200":"above" or "below","eurusd":N}. USD numbers. tao=Bittensor, render=Render token. fng=Crypto Fear & Greed Index. btc7d=Bitcoin 7-day % change. ma200=BTC above/below its 200-day moving average. eurusd=how many EUR one USD buys (e.g. 0.92).';
    const res = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-sonnet-4-6",
        max_tokens: 1000,
        messages: [{ role: "user", content: prompt }],
        tools: [{ type: "web_search_20250305", name: "web_search" }],
      }),
    });
    if (!res.ok) throw new Error(`claude ${res.status}`);
    const data = await res.json();
    const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
    const m = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
    if (!m) throw new Error("no JSON");
    const j = JSON.parse(m[0]);
    const mk = (p, c7) => ({ price: p, ch24: null, ch7: c7 ?? null, ch30: null, ath: null, athPct: null });
    return {
      coins: { BTC: mk(j.btc, j.btc7d), ETH: mk(j.eth), SOL: mk(j.sol), NEAR: mk(j.near), TAO: mk(j.tao), SUI: mk(j.sui), RENDER: mk(j.render) },
      ind: { maRelOverride: j.ma200 === "above" || j.ma200 === "below" ? j.ma200 : null },
      global: {},
      fng: typeof j.fng === "number" ? j.fng : parseInt(j.fng, 10) || null,
      fngTrend: null,
      fx: typeof j.eurusd === "number" ? j.eurusd : null,
      source: "claude",
    };
  };

  const refresh = useCallback(async (savedFloors) => {
    setLoading(true);
    setError(null);
    let r = null;
    try { r = await fetchAll(); }
    catch (e1) {
      try {
        r = await fetchViaClaude();
        setSrcStatus({ mkt: "claude", chart: "fail", fng: r?.fng != null ? "ok" : "fail" });
      }
      catch (e2) { setError("Both data sources failed. Check connection and retry."); setLoading(false); return; }
    }
    setCoins(r.coins); setInd(r.ind); setGlobalM(r.global);
    setFng(r.fng); setFngTrend(r.fngTrend);
    if (r.fx != null) setFx(r.fx);
    setSource(r.source); setUpdated(new Date());

    const cf = savedFloors ?? floors;
    if (!cf) {
      const nf = {};
      for (const c of COINS) {
        if (!c.floorKey) continue;
        const p = r.coins?.[c.sym]?.price;
        nf[c.floorKey] = p ? +(p * 0.72).toPrecision(3) : 0;
      }
      setFloors(nf);
      persist(th, nf, metrics);
    }
    setLoading(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [floors, th, metrics]);

  useEffect(() => {
    (async () => {
      const cfg = await loadCfg();
      await refresh(cfg?.floors ?? null);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ————————————————————————————————————————————————
  // ENGINE — pillars, regime, rails
  // ————————————————————————————————————————————————
  const btc = coins.BTC || {};
  const p = btc.price;
  const sym = ccy === "EUR" && fx != null ? "€" : "$";
  const disp = (usd) => (usd == null ? null : ccy === "EUR" && fx != null ? usd * fx : usd);
  const maRel = ind.ma200 != null && p != null ? (p >= ind.ma200 ? "above" : "below") : ind.maRelOverride ?? null;
  const dd = btc.athPct != null ? -btc.athPct : null; // drawdown % positive

  // Pillars, each in [-2, +2]
  let T = null, M = null, V = null, S = null, St = null;
  let trendNote = null;
  if (ind.distMA != null) {
    // Nuanced trend: distance from 200D MA + MA50/MA200 cross + slope
    const d = ind.distMA; // fractional distance from MA200
    const golden = ind.cross === "golden";
    if (Math.abs(d) < 0.02) T = 0; // sitting on the line = chop, not a signal
    else if (d >= 0.02 && d < 0.08) T = golden ? 2 : 1;
    else if (d >= 0.08) T = 2;
    else if (d <= -0.02 && d > -0.08) T = golden ? -1 : -2;
    else T = -2;
    const slopeTxt = ind.maSlope == null ? "" : ind.maSlope > 0.005 ? ", rising" : ind.maSlope < -0.005 ? ", falling" : ", flat";
    trendNote = `${(d * 100).toFixed(1)}% ${d >= 0 ? "above" : "below"} 200D MA${slopeTxt}${ind.cross ? ` · ${ind.cross}` : ""}`;
  } else if (maRel != null) {
    // Binary fallback (Claude path, no numeric MA)
    if (maRel === "above") T = ind.cross === "golden" ? 2 : 1;
    else T = ind.cross === "death" ? -2 : -1;
    trendNote = `${maRel} 200D MA${ind.cross ? ` · ${ind.cross} cross` : ""} (approx)`;
  }
  if (ind.rsiW != null) {
    const w = ind.rsiW;
    M = w < 30 ? -2 : w < 45 ? -1 : w <= 55 ? 0 : w <= 70 ? 1 : 2;
  }
  const mvrvAgeDays = metrics.ts ? (Date.now() - metrics.ts) / 86400000 : null;
  const mvrvStale = metrics.mvrvZ != null && metrics.mvrvZ !== "" && (mvrvAgeDays == null || mvrvAgeDays > 7);
  const mvrvFresh = metrics.mvrvZ != null && metrics.mvrvZ !== "" && !mvrvStale;
  {
    const z = metrics.mvrvZ;
    if (mvrvFresh) {
      V = z < 0 ? 2 : z < 1 ? 1 : z <= 3 ? 0 : z <= 5 ? -1 : -2;
    } else if (dd != null) {
      V = dd > 65 ? 2 : dd > 45 ? 1 : dd > 20 ? 0 : -1;
    }
    if (V != null && metrics.ma200w && p != null && p < metrics.ma200w) V = clamp(V + 1, -2, 2);
  }
  if (fng != null) S = fng < 20 ? 2 : fng < 35 ? 1 : fng <= 60 ? 0 : fng <= 75 ? -1 : -2; // contrarian
  if (ind.structure != null) St = ind.structure;

  const ddLabel = dd != null ? `−${dd.toFixed(0)}% from ${ind.ddProxy === "1y" ? "1y high" : "ATH"}` : null;
  const pillars = [
    { key: "T", label: "Trend", w: 30, v: T, note: trendNote || (srcStatus.chart === "fail" ? "history fetch throttled — tap Refresh in ~1 min" : "no data") },
    { key: "M", label: "Momentum", w: 20, v: M, note: ind.rsiW != null ? `weekly RSI ${fmt1(ind.rsiW)} · daily ${fmt1(ind.rsiD)}` : srcStatus.chart === "fail" ? "history fetch throttled — tap Refresh in ~1 min" : "no data" },
    { key: "V", label: "Valuation", w: 25, v: V, note: mvrvFresh ? `MVRV Z ${metrics.mvrvZ}${mvrvAgeDays != null ? ` (${mvrvAgeDays < 1 ? "today" : `${Math.floor(mvrvAgeDays)}d old`})` : ""}${ddLabel ? ` · ${ddLabel}` : ""}` : mvrvStale ? `MVRV ${metrics.mvrvZ} stale — using ${ddLabel || "proxy"}. Run Sitrep` : ddLabel ? `${ddLabel} (proxy — run Sitrep for MVRV)` : "no data" },
    { key: "S", label: "Sentiment", w: 15, v: S, note: fng != null ? `F&G ${fng}${fngTrend != null ? ` (${fngTrend > 1 ? "improving" : fngTrend < -1 ? "worsening" : "flat"})` : ""} · contrarian` : srcStatus.fng === "fail" ? "F&G source unreachable — retry" : "no data" },
    { key: "St", label: "Structure", w: 10, v: St, note: St === 2 ? "higher low (90d)" : St === -2 ? "lower low (90d)" : St === 0 ? "flat base" : srcStatus.chart === "fail" ? "history fetch throttled — tap Refresh in ~1 min" : "no data" },
  ];
  const avail = pillars.filter((x) => x.v != null);
  const composite = avail.length ? avail.reduce((a, x) => a + x.w * x.v, 0) / avail.reduce((a, x) => a + x.w, 0) : null;
  const totalW = pillars.reduce((a, x) => a + x.w, 0);
  const activeW = avail.reduce((a, x) => a + x.w, 0);
  const coverage = totalW ? activeW / totalW : 0;
  const degraded = source === "claude" || coverage < 0.6 || composite == null;

  // Regime
  let regime = { key: "NEUTRAL", name: "Neutral / Chop", color: C.dim, order: "No edge either way. Standard weekly buys — nothing clever." };
  if (composite != null) {
    const euphoric = (V != null && V <= -1.5) || (fng != null && fng > 75 && ind.rsiW != null && ind.rsiW > 70);
    const deepValue = V != null && V >= 1.5 && M != null && M <= -1 && S != null && S >= 1;
    if (euphoric) regime = { key: "EUPHORIA", name: "Euphoria / Top zone", color: C.warn, order: "Top-zone markers flashing. Open the take-profit ladder — this is where the plan sells, not buys." };
    else if (deepValue) regime = { key: "DEEPVALUE", name: "Capitulation / Deep value", color: C.green, order: "Cycle-bottom conditions. Keep the weekly buys; consider the dip tranche. Rails below are your invalidation." };
    else if (T != null && T >= 1 && composite >= 0.5) regime = { key: "BULL", name: "Bull trend", color: C.green, order: "Uptrend intact. Keep the DCA, stop adding to laggards, let winners run." };
    else if ((T == null || T < 1) && composite > -0.3 && (St > 0 || (ind.ma50 && p != null && p > ind.ma50))) regime = { key: "RECOVERY", name: "Early recovery", color: C.teal, order: "Bottom pattern forming. Full-size buys; a 200D MA reclaim confirms it." };
    else if (composite <= -0.6) regime = { key: "BEAR", name: "Bear trend", color: C.orange, order: "Downtrend, not yet deep value. Half-size buys; let the rails guard the floor." };
  }

  // Rails (v1 logic — the law)
  const altBreaches = COINS.filter((c) => c.floorKey && floors && coins[c.sym]?.price != null)
    .filter((c) => coins[c.sym].price < (floors[c.floorKey] || 0));
  const lamps = [];
  const lamp = (id, label, tripped, pts, detail, severity) => lamps.push({ id, label, tripped, pts: tripped ? pts : 0, detail, severity });
  lamp("trend", "BTC below 200-day MA", maRel === "below", 15, maRel == null ? "No trend data" : maRel === "below" ? `Bear trend${ind.ma200 ? ` (MA ≈ $${fmtPrice(ind.ma200)})` : ""}` : "Above — recovery signal", "warn");
  lamp("caution", `BTC below $${fmtPrice(th.caution)}`, p != null && p < th.caution, 20, "Caution zone", "warn");
  lamp("structural", `BTC below $${fmtPrice(th.structural)}`, p != null && p < th.structural, 30, "Structural break — 3 daily closes = staged exit", "danger");
  lamp("capitulation", `BTC below $${fmtPrice(th.capitulation)}`, p != null && p < th.capitulation, 25, "Beyond historical −65% analog", "danger");
  lamp("velocity", `7-day drop > ${Math.abs(th.velocity)}%`, btc.ch7 != null && btc.ch7 <= th.velocity, 10, btc.ch7 != null ? `7d: ${fmtPct(btc.ch7)}` : "No data", "warn");
  lamp("alts", "2+ alts below floor", altBreaches.length >= 2, 10, altBreaches.length ? `Breached: ${altBreaches.map((c) => c.sym).join(", ")}` : "Floors holding", "warn");
  if (fng != null && fng <= 10 && p != null && p < th.structural) lamp("panic", "Extreme fear + structural break", true, 5, `F&G ${fng} below floor`, "danger");
  const risk = Math.min(100, lamps.reduce((a, l) => a + l.pts, 0));
  const tripped = lamps.filter((l) => l.tripped);

  // Verdict: rails override the read; confidence gate suppresses thin reads
  let verdict;
  if (risk >= 70) verdict = { title: "EXIT SIGNAL", color: C.red, key: "RED", order: "Begin the DCA-out ladder now. Staged tranches — no panic market-sells.", override: true };
  else if (risk >= 45) verdict = { title: "EXIT WATCH", color: C.orange, key: "ORANGE", order: `Pause new buys. 3 daily closes under $${fmtPrice(th.structural)} → start the ladder.`, override: true };
  else if (degraded)
    verdict = {
      title: "LOW CONFIDENCE",
      color: C.dim,
      key: "LOWCONF",
      order:
        source === "claude"
          ? `Prices are on the approximate AI fallback and only ${Math.round(coverage * 100)}% of signals are live. Tap Refresh for a full read before acting on anything.`
          : `Only ${Math.round(coverage * 100)}% of signal weight is live — not enough to trust a regime call. Tap Refresh in ~1 min to light the rest.`,
      override: false,
    };
  else verdict = { title: regime.name.toUpperCase(), color: regime.color, key: regime.key, order: regime.order, override: false };

  // ——— Sitrep (AI consultant) ———
  const runSitrep = async () => {
    setSitrepLoading(true); setSitrepErr(null);
    const snapshot = {
      btc_usd: p, eth_usd: coins.ETH?.price, sol: coins.SOL?.price, near: coins.NEAR?.price, tao: coins.TAO?.price, sui: coins.SUI?.price, render: coins.RENDER?.price,
      btc_7d_pct: btc.ch7, btc_30d_pct: btc.ch30, drawdown_from_ath_pct: dd,
      ma50: ind.ma50, ma200: ind.ma200, cross: ind.cross, price_vs_ma200: maRel,
      rsi_weekly: ind.rsiW, rsi_daily: ind.rsiD, structure_90d: St === 2 ? "higher low" : St === -2 ? "lower low" : "flat",
      fear_greed: fng, btc_dominance_pct: globalM.btcDom,
      mvrv_z_saved: metrics.mvrvZ, ma200w_saved: metrics.ma200w,
      quant_regime: regime.name, composite_score: composite != null ? +composite.toFixed(2) : null,
      rails_risk: risk, rails_tripped: tripped.map((l) => l.label),
      plan: "13-week DCA of ~$62/wk into BTC 35% / ETH 25% / SOL 15% / NEAR 12% / TAO 8% / SUI 5%; 2+ year horizon; invalidation at BTC $48K (3 daily closes).",
    };
    const prompt =
      "You are a disciplined crypto market analyst. Here is my quantitative snapshot as JSON:\n" +
      JSON.stringify(snapshot) +
      '\n\nUse web_search to verify: (1) current Bitcoin MVRV Z-score, (2) current BTC 200-week moving average value, (3) any major market-moving crypto/macro news from the last 7 days (ETF flows, Fed, regulation, major failures). Then respond ONLY with minified JSON, no markdown, exactly this shape: {"regime":"string, your one-or-two-word regime read","agree":true|false,"confidence":"low"|"medium"|"high","drivers":["max 25 words","max 25 words","max 25 words"],"action":"max 35 words, tailored to the DCA plan in the snapshot","watch":"the single most important thing to watch in the next 2 weeks, max 25 words","mvrv_z":number|null,"ma200w":number|null}. Be conservative; never invent numbers you did not verify.';
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: "claude-sonnet-4-6",
          max_tokens: 1000,
          messages: [{ role: "user", content: prompt }],
          tools: [{ type: "web_search_20250305", name: "web_search" }],
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}`);
      const data = await res.json();
      const text = (data.content || []).filter((b) => b.type === "text").map((b) => b.text).join("\n");
      const m = text.replace(/```json|```/g, "").match(/\{[\s\S]*\}/);
      if (!m) throw new Error("Malformed analyst response");
      const j = JSON.parse(m[0]);
      const rec = { ...j, ts: Date.now() };
      setSitrep(rec);
      try { await window.storage.set("exitmon2:sitrep", JSON.stringify(rec)); } catch (e) {}
      // auto-fill verified metrics
      const nm = { ...metrics };
      let changed = false;
      if (typeof j.mvrv_z === "number") { nm.mvrvZ = +j.mvrv_z.toFixed(2); changed = true; }
      if (typeof j.ma200w === "number") { nm.ma200w = Math.round(j.ma200w); changed = true; }
      if (changed) { nm.ts = Date.now(); setMetrics(nm); persist(th, floors, nm); }
    } catch (e) {
      setSitrepErr("Sitrep failed — try again in a minute.");
    }
    setSitrepLoading(false);
  };

  // ——— config ———
  const updateTh = (k, v) => setTh((t) => ({ ...t, [k]: v === "" ? "" : +v }));
  const updateFloor = (k, v) => setFloors((f) => ({ ...(f || {}), [k]: v === "" ? "" : +v }));
  const updateMetric = (k, v) => setMetrics((m) => ({ ...m, [k]: v === "" ? null : +v, ts: Date.now() }));
  const onSave = async () => {
    const ok = await persist(th, floors, metrics);
    setSaveMsg(ok ? "Saved" : "Save failed — session only");
    setTimeout(() => setSaveMsg(""), 2500);
  };
  const toggleCcy = () => {
    const next = ccy === "USD" ? "EUR" : "USD";
    setCcy(next);
    try { window.storage.set("exitmon2:ccy", JSON.stringify(next)); } catch (e) { /* session only */ }
  };

  const onRecalibrate = () => {
    const nf = {};
    for (const c of COINS) {
      if (!c.floorKey) continue;
      const pr = coins[c.sym]?.price;
      nf[c.floorKey] = pr ? +(pr * 0.72).toPrecision(3) : floors?.[c.floorKey] || 0;
    }
    setFloors(nf); persist(th, nf, metrics);
    setSaveMsg("Floors reset to −28% of current");
    setTimeout(() => setSaveMsg(""), 2500);
  };

  // ——— UI atoms ———
  const Section = ({ title, right, children }) => (
    <div className="rounded-lg overflow-hidden mb-3" style={{ background: C.panel, border: `1px solid ${C.etch}` }}>
      <div className="flex items-center justify-between px-3 py-2">
        <span className="text-xs uppercase tracking-widest font-semibold" style={{ color: C.dim }}>{title}</span>
        {right}
      </div>
      {children}
    </div>
  );

  const Toggle = ({ open, set }) => (
    <button onClick={() => set((s) => !s)} className="text-xs uppercase tracking-wider" style={{ color: C.amber }}>
      {open ? "Hide" : "Open"}
    </button>
  );

  const PillarBar = ({ x }) => {
    const v = x.v;
    const pct = v == null ? 0 : (Math.abs(v) / 2) * 50; // half-width max
    const col = v == null ? C.faint : v > 0 ? C.green : v < 0 ? C.red : C.dim;
    return (
      <div className="px-3 py-2" style={{ borderTop: `1px solid ${C.etch}` }}>
        <div className="flex items-baseline justify-between">
          <span className="text-sm font-medium" style={{ color: v == null ? C.faint : C.text }}>
            {x.label} <span className="text-xs" style={{ color: C.faint }}>w{x.w}</span>
          </span>
          <span className="text-xs" style={{ color: col, fontFamily: MONO }}>{v == null ? "—" : (v > 0 ? "+" : "") + v}</span>
        </div>
        <div className="relative h-1.5 mt-1.5 rounded-full" style={{ background: C.etch }}>
          <div className="absolute top-0 bottom-0" style={{ left: "50%", width: 1, background: C.faint }} />
          {v != null && v !== 0 && (
            <div
              className="absolute top-0 bottom-0 rounded-full"
              style={{ background: col, width: `${pct}%`, left: v > 0 ? "50%" : `${50 - pct}%` }}
            />
          )}
        </div>
        <div className="text-xs mt-1" style={{ color: C.faint }}>{x.note}</div>
      </div>
    );
  };

  const Lamp = ({ l }) => {
    const lit = l.tripped;
    const col = lit ? (l.severity === "danger" ? C.red : C.warn) : C.green;
    return (
      <div className="flex items-start gap-3 px-3 py-2.5" style={{ borderTop: `1px solid ${C.etch}` }}>
        <div className="mt-1 flex-shrink-0" style={{ width: 10, height: 10, borderRadius: 2, background: lit ? col : "transparent", border: `1.5px solid ${lit ? col : C.faint}`, boxShadow: lit ? `0 0 8px ${col}66` : "none" }} />
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium" style={{ color: lit ? C.text : C.dim }}>{l.label}</span>
            <span className="text-xs uppercase tracking-wider flex-shrink-0" style={{ color: lit ? col : C.faint, fontFamily: MONO }}>{lit ? `+${l.pts}` : "clear"}</span>
          </div>
          <div className="text-xs mt-0.5" style={{ color: C.faint }}>{l.detail}</div>
        </div>
      </div>
    );
  };

  const NumInput = ({ label, value, onChange, prefix = "$", step }) => (
    <label className="flex items-center justify-between gap-2 py-1.5">
      <span className="text-sm" style={{ color: C.dim }}>{label}</span>
      <span className="flex items-center gap-1">
        <span className="text-xs" style={{ color: C.faint }}>{prefix}</span>
        <input
          type="number" value={value ?? ""} step={step}
          onChange={(e) => onChange(e.target.value)}
          className="w-24 px-2 py-1 rounded text-right text-sm outline-none"
          style={{ background: C.chassis, border: `1px solid ${C.etch}`, color: C.amber, fontFamily: MONO }}
        />
      </span>
    </label>
  );

  const gaugePos = composite == null ? null : ((composite + 2) / 4) * 100;

  return (
    <div className="min-h-screen w-full" style={{ background: C.chassis, color: C.text }}>
      <div className="max-w-md mx-auto px-3 py-4">
        {/* header */}
        <div className="flex items-center justify-between mb-3">
          <div>
            <div className="text-xs uppercase tracking-widest" style={{ color: C.faint }}>Regime engine v2 · Michalis</div>
            <div className="text-lg font-bold tracking-tight uppercase" style={{ letterSpacing: "0.06em" }}>Exit Monitor</div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleCcy}
              className="px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider"
              style={{ background: C.panelUp, border: `1px solid ${C.etch}`, color: C.amber }}
            >
              {ccy === "EUR" ? "€ EUR" : "$ USD"}
            </button>
            <button
              onClick={() => refresh()} disabled={loading}
              className="px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider"
              style={{ background: loading ? C.panel : C.panelUp, border: `1px solid ${C.etch}`, color: loading ? C.faint : C.text }}
            >
              {loading ? "Reading…" : "Refresh"}
            </button>
          </div>
        </div>

        {error && (
          <div className="rounded-lg px-3 py-2.5 mb-3 text-sm" style={{ background: "#2A1A1A", border: `1px solid ${C.redDeep}`, color: C.red }}>{error}</div>
        )}

        {/* verdict banner */}
        <div className="rounded-lg px-4 py-4 mb-3" style={{ background: `linear-gradient(180deg, ${verdict.color}1F 0%, ${C.panel} 85%)`, border: `1px solid ${verdict.color}66` }}>
          <div className="flex items-center justify-between">
            <span className="text-xs uppercase tracking-widest font-semibold" style={{ color: verdict.color }}>
              {verdict.override ? "Rails override" : verdict.key === "LOWCONF" ? "Low confidence" : "Regime read"}
            </span>
            <span className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>
              {loading ? "…" : `${Math.round(coverage * 100)}% live · rails ${risk}/100`}
            </span>
          </div>
          <div className="mt-1 font-black uppercase" style={{ color: verdict.color, fontSize: 30, lineHeight: 1.05, letterSpacing: "0.02em" }}>
            {loading ? "READING" : verdict.title}
          </div>
          <div className="mt-2 text-sm">{loading ? "Pulling market data and computing indicators…" : verdict.order}</div>
          {verdict.override && (
            <div className="mt-1.5 text-xs" style={{ color: C.dim }}>
              Regime read was “{regime.name}” — but the rails are law when invalidation levels break.
            </div>
          )}
          {/* composite gauge */}
          <div className="mt-3" style={{ opacity: verdict.key === "LOWCONF" ? 0.45 : 1 }}>
            <div className="flex justify-between text-xs" style={{ color: C.faint, fontFamily: MONO }}>
              <span>bearish −2</span><span>read {composite == null ? "—" : (composite > 0 ? "+" : "") + composite.toFixed(2)}{verdict.key === "LOWCONF" ? " (partial)" : ""}</span><span>+2 bullish</span>
            </div>
            <div className="relative h-1.5 mt-1 rounded-full" style={{ background: C.etch }}>
              <div className="absolute top-0 bottom-0" style={{ left: "50%", width: 1, background: C.faint }} />
              {gaugePos != null && (
                <div className="absolute top-1/2" style={{ left: `${gaugePos}%`, width: 9, height: 9, borderRadius: 5, background: verdict.key === "LOWCONF" ? C.faint : verdict.color, transform: "translate(-50%,-50%)", boxShadow: verdict.key === "LOWCONF" ? "none" : `0 0 8px ${verdict.color}88` }} />
              )}
            </div>
          </div>
          {updated && (
            <div className="mt-2 text-xs" style={{ color: C.faint, fontFamily: MONO }}>
              {updated.toLocaleString()} · {source === "claude" ? "via Claude web search (approx.)" : source === "live" ? `Binance${srcStatus.cg === "ok" ? " + CoinGecko" : ""} + F&G` : "CoinGecko + F&G"}
              {srcStatus.chart === "binance" ? " · history: Binance" : srcStatus.chart === "coingecko" ? " · history: CoinGecko" : srcStatus.chart === "cached" || srcStatus.chart === "stale-cache" ? " · history cached" : srcStatus.chart === "fail" ? " · history failed" : ""}
              {srcStatus.fng === "fail" ? " · F&G failed" : ""}
            </div>
          )}
          {source === "claude" && !loading && (
            <div className="mt-1.5 text-xs" style={{ color: C.warn }}>
              Prices came from the AI search fallback — approximate. Tap Refresh for exchange-grade data.
            </div>
          )}
        </div>

        {/* pillars */}
        <Section title="Five pillars">
          {pillars.map((x) => <PillarBar key={x.key} x={x} />)}
        </Section>

        {/* sitrep */}
        <Section
          title="AI sitrep"
          right={
            <button
              onClick={runSitrep} disabled={sitrepLoading || loading}
              className="px-2.5 py-1 rounded text-xs font-semibold uppercase tracking-wider"
              style={{ background: sitrepLoading ? C.panelUp : C.amber, color: sitrepLoading ? C.dim : "#1A1A1A" }}
            >
              {sitrepLoading ? "Consulting…" : "Run sitrep"}
            </button>
          }
        >
          <div className="px-3 pb-3" style={{ borderTop: `1px solid ${C.etch}` }}>
            {sitrepErr && <div className="mt-2 text-xs" style={{ color: C.red }}>{sitrepErr}</div>}
            {!sitrep && !sitrepLoading && !sitrepErr && (
              <div className="mt-2 text-xs" style={{ color: C.faint }}>
                Sends the quant snapshot to Claude with live web search: verifies MVRV Z-score and the 200-week MA, scans 7 days of macro/crypto news, and returns a second opinion on the regime read. Takes ~20–30s.
              </div>
            )}
            {sitrepLoading && (
              <div className="mt-2 text-xs" style={{ color: C.dim }}>Searching the web, checking MVRV and news flow…</div>
            )}
            {sitrep && !sitrepLoading && (
              <div className="mt-2">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-semibold" style={{ color: C.amber }}>{sitrep.regime}</span>
                  <span className="text-xs uppercase tracking-wider" style={{ color: sitrep.agree ? C.green : C.warn }}>
                    {sitrep.agree ? "agrees with engine" : "disagrees with engine"}
                  </span>
                  <span className="text-xs" style={{ color: C.faint }}>conf: {sitrep.confidence}</span>
                </div>
                <ul className="mt-2 space-y-1 text-sm" style={{ color: C.dim }}>
                  {(sitrep.drivers || []).map((d, i) => <li key={i}>· {d}</li>)}
                </ul>
                <div className="mt-2 text-sm"><span style={{ color: C.text }}>{sitrep.action}</span></div>
                <div className="mt-1.5 text-xs" style={{ color: C.dim }}>Watch: {sitrep.watch}</div>
                <div className="mt-2 text-xs" style={{ color: C.faint, fontFamily: MONO }}>
                  {new Date(sitrep.ts).toLocaleString()} · AI-generated opinion, not prophecy — verify before acting
                </div>
              </div>
            )}
          </div>
        </Section>

        {/* rails */}
        <Section
          title={`Risk rails (USD) · ${risk}/100 · ${tripped.length} tripped`}
          right={<Toggle open={showRails || risk >= 45} set={setShowRails} />}
        >
          {(showRails || risk >= 45) && lamps.map((l) => <Lamp key={l.id} l={l} />)}
        </Section>

        {/* market strip */}
        <Section title="Market">
          <div className="grid grid-cols-2 gap-px" style={{ background: C.etch }}>
            <div className="px-3 py-3" style={{ background: C.panel }}>
              <div className="text-xs" style={{ color: C.faint }}>BTC / {ccy === "EUR" && fx != null ? "EUR" : "USD"}</div>
              <div className="text-xl" style={{ color: C.amber, fontFamily: MONO }}>{sym}{fmtPrice(disp(p))}</div>
              <div className="text-xs mt-0.5" style={{ color: (btc.ch24 ?? 0) < 0 ? C.red : C.green, fontFamily: MONO }}>
                {fmtPct(btc.ch24)} 24h · {fmtPct(btc.ch7)} 7d
              </div>
              <div className="text-xs" style={{ color: C.faint, fontFamily: MONO }}>
                {dd != null ? `−${dd.toFixed(0)}% from ATH` : ""}{globalM.btcDom != null ? ` · dom ${globalM.btcDom.toFixed(0)}%` : ""}{ccy === "EUR" && fx != null ? ` · $${fmtPrice(p)}` : ""}
              </div>
            </div>
            <div className="px-3 py-3" style={{ background: C.panel }}>
              <div className="text-xs" style={{ color: C.faint }}>Fear &amp; Greed</div>
              <div className="text-xl" style={{ color: C.amber, fontFamily: MONO }}>{fng ?? "—"}</div>
              <div className="text-xs mt-0.5" style={{ color: fng != null && fng <= 25 ? C.warn : C.dim }}>
                {fng == null ? "no data" : fng <= 25 ? "Extreme fear" : fng <= 45 ? "Fear" : fng <= 55 ? "Neutral" : fng <= 75 ? "Greed" : "Extreme greed"}
              </div>
              <div className="mt-1.5 h-1 rounded-full relative" style={{ background: C.etch }}>
                {fng != null && (
                  <div className="absolute top-1/2" style={{ left: `${fng}%`, width: 7, height: 7, borderRadius: 4, background: C.amber, transform: "translate(-50%,-50%)" }} />
                )}
              </div>
            </div>
          </div>
        </Section>

        {/* watchlist */}
        <Section title="Watchlist vs floors">
          {COINS.map((c) => {
            const d = coins[c.sym] || {};
            const floor = c.floorKey && floors ? floors[c.floorKey] : null;
            let badge = null;
            if (c.core) badge = { t: "CORE", col: C.dim };
            else if (floor && d.price != null) {
              if (d.price < floor) badge = { t: "BELOW FLOOR", col: C.red };
              else if (d.price < floor * 1.1) badge = { t: "NEAR FLOOR", col: C.warn };
              else badge = { t: "OK", col: C.green };
            }
            return (
              <div key={c.sym} className="flex items-center justify-between px-3 py-2.5" style={{ borderTop: `1px solid ${C.etch}` }}>
                <div className="min-w-0">
                  <div className="text-sm font-semibold">{c.sym}</div>
                  <div className="text-xs" style={{ color: C.faint }}>{floor ? `floor ${sym}${fmtPrice(disp(floor))}` : c.name}</div>
                </div>
                <div className="text-right">
                  <div className="text-sm" style={{ color: C.amber, fontFamily: MONO }}>{sym}{fmtPrice(disp(d.price))}</div>
                  <div className="flex items-center gap-2 justify-end">
                    <span className="text-xs" style={{ color: (d.ch7 ?? 0) < 0 ? C.red : C.green, fontFamily: MONO }}>{fmtPct(d.ch7)} 7d</span>
                    {badge && <span className="text-xs font-semibold uppercase" style={{ color: badge.col, letterSpacing: "0.05em" }}>{badge.t}</span>}
                  </div>
                </div>
              </div>
            );
          })}
        </Section>

        {/* exit ladder */}
        <Section title="Exit ladder (down)" right={<Toggle open={showExit || verdict.key === "ORANGE" || verdict.key === "RED"} set={setShowExit} />}>
          {(showExit || verdict.key === "ORANGE" || verdict.key === "RED") && (
            <div className="px-3 pb-3 text-sm" style={{ borderTop: `1px solid ${C.etch}` }}>
              <ol className="mt-3 space-y-1.5" style={{ color: C.dim }}>
                <li><span style={{ color: C.text }}>1. Stop all new buys</span> the day the signal fires.</li>
                <li><span style={{ color: C.text }}>2. Week 1:</span> fully exit the weak six if still held — GALA, DOGE, FET, POL, ARB, AVAX.</li>
                <li><span style={{ color: C.text }}>3. Weeks 2–3:</span> sell 50% of NEAR, TAO, SUI, RENDER in two tranches.</li>
                <li><span style={{ color: C.text }}>4. BTC &amp; ETH last:</span> 25%/week only while BTC stays under the capitulation line.</li>
                <li><span style={{ color: C.text }}>5. Park in EUR/stables.</span> Re-entry only on recovery: 200D MA reclaim held a week, F&amp;G &gt; 25, weekly higher low.</li>
              </ol>
            </div>
          )}
        </Section>

        {/* take-profit ladder */}
        <Section title="Take-profit ladder (up)" right={<Toggle open={showProfit || verdict.key === "EUPHORIA"} set={setShowProfit} />}>
          {(showProfit || verdict.key === "EUPHORIA") && (
            <div className="px-3 pb-3 text-sm" style={{ borderTop: `1px solid ${C.etch}` }}>
              <div className="mt-3 text-xs" style={{ color: C.faint }}>Historical top-zone markers — a ladder, not a prediction. DCA in reverse.</div>
              <ol className="mt-2 space-y-1.5" style={{ color: C.dim }}>
                <li><span style={{ color: C.text }}>1. MVRV Z &gt; 5</span> or F&amp;G &gt; 80 for two weeks → sell 25% of SOL/NEAR/TAO/SUI/RENDER.</li>
                <li><span style={{ color: C.text }}>2. New BTC ATH + weekly RSI &gt; 80</span> → another 25% of alts, 10% of ETH.</li>
                <li><span style={{ color: C.text }}>3. Parabolic month (BTC +40% in 30d)</span> → final 25% of alts. Keep the BTC core.</li>
                <li><span style={{ color: C.text }}>4. Never sell everything at once</span> — tops take months, ladders catch them.</li>
              </ol>
            </div>
          )}
        </Section>

        {/* config */}
        <Section title="Trigger levels & metrics" right={<button onClick={() => setShowConfig((s) => !s)} className="text-xs uppercase tracking-wider" style={{ color: C.amber }}>{showConfig ? "Hide" : "Edit"}</button>}>
          {showConfig && (
            <div className="px-3 pb-3" style={{ borderTop: `1px solid ${C.etch}` }}>
              <div className="mt-2 text-xs uppercase tracking-widest" style={{ color: C.faint }}>BTC rails (USD)</div>
              <NumInput label="Caution zone" value={th.caution} onChange={(v) => updateTh("caution", v)} />
              <NumInput label="Structural break" value={th.structural} onChange={(v) => updateTh("structural", v)} />
              <NumInput label="Capitulation" value={th.capitulation} onChange={(v) => updateTh("capitulation", v)} />
              <NumInput label="7d velocity (%)" value={th.velocity} onChange={(v) => updateTh("velocity", v)} prefix="" />
              <div className="mt-2 text-xs uppercase tracking-widest" style={{ color: C.faint }}>Valuation metrics (sitrep auto-fills)</div>
              <NumInput label="MVRV Z-score" value={metrics.mvrvZ} onChange={(v) => updateMetric("mvrvZ", v)} prefix="" step="0.1" />
              <NumInput label="200-week MA" value={metrics.ma200w} onChange={(v) => updateMetric("ma200w", v)} />
              {metrics.ts && <div className="text-xs" style={{ color: C.faint }}>metrics updated {new Date(metrics.ts).toLocaleDateString()}</div>}
              <div className="mt-2 text-xs uppercase tracking-widest" style={{ color: C.faint }}>Alt floors (USD)</div>
              {COINS.filter((c) => c.floorKey).map((c) => (
                <NumInput key={c.floorKey} label={c.sym} value={floors?.[c.floorKey] ?? ""} onChange={(v) => updateFloor(c.floorKey, v)} />
              ))}
              <div className="flex items-center gap-2 mt-3">
                <button onClick={onSave} className="px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider" style={{ background: C.amber, color: "#1A1A1A" }}>Save</button>
                <button onClick={onRecalibrate} className="px-3 py-1.5 rounded text-xs font-semibold uppercase tracking-wider" style={{ background: C.panelUp, border: `1px solid ${C.etch}`, color: C.dim }}>Reset floors −28%</button>
              </div>
              {saveMsg && <div className="mt-2 text-xs" style={{ color: C.green }}>{saveMsg}</div>}
            </div>
          )}
        </Section>

        <div className="text-xs leading-relaxed px-1 pb-6" style={{ color: C.faint }}>
          Rule-based reads on live data plus an AI opinion — context, not prediction. Informational tool, not financial
          advice. Verify prices on your exchange before acting; crypto can fall further than any model expects.
        </div>
      </div>
    </div>
  );
}
