# Risk-layer spec — turning the dashboard into a consultant

Status: **proposal, not built.** Scope: the three Tier-1 upgrades agreed on 2026-07-13.
Governs future work on `index.html`. Nothing here ships until it clears the Methodology Bar
(below). Read this before implementing any of it.

## Why this exists (the thesis)

The system today is a strong **measurement** instrument: it tells you *whether* conditions
are dangerous. It is not yet a **risk** instrument: it never says *how much you should
therefore be holding*, and its evidence is in-sample. Professional safety comes from three
things the app lacks — **position sizing, honest out-of-sample validation, and a
pre-committed policy** — not from more signals. This spec adds exactly those three, and
nothing else.

Grounding (see Sources at end): Faber (trend-timing cuts drawdowns with *one* robust
signal), Man Group / QuantPedia (volatility targeting softens left tails), fractional-Kelly
practice (¼–½ Kelly for volatile assets — never full), Bailey & López de Prado (deflated
Sharpe / walk-forward against overfitting), CBBI (blend on-chain metrics, read their
*agreement*), and the IPS discipline every real advisor starts with.

## Principles (do not violate)

- **Asymmetric by construction.** The sizing layer may only ever *reduce* exposure from a
  volatility-capped base. A bullish signal never levers up. Max recommended exposure ≤ 100%.
  **Never recommend leverage. Never auto-trade. No new API keys, backend, or build step.**
  Stays one file (`index.html`) + `sw.js`; deterministic; every number computed on-device.
- **Rails stay law.** Instant hard rails are unchanged and still override everything.
- **Honest over impressive.** Where a number is an estimate, show the range, not a point.
- **Every parameter here is a *calibratable default*, not a law** — and step B is what
  validates them. If a default can't survive out-of-sample, it changes.

## The Methodology Bar (the real upgrade — applies to anything added after this)

Before any new rail / regime / metric / parameter ships, it must pass all five:
1. **Economic rationale** written *before* testing (no data-mining a pattern then rationalizing).
2. **Out-of-sample lift** — improves risk-adjusted results on data it wasn't tuned on, after a
   penalty for how many variants were tried (deflated, not raw).
3. **Low redundancy** — not ~90% correlated with an existing signal.
4. **Robustness** — a small threshold change doesn't flip the conclusion.
5. **Falsifiability** — you can state what would prove it wrong.

**Permanently out** (fail #5): Elliott Wave, stock-to-flow, rainbow charts, ML price
prediction, and any "more oscillators" for their own sake. Also out: leverage, a many-state
regime zoo, anything that raises confidence faster than evidence.

---

## A. Volatility-targeted position sizing  *(Tier 1-A — the headline)*

### Goal
Output a concrete **recommended BTC exposure** (% of a user-defined total, and a $ delta from
current holdings) that scales *down* automatically as volatility and top-zone risk rise, and
is capped by the user's policy. Turns the binary rails/ladders into a continuous glide-path.

### Inputs
- **Have:** daily closes since 2017 → realized volatility; `composite` (−2..+2); `risk`
  (0..100); regime; valuation pillar `V`; top-zone flags (MVRV-Z>5, F&G>75, wRSI>70); the
  existing `sigmaD`/vol machinery.
- **Need (new config):** `totalValue` (portfolio $), `holdings` (current BTC/crypto $),
  `maxDD` (max tolerable drawdown %, intuitive), `maxPos` (hard cap %, default 100).

### Method (deterministic, vanilla JS)
1. **Realized vol.** `σ = stdev(daily log returns, N) × √365`. Use a responsive-but-stable
   blend: `σ_used = max(σ_30d, σ_90d)` (react up fast, relax slow). Require ≥30 closes.
2. **Vol-target base (cruise control).** Map the user's `maxDD` to a target vol with a
   documented, conservative rule of thumb — a vol-targeted book has historically drawn down
   ~2× its annualized vol → **`σ_target = maxDD / 2`** (e.g. maxDD 40% → σ_target 20%).
   Then `w_vol = min(1, σ_target / σ_used)`. (BTC σ≈60% + σ_target 20% → w_vol≈0.33. No
   leverage: capped at 1.)
3. **Signal tilt (sell into strength / cut on danger).** A multiplier `m ∈ [0,1]`, never >1:
   - `risk < 45` → `m = 1.0`
   - `45 ≤ risk < 70` (EXIT WATCH) → `m` linear `1.0 → 0.5`
   - `risk ≥ 70` (EXIT SIGNAL) → `m` linear `0.5 → 0.0` as risk→100
   - Extra down-tilt when top-zone valuation flags fire (EUPHORIA): multiply `m` by 0.8 per
     active top-zone flag, floored at a small value. DEEPVALUE/RECOVERY leave `m = 1`.
4. **Final target.** `w_target = min(w_vol × m, maxPos)`.
5. **Turnover control (no whipsaw).** Only surface a *change* when
   `|w_target − w_current| > band` (default 10 pts); otherwise "hold." Stage the move through
   the existing ladder (e.g. 4 weekly tranches), so it's never a single market-sell.

### Output / UI — new "Position" card
- Exposure gauge: **current vs. recommended** (e.g. "85% → 43%").
- The **delta in % and $**: "Trim ~42% (~$X) — staged: 4× ~$X/4 weekly."
- The reasoning chain, in one line each: the vol read ("BTC 90d vol 58% → vol-cap 34%"), the
  signal tilt ("EXIT WATCH → ×0.7"), the policy cap.
- If `holdings` unset → show % only (no $). If `<30` closes → hide card ("need more history to
  estimate volatility").

### Data model
Extend `exitmon2:cfg` with `sizing:{ totalValue, holdings, maxDD, maxPos, targetVolOverride }`.
Never wiped (same rule as rails/floors).

### Degradation
No holdings → %-only. Short/uncalibrated history but ≥30 closes → still works (vol from what's
there), with an "uncalibrated" note. `<30` closes → card hidden, not faked.

### Tests (extend `test/harness.js`)
Known-vol series → expected `w_vol`; caps honored; risk tiers produce monotonic `m`;
top-zone flags reduce `m`; turnover band suppresses tiny changes; no-holdings degrades to %;
`<30` closes hides the card; no NaN.

### Effort / risk
Medium. Highest safety-per-effort. Risk: the `maxDD → σ_target` mapping is a heuristic —
**step B validates it**; expose `targetVolOverride` for users who'd rather set vol directly.

---

## B. Out-of-sample / walk-forward validation  *(Tier 1-B — makes it trustworthy)*

### Goal
Report the backtest's forward-return base rates using **only data the calibration hadn't
seen at each point in time**, so the evidence is honest. Show in-sample vs walk-forward side
by side so the "honesty gap" is visible.

### The problem being fixed
`buildBacktest` today replays the pillar engine over history, but `buildCalib` computes the
RSI/Mayer percentiles from the **full** series — including each replayed day's future. That's
look-ahead: the in-sample bands look better than reality.

### Method
1. **Expanding-window calibration.** For each evaluation day `t`, the percentile of that day's
   Mayer/wRSI is taken against the distribution of days **≤ t** only (min 2-year warm-up before
   evaluation starts). Compute efficiently (incremental sorted structure / histogram; the
   replay already walks ~3000 days — keep it O(n log n)).
2. **Walk-forward bands.** Bucket the walk-forward `composite` into the same 5 bands; report
   **out-of-sample** median 30d/90d forward return, N, and % higher at 90d.
3. **Deflation caveat.** Show how many rule variants were tried and a plain-language note that
   even walk-forward isn't a guarantee (the point estimate degrades out of sample). Optionally
   a one-number "in-sample → walk-forward degradation" so the user sees the shrinkage.

### Output / UI
"Track record" card gains a toggle: **in-sample | walk-forward**. Default surfaces
walk-forward as the number to trust, with one honest line: "Walk-forward = tested on unseen
data; this is the number to lean on."

### Constraints
Heavier compute. Keep lazy (only on evidence-panel expand, already the case), show a brief
"computing…" state, cache keyed by history length in a new `exitmon2:wfbt` (short TTL).

### Tests
No look-ahead (a day's percentile uses only past days — assert against a seeded series);
bands populate; degrades cleanly when `<2yr` warm-up; walk-forward medians ≤ in-sample on a
mean-reverting synthetic (sanity that shrinkage appears); no NaN.

### Effort / risk
Medium-high (the efficient expanding-percentile is the tricky bit). Low product risk — it only
makes existing claims more honest.

---

## C. Encoded Investment Policy Statement (IPS)  *(Tier 1-C — the emotion remover)*

### Goal
A saved, pre-committed plan the app renders and repeats back, so a crash executes a decision
the *calm* you already made — not a fresh judgment call under stress.

### Fields (`exitmon2:ips`, never wiped)
`objective` (short text), `maxDD` (shared with A's sizing), `targetPosition`,
`perRegimeAction` (map regime→text, sensible defaults, user-editable),
`tranchePlan` (count + size for staged exits), `reviewedOn` (date).

### Behavior
- Verdict card shows **"Your policy says: ___"** for the current regime/verdict.
- On EXIT SIGNAL/WATCH, it repeats the pre-committed action verbatim, dated:
  "You decided on 2026-07-13: sell in 4 weekly tranches of 25%."
- A gentle "last reviewed N months ago — revisit?" nudge (policies should be re-examined when
  calm, not abandoned when scared).

### UI
Collapsed "Policy" section, editable inline (same no-re-render-on-input pattern as config).
Ties into the backlogged **config export/import** (clipboard JSON / QR) so the policy is
portable and backup-able.

### Tests
Policy persists and never wiped by refresh; per-regime line matches current regime; export/
import round-trips; empty policy degrades to a "set your policy" prompt, not a crash.

### Effort / risk
Low. Mostly structured config + rendering. Strong anxiety payoff for the effort.

---

## Sequencing & dependencies

`maxDD` is shared by **C** (policy) and **A** (sizing), so:

1. **C first** (quick; establishes the risk parameters and the pre-commitment frame), then
2. **A** (consumes `maxDD`; the headline safety lever), then
3. **B** (validates A's parameters and the whole engine out-of-sample).

Alternative if you want the headline first: build **A** with an inline minimal `maxDD` input,
fold the full **C** in right after. Either way **B lands last** — it's the audit of everything
before it.

Each item ships behind its own tests (harness stays green) and its own card, independently
useful. None touches the price-median core, the rails, or the offline/watchdog paths.

## Out of scope for Tier 1 (revisit only after, and only via the Methodology Bar)
Probabilistic CIs via bootstrap (D), composite-agreement scoring (E), correlation-aware alt
risk (F), and any regime-model upgrade or new metric (Tier 3).

## Sources
- Faber, *A Quantitative Approach to Tactical Asset Allocation* — https://mebfaber.com/wp-content/uploads/2016/05/SSRN-id962461.pdf
- Man Group, *The Impact of Volatility Targeting* — https://www.man.com/insights/the-impact-of-volatility-targeting
- QuantPedia, *An Introduction to Volatility Targeting* — https://quantpedia.com/an-introduction-to-volatility-targeting/
- Bailey & López de Prado, *The Deflated Sharpe Ratio* — https://papers.ssrn.com/sol3/papers.cfm?abstract_id=2460551
- CBBI (Colin's Bitcoin Bull Run Index) — https://colintalkscrypto.com/cbbi/
- HMM regime detection (context/caution) — https://www.quantifiedstrategies.com/hidden-markov-model-market-regimes-how-hmm-detects-market-regimes-in-trading-strategies/