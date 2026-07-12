# Exit Monitor — project brief

Personal crypto exit dashboard. The deliverable is **`index.html`** — one self-contained file
(inline CSS + vanilla JS, no framework, no build, no dependencies) the user runs on his phone
via Add to Home Screen, hosted over HTTPS. `sw.js` (app-shell service worker) is the one other
real file — must stay a separate file, service workers cannot be inlined/data-URI'd.
The old React/AI version (`exit-monitor-v2.jsx`) has been deleted — fully superseded, no need
to reference it.

## Hard constraints (do not violate)
- **No AI, no backend, no build step, no CDN/external assets.** Every number comes from public
  keyless APIs, computed on-device. Never add an API key to client JS.
- Stays ONE file. Prices = median of 4 exchanges (OKX, data-api.binance.vision, Coinbase,
  KuCoin), needs ≥2 to agree.
- "Rails are law": hard risk lamps override the regime read and must fire instantly (no
  hysteresis on rails; hysteresis only smooths the regime label, 48h confirm).
- bitcoin-data.com allows **15 req/day** — keep its 12h cache + 10-min failure backoff.

## Token-saving rules for Claude
- **Don't read `index.html` top-to-bottom.** Grep for section banners and read only that range:
  `price sources`, `history:`, `calibration`, `on-chain valuation`, `regimes + hysteresis`,
  `STATE`, `FETCH ORCHESTRATOR`, `ENGINE`, `RENDER`, `EVENTS`. CSS/head (lines 1–92) rarely change.
- **Validate with `node test/harness.js`** (41 offline checks, mocked network/DOM — must stay
  green) and `node test/live.js` (real APIs, ~15 requests — use sparingly, it spends the
  bitcoin-data daily quota). Don't rebuild mocks from scratch; extend harness.js.
  `sw.js` has no logic to unit-test (pure cache plumbing) — `node --check sw.js` for syntax only.
- APIs below are verified working (2026-07-12) — don't re-test them unless something fails.

## Architecture (index.html)
- **Data**: 4 ticker sources → `aggregate()` median + spread. BTC daily closes since 2017-08-17:
  Binance paginated klines → Coinbase paginated candles → OKX/Kraken short fallback
  ("uncalibrated" mode). Weekly closes derived locally (Monday buckets). On-chain: bitcoin-data.com
  `/v1/{mvrv-zscore,nupl,puell-multiple}/last` + full `/v1/mvrv-zscore` series (7d cache, backtest).
  F&G: alternative.me (limit=30 live, limit=0 full history for backtest, 7d cache).
  FX: frankfurter→er-api→exchangerate.host. CoinGecko: cosmetic alt 7d% only, never blocks.
- **Engine**: 5 pillars (Trend w30, Momentum w20, Valuation w25, Sentiment w15, Structure w10),
  each −2…+2 → weighted composite → regime (NEUTRAL/EUPHORIA/DEEPVALUE/BULL/RECOVERY/BEAR).
  Momentum scored by weekly-RSI percentile over 9y (`buildCalib`/`pctile`); Valuation = blend
  zMvrv 50% + zNupl 30% + zPuell 20% (fallback: manual MVRV ≤7d, then drawdown proxy);
  +1 kicker below 200W MA. Regime passes `resolveRegime()` hysteresis. Verdict: risk≥70 EXIT
  SIGNAL, ≥45 EXIT WATCH, degraded→LOW CONFIDENCE, else regime. Tripwires panel shows distance
  to nearest rail, 7d velocity in σ, and top-zone gaps (F&G>75, wRSI>70, MVRV Z>5).
  Extra lamps: `sigma` (7d ≤ −2.5σ vs 90d vol) and `divergence` (`bearishDivergence()`: price
  higher high + weekly RSI lower high, completed weeks, 52w lookback), 10 pts each.
- **Backtest** (`buildBacktest()` → "Track record" card, collapsed): replays the pillar engine
  over every day since ~2018, buckets composite into 5 bands, reports N / median 30d & 90d fwd
  return / % higher at 90d, highlights today's band. In-sample (disclosed); weekly values use
  last completed week (no lookahead); V replayed from MVRV Z only.
- **localStorage keys**: `exitmon2:cfg` (user rails/floors/manual MVRV — never wipe),
  `ccy`, `fx`, `histv2` ([ts,close] since 2017, 6h TTL, incremental delta), `onchain` (12h TTL),
  `regime` ({cur, since, pending, pendingSince}), `fnghist` + `mvrvhist` (dayNum→value maps, 7d TTL),
  `lastgood` ({ts, coins, quality, fng, fngTrend, source} — snapshot of the last successful
  refresh, used for the offline fallback below).
- **Render**: full re-render into `#root` via innerHTML; event delegation (one click + one input
  listener). Config inputs must NOT re-render on input (keyboard focus).
- **Offline behavior**: `sw.js` is a network-first/cache-fallback service worker for the app
  shell only (same-origin GET requests; API calls always pass through untouched) — lets the page
  itself load with zero connectivity. Inside `refresh()`, if all 4 price sources fail, it loads
  `exitmon2:lastgood` and renders the full dashboard from that cached snapshot (history/on-chain/
  F&G already degrade to their own caches independently) with `state.offline=true` and
  `state.updated` pinned to the snapshot's timestamp, not `Date.now()` — never fake freshness.
  UI shows an amber "Offline — showing cached read from …" banner (not the red error bar).
  Only shows the hard "sources unreachable" error when there is no `lastgood` at all (fresh
  install, never had a successful load). Don't collapse `offline` into the `degraded`/low-
  confidence calculation — they're different concepts (staleness vs. source disagreement).

## Backlog (agreed with user, not built)
GitHub Pages setup walkthrough. Ideas raised but not committed to: watchdog cron (GitHub Actions
+ Telegram alert on rail trip/regime flip), portfolio holdings → concrete order sizes, config
export/import (QR or clipboard JSON).
(Phase 2 — backtest panel, σ lamp, divergence lamp — shipped 2026-07-12.
Phase 3 — offline PWA: service worker + lastgood cache fallback — shipped 2026-07-12.)