# Exit Monitor — project brief

Personal crypto exit dashboard. The deliverable is **`index.html`** — one self-contained file
(inline CSS + vanilla JS, no framework, no build, no dependencies) the user runs on his phone
via Add to Home Screen, hosted over HTTPS. `sw.js` (app-shell service worker) is the one other
real file in the app — must stay a separate file, service workers cannot be inlined/data-URI'd.
The `watchdog/` folder (Node, GitHub Actions only — never shipped to the phone, never touches
`index.html`) is an optional off-device alerter; see "Watchdog" below.
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
- **Validate with `node test/harness.js`** (82 offline checks, mocked network/DOM — must stay
  green) and `node test/watchdog.js` (29 checks: alert logic + a live-engine `derive()` field
  contract). Both use the shared mocks in `test/env.js` — don't rebuild mocks from scratch,
  extend `env.js`. `node test/live.js` hits real APIs (~15 requests — use sparingly, spends the
  bitcoin-data daily quota). `sw.js` has no logic to unit-test — `node --check sw.js` for syntax.
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
- **Position sizing** (Phase 5-A, `computeSizing()` → "Position sizing" card): vol-targeted
  recommended exposure. `wVol=min(1, σ_target/σ_ann)` where `σ_ann=max(sigmaD,sigmaD30)·√365`
  and `σ_target=(maxDD/100)/2`; × signal tilt `m∈[0,1]` (risk≥70→0.5..0, 45..70→1..0.5; ×0.8
  per top-zone marker); capped at `ips.maxPos`. **Asymmetric — only ever de-risks, min(…,1), never
  levers, never auto-trades.** Turnover deadband 0.10 (hold vs trim/add); `$` delta needs
  `ips.totalValue`+`ips.holdings`, else %-only. Null (no card) when no `maxDD` or <30 return days.
- **DCA scheduler** (Phase 6, `computeDca()` → "DCA schedule" card): paces a per-coin weekly buy
  plan (`ips.dca`). **Pace = CHEAPNESS (Valuation+Sentiment pillars = MVRV+F&G), NOT the exposure
  gap** — buy-timing is mean-reversion, the opposite of the momentum/risk-off exit signal (see
  `docs/dca-scheduler-spec.md` for the research). `accel=clamp(1+0.5·valueScore,0.5,2)` where
  `valueScore=(V·25+S·15)/40`; × ceiling (taper to 0 as `wCur`→`wTarget`, from `computeSizing`);
  capped at 1.0× when verdict is EXIT WATCH/SIGNAL (rails). No short-horizon dip trigger. Shows
  idle-cash deployment timeline. NOTE: user-entered money (`totalValue`/`holdings`/`dca`) is in the
  DISPLAY currency — do NOT wrap in `disp()` (that's for USD exchange prices only); Phase 6 fixed a
  latent bug where Phase 5-A did.
- **Backtest** (`buildBacktest()` → "Track record" card, collapsed): replays the pillar engine
  over every day since ~2018, buckets composite into 5 bands, reports N / median 30d & 90d fwd
  return / % higher at 90d, highlights today's band. Phase 5-B: computes BOTH `rowsWf`
  (walk-forward — Momentum percentile from an expanding window `wfPct`, only weeks ≤ that day, no
  look-ahead; <100 prior weeks → fixed-band fallback) and `rowsIn` (in-sample — full-distribution
  percentile). UI toggles `ui.wf` (default walk-forward = the honest one); only Momentum was
  calibrated so it's the sole look-ahead source. Weekly values use last completed week; V from MVRV Z.
- **localStorage keys**: `exitmon2:cfg` (user rails/floors/manual MVRV — never wipe),
  `ips` (Phase 5-C policy {objective, plan, maxDD, targetPos, totalValue, holdings, maxPos,
  `dca`:{sym→weekly $}, reviewedOn} — own key, never wiped by `cfg` persist; `maxDD` feeds Phase
  5-A sizing, `dca` feeds Phase 6 scheduler),
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

## Watchdog (off-device alerter — `watchdog/` + `.github/workflows/watchdog.yml`)
Optional. A GitHub Actions cron runs the **real** engine server-side and pushes a Telegram
message when a rail trips / regime flips / exit verdict escalates or eases — so the user hears
about a market event without opening the app. Does NOT modify `index.html` or the phone app.
- **No engine drift**: `watchdog/engine.js` reads `index.html`, unwraps its outer IIFE at
  runtime (no edit to the file), appends a hook exposing `state`/`derive`, and boots it in Node
  against real APIs. Alert logic reads `derive()` output as structured data — never scrapes HTML.
  If the `(function(){ … })();` wrapper shape changes, `engine.js` throws loudly (guarded).
- `watchdog/alert.js` = pure `decideAlert(prev, cur)` (no I/O) — tier ladder RED>ORANGE>regime,
  regime-flip, newly-tripped rails; never alerts when offline or <2 sources. `watchdog/check.js`
  = glue (boot → snapshot → decide → Telegram). Telegram creds are **GitHub secrets**
  (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`) — never in client JS; missing creds → logs, no send.
- **Quota**: cron is every 2h but cross-run state (engine localStorage incl. 48h regime memory +
  API caches) persists via `actions/cache` under `watchdog/.state/` (gitignored), so bitcoin-data's
  on-chain cache stays warm 12h → ~2 cold refreshes/day (~8 requests), under its 15/day. NOTE:
  GitHub runners share a pool of egress IPs across all customers, so if bitcoin-data rate-limits by
  IP the watchdog can still hit 429s from unrelated jobs — in that case the engine degrades to the
  drawdown proxy for Valuation, and the watchdog's regime read can diverge from the phone's (which
  uses the user's own IP). Not fatal, just less precise on those runs. Regime-flip alerts ride the
  engine's own 48h hysteresis (no extra debounce). Cache loss / an offline run re-baselines silently:
  never a false alert, but a transition that completes entirely inside that gap can be MISSED — the
  cost of the cache-based design (low risk while the 2h cron keeps the cache warm within cache TTL).
- **At-least-once alerting**: `check.js` only advances its baseline snapshot when the read is
  trusted AND any alert actually sent (`commitBaseline`); a failed Telegram send or an untrusted
  read holds the old baseline so the next run re-detects and retries — an alert is never silently
  dropped by a transient send failure.
- **Repo is public** (since 2026-11-17, so Actions + Pages stay free without GitHub Pro). Public
  repos lose cron after 60 days with no activity, so the workflow's last step re-enables itself
  via the API every run (`actions: write`, `continue-on-error`). Never commit secrets or real
  amounts: they would be public.
- Validate: `node test/watchdog.js` (offline). Live smoke = run `watchdog/check.js` with
  `WATCHDOG_STATE_DIR=<scratch>` (one real refresh, ~4 bitcoin-data reqs — sparingly).

## Backlog (agreed with user, not built)
Still open: GitHub Pages walkthrough. Tier-2/3 risk-layer ideas from
[`docs/risk-layer-spec.md`](docs/risk-layer-spec.md) (bootstrap CIs, composite-agreement
scoring, correlation-aware alt risk, any regime-model upgrade) remain gated on the Methodology
Bar in that spec — each must show out-of-sample lift before shipping.
(Phase 2 — backtest panel, σ lamp, divergence lamp — shipped 2026-07-12.
Phase 3 — offline PWA: service worker + lastgood cache fallback — shipped 2026-07-12.
Phase 4 — watchdog cron + Telegram alerts — shipped 2026-07-12.
Phase 5 — risk layer, spec in `docs/risk-layer-spec.md` — shipped 2026-07-13:
  C encoded IPS (`exitmon2:ips`, verdict repeat-back), A vol-targeted position sizing
  (`computeSizing`, "Position sizing" card), B walk-forward backtest (`rowsWf`/`rowsIn` toggle).
Phase 6 — DCA scheduler, spec in `docs/dca-scheduler-spec.md` — shipped 2026-07-13:
  `computeDca` "DCA schedule" card, cheapness-paced (V+S) with exposure ceiling + rails cap.
  Also: synced watchlist to actual holdings (BTC/ETH/SOL/NEAR/LTC, ladders generate from `ALTS`);
  fixed a currency bug (user-entered money must not be `disp()`-converted).
Config backup/restore — shipped 2026-07-15: "Backup & restore" card (`ui.backup`). `buildBackup()`
  serializes {app,v,cfg,ips,ccy} → JSON (the two own-decision keys + display ccy, NOT market data);
  `applyBackup()` validates `app==="exitmon2"`, merges into state, persists (keeps the backup's
  `reviewedOn`, doesn't re-stamp), re-renders. Clipboard copy via `copyText()` (navigator.clipboard
  → hidden-textarea execCommand fallback). Paste target is input group `backup` → `state.importText`
  (no re-render, keeps focus). Transfer is copy/paste JSON — QR was dropped (a correct inline QR
  encoder is a lot of untested code, and the ips+cfg payload is too big to scan reliably).)