// End-to-end harness for index.html — mocks all network + storage, boots the real script.
const fs = require("fs");
const html = fs.readFileSync("/home/captain-mike/Documents/crypto exit/index.html", "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

// deterministic synthetic BTC series: trend + cycles since 2017-08-17
const DAY = 86400000, GEN = 1502928000000;
const today = Math.floor(Date.now() / DAY) * DAY;
const nDays = Math.floor((today - GEN) / DAY) + 1;
const priceAt = (i) => 4000 * Math.exp(0.00065 * i) * (1 + 0.45 * Math.sin(i / 230));
const tickers = { BTC: priceAt(nDays - 1), ETH: 2500, SOL: 120, NEAR: 3.2, TAO: 280, SUI: 2.1, RENDER: 4.5 };

function makeEnv(store, opts = {}) {
  const fetchLog = [];
  const j = (data) => ({ ok: true, status: 200, json: async () => data });
  async function fetchMock(url) {
    fetchLog.push(url);
    if (opts.fail && opts.fail.some((s) => url.includes(s))) throw new Error("mock net fail: " + url);
    if (url.includes("okx.com/api/v5/market/tickers"))
      return j({ data: Object.entries(tickers).map(([s, p]) => ({ instId: s + "-USDT", last: String(p), open24h: String(p * 0.99) })) });
    if (url.includes("data-api.binance.vision/api/v3/ticker/24hr"))
      return j(Object.entries(tickers).map(([s, p]) => ({ symbol: s + "USDT", lastPrice: String(p * 1.001), priceChangePercent: "1.2" })));
    if (url.includes("api.coinbase.com/v2/prices/")) {
      const base = url.match(/prices\/(\w+)-USD/)[1];
      return j({ data: { amount: String(tickers[base] * 0.999) } });
    }
    if (url.includes("api.kucoin.com"))
      return j({ data: { ticker: Object.entries(tickers).map(([s, p]) => ({ symbol: s + "-USDT", last: String(p * 1.0005), changeRate: "0.012" })) } });
    if (url.includes("data-api.binance.vision/api/v3/klines")) {
      const u = new URL(url);
      const st = +u.searchParams.get("startTime"), lim = +u.searchParams.get("limit") || 500;
      const i0 = Math.max(0, Math.ceil((st - GEN) / DAY));
      const rows = [];
      for (let i = i0; i < Math.min(nDays, i0 + lim); i++)
        rows.push([GEN + i * DAY, "0", "0", "0", String(priceAt(i)), "0", 0, "0", 0, "0", "0", "0"]);
      return j(rows);
    }
    if (url.includes("api.exchange.coinbase.com/products/BTC-USD/candles")) {
      const u = new URL(url);
      const st = Date.parse(u.searchParams.get("start")), en = Date.parse(u.searchParams.get("end"));
      const rows = [];
      for (let i = Math.max(0, Math.ceil((st - GEN) / DAY)); i < nDays && GEN + i * DAY < en; i++)
        rows.push([(GEN + i * DAY) / 1000, 0, 0, 0, priceAt(i), 0]);
      return j(rows.reverse());
    }
    if (url.includes("okx.com/api/v5/market/candles")) {
      const rows = [];
      for (let i = nDays - 300; i < nDays; i++) rows.push([String(GEN + i * DAY), "0", "0", "0", String(priceAt(i)), "0"]);
      return j({ data: rows.reverse() });
    }
    if (url.includes("kraken.com"))
      return j({ result: { XXBTZUSD: Array.from({ length: 720 }, (_, k) => { const i = nDays - 720 + k; return [String((GEN + i * DAY) / 1000), "0", "0", "0", String(priceAt(i)), "0", "0", 0]; }) } });
    if (url.includes("bitcoin-data.com/v1/mvrv-zscore/last")) return j({ d: "2026-07-11", unixTs: 1, mvrvZscore: 0.3801 });
    if (url.includes("bitcoin-data.com/v1/nupl/last")) return j({ d: "2026-07-11", unixTs: 1, nupl: 0.1694 });
    if (url.includes("bitcoin-data.com/v1/puell-multiple/last")) return j({ d: "2026-07-11", unixTs: 1, puellMultiple: 0.6848 });
    if (url.includes("bitcoin-data.com/v1/mvrv-zscore")) { // full daily series since 2022-07
      const rows = [];
      for (let dn = Math.floor(Date.UTC(2022, 6, 8) / DAY); dn <= Math.floor(today / DAY); dn++)
        rows.push({ d: new Date(dn * DAY).toISOString().slice(0, 10), unixTs: dn * 86400, mvrvZscore: +(1.5 + 1.5 * Math.sin(dn / 200)).toFixed(4) });
      return j(rows);
    }
    if (url.includes("alternative.me")) {
      if (url.includes("limit=0")) { // full history since 2018-02
        const data = [];
        for (let dn = Math.floor(today / DAY); dn >= Math.floor(Date.UTC(2018, 1, 1) / DAY); dn--)
          data.push({ value: String(Math.round(50 + 40 * Math.sin(dn / 50))), timestamp: String(dn * 86400) });
        return j({ data });
      }
      return j({ data: Array.from({ length: 30 }, (_, k) => ({ value: String(34 + (k % 5)) })) });
    }
    if (url.includes("frankfurter") || url.includes("er-api") || url.includes("exchangerate.host")) return j({ rates: { EUR: 0.86 } });
    if (url.includes("coingecko")) return j([]);
    throw new Error("unmocked url: " + url);
  }
  const localStorageMock = {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  };
  const cap = { html: "" };
  const root = {
    handlers: {},
    addEventListener(t, f) { this.handlers[t] = f; },
    set innerHTML(h) { cap.html = h; },
    get innerHTML() { return cap.html; },
  };
  const documentMock = { getElementById: () => root };
  return { fetchMock, localStorageMock, documentMock, cap, fetchLog, root };
}
const clickAction = (env, action) => env.root.handlers.click({ target: { closest: () => ({ dataset: { action } }) } });

async function boot(store, opts) {
  const env = makeEnv(store, opts);
  new Function("fetch", "localStorage", "document", js)(env.fetchMock, env.localStorageMock, env.documentMock);
  for (let i = 0; i < 100; i++) {
    if (env.cap.html.includes("median of")) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await new Promise((r) => setTimeout(r, 100)); // let trailing renders settle
  return env;
}

let pass = 0, failCount = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("  ok  " + name); } else { failCount++; console.log("  FAIL " + name); } };

(async () => {
  // syntax
  try { new Function(js); console.log("syntax: parses cleanly (" + js.split("\n").length + " lines)"); }
  catch (e) { console.log("SYNTAX ERROR: " + e.message); process.exit(1); }

  // A — fresh boot, everything up
  console.log("\n[A] fresh boot, all sources up");
  const storeA = new Map();
  const a = await boot(storeA);
  check("renders verdict + composite", /read [+\-−0]/.test(a.cap.html));
  check("momentum scored by percentile", a.cap.html.includes("pctile ("));
  check("valuation from on-chain blend", a.cap.html.includes("on-chain: MVRV Z 0.38"));
  check("tripwires panel present", a.cap.html.includes("Tripwires"));
  check("nearest rail with distance", a.cap.html.includes("% below current"));
  check("regime-held indicator", a.cap.html.includes("regime held"));
  check("no NaN / undefined in output", !a.cap.html.includes("NaN") && !a.cap.html.includes("undefined"));
  const histA = JSON.parse(storeA.get("exitmon2:histv2") || "null");
  check("full history cached (" + (histA ? histA.days.length : 0) + "d)", histA && histA.days.length > 3000);
  const regA = JSON.parse(storeA.get("exitmon2:regime") || "null");
  check("regime persisted (cur=" + (regA && regA.cur) + ")", !!(regA && regA.cur));
  const klA = a.fetchLog.filter((u) => u.includes("/api/v3/klines")).length;
  check("history paginated in " + klA + " requests", klA >= 3 && klA <= 5);
  check("on-chain fetched (3 last + 1 series)", a.fetchLog.filter((u) => u.includes("bitcoin-data.com")).length === 4);
  check("history live shown", a.cap.html.includes("history live"));

  // B — second boot, same storage: caches must hold
  console.log("\n[B] warm boot (cache reuse)");
  const b = await boot(storeA);
  check("no kline refetch", b.fetchLog.filter((u) => u.includes("/api/v3/klines")).length === 0);
  check("no on-chain refetch", b.fetchLog.filter((u) => u.includes("bitcoin-data.com")).length === 0);
  check("history cached shown", b.cap.html.includes("history cached"));

  // C — hysteresis
  const rawKey = regA.cur;
  const other = rawKey === "BEAR" ? "BULL" : "BEAR";
  console.log("\n[C] hysteresis (raw regime = " + rawKey + ", seeded held = " + other + ")");
  const storeC1 = new Map();
  storeC1.set("exitmon2:regime", JSON.stringify({ cur: other, since: Date.now() - 10 * DAY, pending: rawKey, pendingSince: Date.now() - 49 * 3600000 }));
  const c1 = await boot(storeC1);
  const regC1 = JSON.parse(storeC1.get("exitmon2:regime"));
  check("pending >48h confirms switch", regC1.cur === rawKey);
  check("fresh switch shows 'held under 1 day'", c1.cap.html.includes("regime held under 1 day"));
  const storeC2 = new Map();
  storeC2.set("exitmon2:regime", JSON.stringify({ cur: other, since: Date.now() - 10 * DAY, pending: rawKey, pendingSince: Date.now() - 1 * 3600000 }));
  const c2 = await boot(storeC2);
  const regC2 = JSON.parse(storeC2.get("exitmon2:regime"));
  check("pending <48h holds old label", regC2.cur === other);
  check("shows 'read shifting' countdown", c2.cap.html.includes("read shifting"));

  // D — full history unavailable → short OKX fallback, uncalibrated
  console.log("\n[D] short-history fallback (Binance klines + Coinbase candles down)");
  const d = await boot(new Map(), { fail: ["/api/v3/klines", "api.exchange.coinbase.com"] });
  check("short-history notice", d.cap.html.includes("short history (uncalibrated)"));
  check("momentum marked uncalibrated", d.cap.html.includes("uncalibrated"));
  check("no percentile claims", !d.cap.html.includes("pctile ("));
  check("still renders verdict, no NaN", /read [+\-−0]/.test(d.cap.html) && !d.cap.html.includes("NaN"));

  // E — on-chain feed down → drawdown proxy
  console.log("\n[E] on-chain feed unreachable");
  const e = await boot(new Map(), { fail: ["bitcoin-data.com"] });
  check("valuation falls back to proxy", e.cap.html.includes("proxy — on-chain feed unreachable"));
  check("rest of engine unaffected", e.cap.html.includes("pctile (") && !e.cap.html.includes("NaN"));
  clickAction(e, "evidence");
  check("backtest still runs without MVRV series", e.cap.html.includes("90d later: median") && e.cap.html.includes("series unavailable"));

  // F — Phase 2: track record panel + new lamps (reuses booted scenario A)
  console.log("\n[F] track record panel + sigma/divergence lamps");
  clickAction(a, "evidence");
  check("backtest rows render", a.cap.html.includes("90d later: median"));
  check("current band highlighted", a.cap.html.includes("◀ today"));
  check("in-sample caveat shown", a.cap.html.includes("evidence, not prophecy"));
  const fngH = JSON.parse(storeA.get("exitmon2:fnghist") || "null");
  const zH = JSON.parse(storeA.get("exitmon2:mvrvhist") || "null");
  check("series cached (F&G " + (fngH ? Object.keys(fngH.map).length : 0) + "d, MVRV " + (zH ? Object.keys(zH.map).length : 0) + "d)",
    fngH && Object.keys(fngH.map).length > 2000 && zH && Object.keys(zH.map).length > 1000);
  clickAction(a, "rails");
  check("sigma lamp present", a.cap.html.includes("vol-adjusted"));
  check("divergence lamp present", a.cap.html.includes("Bearish divergence (weekly)"));
  check("no NaN after toggles", !a.cap.html.includes("NaN"));

  console.log("\n" + pass + " passed, " + failCount + " failed");
  process.exit(failCount ? 1 : 0);
})();
