# DCA scheduler spec — cheapness-paced buy scheduling

Status: **proposal, not built.** Builds on Phase 5-A (`computeSizing`) and Phase 5-C
(`exitmon2:ips`) from [`docs/risk-layer-spec.md`](risk-layer-spec.md). Nothing ships until confirmed.
Supersedes the first draft of this spec (which paced buys off the exposure gap — that was wrong;
see "Signal choice" below).

## Why this exists

The user DCAs a fixed weekly amount into their coins and asked whether the app can turn
"allocation + buy plan" into something useful, informed by the engine's signals. This schedules
buys across the *existing* `COINS` list. It does NOT judge whether to *add* a new coin — that
needs live qualitative research, outside the deterministic/keyless/no-AI architecture. That stays
a conversation.

## Signal choice — what the research says (the crux; get this right)

**Exit-timing and buy-timing are opposite problems and need opposite signals.**
- The engine was built for **exit-timing** = a momentum/trend problem (is the trend/rails
  breaking). The risk score and the Phase 5-A exposure gap are dominated by this.
- **Buy-timing = a mean-reversion / cheapness problem.** Evidence:
  - "Buy the dip" **fails at short horizons** — a few-weeks dip has momentum (keeps dipping);
    AQR calls dip-buying *"value investing at a momentum horizon."* → **do NOT key the accelerator
    off short-term price drops or the crash-risk score.**
  - It **works at cycle horizons**, where valuation mean-reverts:
    - **MVRV Z-score** is *"the single best on-chain predictor for DCA timing"* — low MVRV →
      highest historical 30d/90d forward returns.
    - **Fear & Greed, contrarian** — doubling buys under F&G 25 / pausing over 75 backtested
      ~1,145% vs buy-and-hold, Sharpe 1.38 vs 0.88, max drawdown −52% vs −78%.

**The app already computes both, as calibrated pillars:** MVRV → **Valuation pillar `V`**,
F&G → **Sentiment pillar `S`** (both oriented so *higher = cheaper/more fearful = accumulate more*).
So the accelerator reuses already-(walk-forward-)validated signals — no new indicator.

**Why the first draft (exposure gap) was wrong:** in a crash to deep value the risk score spikes →
`wTarget` drops → the gap shrinks → it would *slow* buying exactly when the evidence says accelerate.
Sizing and DCA-pacing correctly use *different* signals — not an inconsistency, a separation of
concerns: sizing = "how much risk to hold" (whole risk-weighted composite, cuts in crashes);
DCA-pace = "is now a good time to add" (cheapness, leans in on fear/undervaluation).

## Design — three levers, each doing what it's good at

| Lever | Source | Role |
|---|---|---|
| **Pace** | cheapness = Valuation `V` + Sentiment `S` | drives the 0.5×–2.0× multiplier |
| **Ceiling** | exposure gap from `computeSizing` | tapers buys to 0 as you reach target exposure |
| **Safety cap** | rails / EXIT verdict | caps acceleration at 1.0× during a confirmed breakdown |

### New config: `ips.dca`
Coin symbol → weekly $ amount, e.g. `{BTC:20, ETH:20, SOL:20, NEAR:15, LTC:7}`. Extends
`exitmon2:ips` (no new key). `DEFAULT_IPS.dca = {}`.

### Pace — cheapness multiplier
```
parts = [];  if V!=null parts.push([V,25]);  if S!=null parts.push([S,15])
valueScore = parts.length ? Σ(v·w)/Σw : null            // ∈ [−2,+2]; + = cheap/fearful
accel = valueScore==null ? 1.0 : clamp(1 + 0.5·valueScore, 0.5, 2.0)
        // V=S=+2 → 2.0×  ·  neutral → 1.0×  ·  V=S=−2 (euphoria) → 0.5×
```
Bounded 0.5×–2.0× so a noisy day can't swing the suggestion wildly. **No short-horizon price-dip
term** — deliberately excluded (momentum trap, above).

### Ceiling — don't buy past your target exposure
Reuses `computeSizing()`'s `wTarget`/`wCur`/`band`:
```
headroom = wTarget − wCur
ceiling  = headroom<=0 ? 0 : headroom>=band ? 1 : headroom/band    // taper in the last `band`
accel *= ceiling
```
If sizing is null (no `maxDD`) or `wCur` unknown (no holdings): `ceiling = 1` — pace on cheapness
alone, honestly unrestricted, since exposure can't be known.

### Safety cap — rails are law (user choice 2026-07-13: hold steady at capitulation)
```
if verdict is EXIT WATCH or EXIT SIGNAL:  accel = min(accel, 1.0)
```
Keeps base DCA running through a structural break but never *accelerates* into one. (A future
config could expose the 1.0 cap as a slider — the two rejected options were 1.5× and 2.0×.)

### Per-coin table & deployment timeline
For each `COINS` entry with nonzero `ips.dca[sym]`: weekly amount, % of weekly total,
`suggested = weekly · accel`. Weekly total = Σ entries.
`idle = totalValue − holdings`; `weeksAtBasePace = idle / weeklyTotal`; if `accel != 1`, also
`weeksAtSuggestedPace = idle / (weeklyTotal · accel)`. Timeline hidden if `totalValue`/`holdings` unset.

### UI
New "DCA schedule" card after Position sizing. Editable table (`nin` pattern, `data-group="dca"`,
keyed by symbol) + a plain "why" line, e.g.: *"MVRV cheap + fear → pace ×1.6 this week. You have
room to target (58% vs your 41%). Idle cash clears in ~5 weeks at this pace."* When capped: *"Exit
watch — holding base pace, not accelerating, through the breakdown."*

### Degradation
No `V`/`S` → `accel=1.0` (base pace). No `maxDD`/holdings → no ceiling, no timeline. Empty
`ips.dca` → prompt to set a plan. Any `COINS` subset works.

## Methodology Bar check
1. **Rationale**: MVRV + contrarian-F&G DCA both have published cycle-horizon evidence; applied via
   the exact pillars the engine already validated walk-forward (Phase 5-B). Written before building.
2. **OOS validation**: the *signals* (V, S) are already walk-forward-validated. A backtest of
   "cheapness-paced DCA vs fixed DCA" (realized cost basis / IRR) is a good Tier-2 follow-up
   (extend `buildBacktest` to simulate both), but this is a bounded, capped, never-leverage,
   never-auto-trade execution overlay on validated signals — acceptable to ship without it, flagged.
3. **Redundancy**: none — the *pace* uses V/S (cheapness), the *ceiling* uses the exposure gap;
   they're deliberately different axes, not the same signal twice.
4. **Robustness**: 0.5×–2.0× clamp + the ceiling taper prevent wild swings from small input moves.
5. **Falsifiability**: rests on the same falsifiable claim as MVRV/F&G DCA (cheap+fearful → higher
   forward returns) — adds no new unfalsifiable claim. Explicitly rejects the short-horizon dip-buy
   claim the evidence refutes.

## Tests (extend `test/harness.js`)
`accel` bounds (0.5 floor at V=S=−2, 1.0 neutral, 2.0 cap at V=S=+2); ceiling taper to 0 at/over
target; EXIT verdict caps accel to ≤1.0 even when cheapness wants more (the capitulation case);
per-coin % sums to 100; deployment-timeline arithmetic (base vs suggested pace); degrades with no
V/S, no maxDD, empty dca, no holdings; partial coin subset; no NaN.

## Effort / risk
Low-medium. Derived math from existing pillars, no new data source, no new localStorage key. Main
risk is UI clutter — Policy / Sizing / DCA must stay legible, not become a spreadsheet.
