// End-to-end harness for index.html — mocks all network + storage, boots the real script.
// The mocked environment (synthetic series, fetch/storage/DOM) lives in ./env.js so the
// watchdog test can reuse the exact same mocks.
const { js, DAY, makeEnv, clickAction } = require("./env");

async function boot(store, opts) {
  const env = makeEnv(store, opts);
  new Function("fetch", "localStorage", "document", js)(env.fetchMock, env.localStorageMock, env.documentMock);
  for (let i = 0; i < 100; i++) {
    if (env.cap.html.includes("median of") || env.cap.html.includes("unreachable right now")) break;
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

  // G — Phase 3: true offline (every request fails) but a prior session's caches exist
  console.log("\n[G] true offline, prior session cached (storeA)");
  const g = await boot(storeA, { failAll: true });
  check("offline banner shown with cached timestamp", g.cap.html.includes("Offline") && g.cap.html.includes("cached read from"));
  check("no blocking error bar", !g.cap.html.includes("All price sources are unreachable"));
  check("still renders full verdict from cache", /read [+\-−0]/.test(g.cap.html) && !g.cap.html.includes("NaN"));
  check("history still shown from cache", g.cap.html.includes("history cached") || g.cap.html.includes("history stale"));
  check("tripwires still present offline", g.cap.html.includes("Tripwires"));
  const lgG = JSON.parse(storeA.get("exitmon2:lastgood") || "null");
  check("lastgood snapshot exists (from a prior success)", !!(lgG && lgG.coins && lgG.coins.BTC && lgG.coins.BTC.price != null));

  // H — true offline, fresh install, nothing cached yet: must fail honestly, not fabricate
  console.log("\n[H] true offline, fresh install (no cache at all)");
  const hh = await boot(new Map(), { failAll: true });
  check("honest error, not a fabricated dashboard", hh.cap.html.includes("All price sources are unreachable"));
  check("no NaN in error state", !hh.cap.html.includes("NaN"));

  // I — Phase 5-C: investment policy (IPS) persists + repeats back in the verdict
  console.log("\n[I] investment policy (IPS)");
  const i0 = await boot(new Map());
  check("no-policy prompt shown when unset", i0.cap.html.includes("No pre-committed plan") && i0.cap.html.includes("decide it while calm"));
  const storeI = new Map();
  const i1 = await boot(storeI);
  clickAction(i1, "policy"); // open the editor (real flow: inputs only exist when expanded)
  const typeIps = (k, v) => i1.root.handlers.input({ target: { dataset: { group: "ips", k }, value: String(v) } });
  typeIps("objective", "Long-term BTC conviction");
  typeIps("plan", "Sell in 4 weekly tranches of 25%; keep the BTC core.");
  typeIps("maxDD", "35");
  clickAction(i1, "save-policy");
  const savedIps = JSON.parse(storeI.get("exitmon2:ips") || "null");
  check("policy persisted to exitmon2:ips", !!(savedIps && savedIps.plan && savedIps.plan.includes("4 weekly tranches") && savedIps.maxDD === 35 && savedIps.reviewedOn));
  check("typing did not touch cfg keys", !storeI.has("exitmon2:cfg") || !(JSON.parse(storeI.get("exitmon2:cfg")).ips));
  check("save confirmation shown", i1.cap.html.includes("Policy saved"));
  const i2 = await boot(storeI);
  check("saved plan repeated back in verdict", i2.cap.html.includes("Your plan") && i2.cap.html.includes("Sell in 4 weekly tranches"));
  check("objective shown alongside plan", i2.cap.html.includes("Long-term BTC conviction"));
  check("no-policy prompt gone once set", !i2.cap.html.includes("No pre-committed plan"));
  check("policy survives a fresh boot (own key, never wiped)", JSON.parse(storeI.get("exitmon2:ips") || "null").plan.includes("4 weekly"));
  check("no NaN with policy set", !i2.cap.html.includes("NaN"));

  // J — Phase 5-A: volatility-targeted position sizing
  console.log("\n[J] position sizing (vol-targeted)");
  const storeJ = new Map();
  const j1 = await boot(storeJ);
  clickAction(j1, "policy");
  const typeJ = (k, v) => j1.root.handlers.input({ target: { dataset: { group: "ips", k }, value: String(v) } });
  typeJ("maxDD", "1"); typeJ("totalValue", "1000"); typeJ("holdings", "1000"); // very tight budget, fully invested
  clickAction(j1, "save-policy");
  const j2 = await boot(storeJ);
  const mExp = j2.cap.html.match(/Recommended exposure<\/span><span class="big-num">(\d{1,3})%/);
  check("position card renders a recommended exposure %", !!mExp);
  check("tight drawdown budget caps exposure below 100% (no leverage)", !!mExp && +mExp[1] < 100);
  check("recommends trimming when over target", j2.cap.html.includes("Trim ~"));
  check("trade shown with a currency amount + staged", /Trim ~\d+%<\/b> \([€$]/.test(j2.cap.html) && j2.cap.html.includes("weekly"));
  check("why-line explains vol cap + drawdown budget", j2.cap.html.includes("vol cap") && j2.cap.html.includes("drawdown budget ≤1%"));
  check("no NaN in sizing", !j2.cap.html.includes("NaN"));
  // loose budget + underinvested → add
  const storeK = new Map();
  const k1 = await boot(storeK);
  clickAction(k1, "policy");
  const typeK = (k, v) => k1.root.handlers.input({ target: { dataset: { group: "ips", k }, value: String(v) } });
  typeK("maxDD", "90"); typeK("totalValue", "1000"); typeK("holdings", "100"); // loose budget, underinvested
  clickAction(k1, "save-policy");
  const k2 = await boot(storeK);
  check("recommends adding when under target", k2.cap.html.includes("Add ~"));
  // sizing hidden until a drawdown budget exists (empty maxDD)
  const storeL = new Map();
  const l1 = await boot(storeL);
  clickAction(l1, "policy");
  l1.root.handlers.input({ target: { dataset: { group: "ips", k: "maxDD" }, value: "" } });
  clickAction(l1, "save-policy");
  const l2 = await boot(storeL);
  check("no budget → sizing prompts instead of guessing", l2.cap.html.includes("max-drawdown tolerance") && !/Recommended exposure<\/span>/.test(l2.cap.html));

  console.log("\n" + pass + " passed, " + failCount + " failed");
  process.exit(failCount ? 1 : 0);
})();
