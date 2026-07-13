// Watchdog tests — the pure alert-decision logic (exhaustive) plus one integration
// boot proving the real derive() still exposes the fields check.js reads (guards
// against renames in index.html). Fully offline; never touches Telegram or the net.
const { makeEnv } = require("./env");
const { boot } = require("../watchdog/engine");
const { decideAlert, buildMessage, tierRank, commitBaseline } = require("../watchdog/alert");

let pass = 0, failCount = 0;
const check = (name, cond) => { if (cond) { pass++; console.log("  ok  " + name); } else { failCount++; console.log("  FAIL " + name); } };

const base = (o = {}) => Object.assign({
  offline: false, btcN: 4, price: 60000,
  verdictKey: "BEAR", verdictTitle: "BEAR", risk: 15,
  regimeKey: "BEAR", regimeName: "Bear", tripped: [], lampInfo: {},
}, o);

(async () => {
  // ---- pure decision logic ----
  console.log("[alert] decision logic");
  check("tier ranks EXIT SIGNAL > EXIT WATCH > regime", tierRank("RED") > tierRank("ORANGE") && tierRank("ORANGE") > tierRank("BEAR"));

  check("first run never alerts", decideAlert(null, base()).alert === false);
  check("offline current read never alerts", decideAlert(base(), base({ offline: true })).alert === false);
  check("under 2 sources never alerts", decideAlert(base(), base({ btcN: 1 })).alert === false);
  check("untrusted prior re-baselines silently", decideAlert(base({ btcN: 1 }), base()).alert === false);
  check("calm → calm is quiet", decideAlert(base(), base()).alert === false);

  const esc = decideAlert(base(), base({ verdictKey: "ORANGE", verdictTitle: "EXIT WATCH", risk: 45 }));
  check("escalation to EXIT WATCH alerts (warn)", esc.alert && esc.kind === "warn" && esc.header.includes("EXIT WATCH"));
  check("escalation names the transition", esc.lines.some((l) => l.includes("escalated")));

  const esc2 = decideAlert(base({ verdictKey: "ORANGE", verdictTitle: "EXIT WATCH" }), base({ verdictKey: "RED", verdictTitle: "EXIT SIGNAL", risk: 80 }));
  check("EXIT WATCH → EXIT SIGNAL alerts", esc2.alert && esc2.header.includes("EXIT SIGNAL"));

  const eased = decideAlert(base({ verdictKey: "RED", verdictTitle: "EXIT SIGNAL", risk: 80 }), base());
  check("de-escalation sends a stand-down", eased.alert && eased.kind === "standdown" && eased.header.toLowerCase().includes("eased"));

  const flip = decideAlert(base(), base({ verdictKey: "BULL", verdictTitle: "BULL", regimeKey: "BULL", regimeName: "Bull" }));
  check("confirmed regime flip alerts (regime)", flip.alert && flip.kind === "regime" && flip.lines.some((l) => l.includes("Bear") && l.includes("Bull")));

  const trip = decideAlert(base(), base({ tripped: ["structural"], lampInfo: { structural: { label: "BTC below $52,000", severity: "danger" } } }));
  check("new danger rail alerts even if verdict tier unchanged", trip.alert && trip.kind === "warn" && trip.lines.some((l) => l.includes("New rail") && l.includes("$52,000")));

  const cleared = decideAlert(base({ tripped: ["trend"], lampInfo: { trend: { label: "x", severity: "warn" } } }), base({ tripped: [] }));
  check("clearing a lamp alone is quiet", cleared.alert === false);

  // #3: dropping into LOW CONFIDENCE is a visibility loss, not a stand-down
  const lowconf = decideAlert(base({ verdictKey: "ORANGE", verdictTitle: "EXIT WATCH" }), base({ verdictKey: "LOWCONF", verdictTitle: "LOW CONFIDENCE" }));
  check("ease into LOW CONFIDENCE sends no false all-clear", lowconf.alert === false);
  const realEase = decideAlert(base({ verdictKey: "ORANGE", verdictTitle: "EXIT WATCH" }), base());
  check("a genuine ease to a regime still stands down", realEase.alert && realEase.kind === "standdown");

  // #1: baseline must not advance past an undelivered alert or an untrusted read
  check("commit after a clean no-alert read", commitBaseline(true, false, false) === true);
  check("hold baseline on untrusted read", commitBaseline(false, false, false) === false);
  check("commit after an alert that sent", commitBaseline(true, true, true) === true);
  check("hold baseline when the alert failed to send", commitBaseline(true, true, false) === false);

  const msg = buildMessage(esc, "https://michalistsak.github.io/crypto-exit/");
  check("message renders header + link", msg.includes("EXIT WATCH") && msg.includes("Open dashboard") && msg.includes("crypto-exit"));
  check("message has no NaN/undefined", !/NaN|undefined/.test(msg));

  // ---- integration: real engine derive() field contract ----
  console.log("\n[contract] real derive() exposes what check.js reads");
  const store = new Map();
  const env = makeEnv(store);
  const wd = await boot({ fetch: env.fetchMock, localStorage: env.localStorageMock, document: env.documentMock });
  const s = wd.state;
  check("engine booted with a fresh read", !!s.updated);
  const d = wd.derive();
  check("verdict.key / .title present", typeof d.verdict.key === "string" && typeof d.verdict.title === "string");
  check("risk is numeric", typeof d.risk === "number" && isFinite(d.risk));
  check("regime.key / .name present", typeof d.regime.key === "string" && typeof d.regime.name === "string");
  check("tripped is an array of {id,label,severity}", Array.isArray(d.tripped) && d.tripped.every((l) => l.id && l.label && l.severity));
  check("btc price readable via d.p", typeof d.p === "number" && d.p > 0);
  const btcN = (s.quality && s.quality.BTC && s.quality.BTC.n) || 0;
  check("source count readable (n=" + btcN + ")", btcN >= 2);
  check("decideAlert runs on a real snapshot", (() => {
    const lampInfo = {}; d.tripped.forEach((l) => lampInfo[l.id] = { label: l.label, severity: l.severity });
    const snap = { offline: !!s.offline, btcN, price: d.p, verdictKey: d.verdict.key, verdictTitle: d.verdict.title, risk: d.risk, regimeKey: d.regime.key, regimeName: d.regime.name, tripped: d.tripped.map((l) => l.id), lampInfo };
    return decideAlert(null, snap).alert === false; // first run vs real read → quiet, no throw
  })());

  console.log("\n" + pass + " passed, " + failCount + " failed");
  process.exit(failCount ? 1 : 0);
})();