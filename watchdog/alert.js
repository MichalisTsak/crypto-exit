// Pure alert-decision logic for the watchdog — no I/O, no network, no engine.
// Given the previous run's snapshot and the current one, decide whether a market
// event worth a Telegram push has happened. Kept separate so it can be unit-tested
// exhaustively without booting the engine.

// Verdict severity ladder: EXIT SIGNAL (RED) > EXIT WATCH (ORANGE) > everything
// else (a regime label, or LOW CONFIDENCE). Regime labels and LOWCONF share rank 1;
// moves between them are surfaced via the regime-flip check, not the tier check.
function tierRank(key) {
  if (key === "RED") return 3;
  if (key === "ORANGE") return 2;
  return 1;
}

const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const fmtPrice = (n) => (n == null || !isFinite(n)) ? "—" : Math.round(n).toLocaleString("en-US");

// A snapshot is untrustworthy when the read is offline (stale cache) or fewer than
// two exchanges agreed on price — we never alert on those, in either direction.
const trusted = (s) => !!s && !s.offline && (s.btcN || 0) >= 2;

// prev/cur snapshot shape:
//   { ts, offline, btcN, price, verdictKey, verdictTitle, risk,
//     regimeKey, regimeName, tripped:[id...], lampInfo:{ id:{label,severity} } }
// Returns { alert:boolean, reason?, kind?, header?, lines?[] }.
function decideAlert(prev, cur) {
  if (!trusted(cur)) return { alert: false, reason: "current read not trustworthy (offline or <2 sources)" };
  if (!prev) return { alert: false, reason: "first run — baseline recorded" };
  if (!trusted(prev)) return { alert: false, reason: "prior snapshot not trustworthy — re-baselining" };

  const prevTripped = prev.tripped || [], curTripped = cur.tripped || [];
  const newlyTripped = curTripped.filter((id) => !prevTripped.includes(id));
  const escalated = tierRank(cur.verdictKey) > tierRank(prev.verdictKey);
  // A drop *into* LOW CONFIDENCE is the monitor going blind (degraded coverage), not
  // a genuine easing of risk — never frame it as a "✅ all clear" stand-down.
  const eased = tierRank(prev.verdictKey) >= 2 && tierRank(cur.verdictKey) < tierRank(prev.verdictKey)
    && cur.verdictKey !== "LOWCONF";
  const regimeFlipped = cur.regimeKey !== prev.regimeKey;

  if (!escalated && !eased && !regimeFlipped && newlyTripped.length === 0)
    return { alert: false, reason: "no alert-worthy change" };

  const anyDanger = newlyTripped.some((id) => cur.lampInfo && cur.lampInfo[id] && cur.lampInfo[id].severity === "danger");
  const kind = (escalated || anyDanger) ? "warn" : eased ? "standdown" : regimeFlipped ? "regime" : "warn";

  const header =
    kind === "standdown" ? "✅ Exit Monitor — eased to " + esc(cur.verdictTitle) :
    kind === "regime" ? "🔄 Exit Monitor — regime flip" :
    "⚠️ Exit Monitor — " + esc(cur.verdictTitle);

  const lines = ["BTC $" + fmtPrice(cur.price) + " · risk " + cur.risk + "/100"];
  if (escalated) lines.push("Verdict escalated: " + esc(prev.verdictTitle) + " → <b>" + esc(cur.verdictTitle) + "</b>");
  else if (eased) lines.push("Verdict eased: " + esc(prev.verdictTitle) + " → <b>" + esc(cur.verdictTitle) + "</b>");
  if (newlyTripped.length)
    lines.push("New rail" + (newlyTripped.length > 1 ? "s" : "") + ": " +
      newlyTripped.map((id) => esc((cur.lampInfo && cur.lampInfo[id] && cur.lampInfo[id].label) || id)).join("; "));
  if (regimeFlipped) lines.push("Regime: " + esc(prev.regimeName) + " → <b>" + esc(cur.regimeName) + "</b>");

  return { alert: true, kind, header, lines };
}

function buildMessage(decision, pageUrl) {
  const foot = pageUrl ? "\n<a href=\"" + esc(pageUrl) + "\">Open dashboard →</a>" : "";
  return [decision.header, ...decision.lines].join("\n") + foot;
}

// Whether to advance the stored baseline snapshot to the current read. Never advance
// on an untrusted read (would discard the last good baseline), and never advance past
// an alert we failed to deliver — leave the old baseline so the next run re-detects the
// transition and retries the send (at-least-once alerting).
function commitBaseline(curTrusted, alerted, sent) {
  if (!curTrusted) return false;
  if (alerted && !sent) return false;
  return true;
}

module.exports = { decideAlert, buildMessage, commitBaseline, tierRank, trusted, esc, fmtPrice };