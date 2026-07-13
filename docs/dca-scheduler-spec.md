# DCA scheduler spec — regime-aware buy pacing

Status: **proposal, not built.** Builds directly on Phase 5-A (`computeSizing`) and Phase 5-C
(`exitmon2:ips`) from [`docs/risk-layer-spec.md`](risk-layer-spec.md) — read that first for the
sizing math this reuses. Nothing here ships until confirmed.

## Why this exists

The user already gets a recommended *total* exposure (Position sizing card) and a pre-committed
policy (IPS). What's missing: they DCA a fixed weekly amount into 5 specific coins, and asked
whether the app can turn "give me your allocation + buy plan" into something useful — informed
by the same regime/exposure signal already computed, without predicting anything new.

The academic hook (from the value-averaging research already cited in `risk-layer-spec.md`):
contributing *more* when underexposed/cheap and *less* when at/over target has real, if
methodology-sensitive, evidence of beating fixed-pace DCA on IRR. This feature automates that
adjustment using signals the engine already produces — it adds no new indicator.

**Explicit boundary:** this schedules buys across the user's *existing* `COINS` list. It does
not, and cannot, judge whether to add a new coin (e.g. "is HYPE a good addition") — that requires
live qualitative research (revenue trends, tokenomics, correlation judgment) outside the
deterministic, keyless, no-AI architecture. That stays a conversation, not a feature.

## Design

### New config: `ips.dca`
A map of coin symbol → weekly $ amount, e.g. `{BTC:20, ETH:20, SOL:20, NEAR:15, LTC:7}`.
Extends `exitmon2:ips` (no new localStorage key) — it's a policy parameter like `maxDD`.
`DEFAULT_IPS.dca = {}`.

### Accumulation tilt — derived from the existing sizing gap, not a new signal
Reuses `computeSizing()`'s output (`wTarget`, `wCur`, `band`) — no new calibration, no new data:

```
gap = wTarget - wCur                          // >0 = underexposed, <0 = at/over target
accel =
  gap <= -band  → 0.5                         // meaningfully over target: ease off
  -band < gap <= band → 1.0                   // within the deadband: normal pace, no change
  gap > band    → 1 + clamp((gap-band)/band, 0, 1)   // meaningfully under: scale up to 2.0×
```

Bounded 0.5×–2.0× so a noisy day never swings the suggested contribution wildly. If `computeSizing()`
returns null (no `maxDD` set), `accel` is null and the card shows plan/%/total only — no pacing
suggestion fabricated from nothing.

### Per-coin table
For each `COINS` entry with a nonzero `ips.dca[sym]`: weekly amount, % of weekly total, and
`suggested = weekly * accel` (only shown when `accel != null`). Weekly total = sum of all entries.

### Idle-cash deployment timeline
Reuses `ips.totalValue`/`ips.holdings` (already collected for Position sizing):
`idle = totalValue - holdings`; `weeksAtCurrentPace = idle / weeklyTotal`; if `accel != null` and
`accel != 1`, also show `weeksAtSuggestedPace = idle / (weeklyTotal * accel)` as a secondary line.
Hidden if `totalValue`/`holdings` unset (same null-handling as Position sizing).

### UI
New "DCA schedule" card, placed after Position sizing (they share the same underlying gap).
Editable table (reuse the `nin` pattern, grouped `data-group="dca"`, keyed by coin symbol) plus
a plain "why" line mirroring Position sizing's tone, e.g.: *"You're 12pts under target exposure
→ pacing ×1.4 this week. Idle cash clears in ~6 weeks at this pace (~4 weeks at today's tilt)."*

### Degradation
- No `maxDD` set → table/%/total render, no accel suggestion, prompt to set policy.
- `ips.dca` empty → prompt to set a plan (same pattern as "no pre-committed plan").
- No `totalValue`/`holdings` → deployment-timeline line hidden.
- Works with any subset of `COINS` (a coin with no `dca` entry simply doesn't appear in the table).

## Methodology Bar check
1. **Rationale**: value-averaging literature (already cited), applied via a signal the engine
   already validated (walk-forward backtest, Phase 5-B) — not a new prediction.
2. **OOS validation**: *not done for v1, flagged honestly.* This is a scheduling/execution
   overlay on an already-validated signal, not a new return-predicting model — a full backtest
   of "accel-paced DCA vs. fixed DCA" is a plausible Tier-2 follow-up (extend `buildBacktest`
   to simulate both schedules and compare realized cost basis / IRR) but isn't required to ship
   a bounded, sanity-capped convenience feature that never leverages or auto-trades.
3. **Redundancy**: zero — derives entirely from `computeSizing`'s existing output, no new indicator.
4. **Robustness**: the 0.5×–2.0× cap exists specifically so small gap changes don't cause wild
   suggestion swings.
5. **Falsifiability**: the underlying claim ("underexposed + favorable regime → higher expected
   value from buying more now") is the same claim Phase 5-A already makes and Phase 5-B already
   validates walk-forward — this feature doesn't add a new unfalsifiable claim on top.

## Tests (extend `test/harness.js`)
`accel` bounds (0.5 floor, 1.0 deadband, 2.0 cap) against synthetic gaps; per-coin % sums to 100;
deployment-timeline arithmetic; degrades cleanly with no `maxDD`, empty `dca`, or no
`totalValue`/`holdings`; works with a partial coin subset; no NaN.

## Effort / risk
Low-medium. Pure derived math, no new data sources, no new localStorage key. Main risk is UI
clutter — the Policy/Sizing/DCA trio needs to stay legible, not turn into a spreadsheet.
