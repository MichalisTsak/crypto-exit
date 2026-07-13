// Shared mocked environment for the offline tests (harness.js + watchdog.js).
// Deterministic synthetic BTC series + mocked network/storage/DOM, so the real
// index.html script can be booted with zero connectivity.
const fs = require("fs");
const path = require("path");

const INDEX = path.join(__dirname, "..", "index.html");
const html = fs.readFileSync(INDEX, "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];

// deterministic synthetic BTC series: trend + cycles since 2017-08-17
const DAY = 86400000, GEN = 1502928000000;
const today = Math.floor(Date.now() / DAY) * DAY;
const nDays = Math.floor((today - GEN) / DAY) + 1;
const priceAt = (i) => 4000 * Math.exp(0.00065 * i) * (1 + 0.45 * Math.sin(i / 230));
const tickers = { BTC: priceAt(nDays - 1), ETH: 2500, SOL: 120, NEAR: 3.2, LTC: 65 };

function makeEnv(store, opts = {}) {
  const fetchLog = [];
  const j = (data) => ({ ok: true, status: 200, json: async () => data });
  async function fetchMock(url) {
    fetchLog.push(url);
    if (opts.failAll) throw new Error("mock net fail: fully offline");
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

module.exports = { js, DAY, GEN, today, nDays, priceAt, tickers, makeEnv, clickAction };