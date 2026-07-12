// Exit Monitor watchdog — boots the real engine against live APIs, compares the
// verdict to the previous run, and pushes a Telegram alert when a rail trips, the
// regime flips, or the exit verdict escalates/eases. Designed to run on a GitHub
// Actions cron so the user is warned WITHOUT opening the dashboard.
//
// Secrets (GitHub Actions env): TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID.
// Cross-run state persists under WATCHDOG_STATE_DIR (an actions/cache directory):
//   store.json    — the engine's localStorage (keeps API caches warm, respects the
//                   bitcoin-data 15 req/day quota, and carries the 48h regime memory)
//   snapshot.json — the last verdict snapshot we compared against
const fs = require("fs");
const path = require("path");
const { boot, makeStore, makeDoc } = require("./engine");
const { decideAlert, buildMessage } = require("./alert");

const STATE_DIR = process.env.WATCHDOG_STATE_DIR || path.join(__dirname, ".state");
const STORE_FILE = path.join(STATE_DIR, "store.json");
const SNAP_FILE = path.join(STATE_DIR, "snapshot.json");
const PAGE_URL = process.env.WATCHDOG_URL || "https://michalistsak.github.io/crypto-exit/";

const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const writeJson = (f, o) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(o)); };

async function sendTelegram(text) {
  const token = process.env.TELEGRAM_BOT_TOKEN, chat = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chat) {
    console.log("watchdog: TELEGRAM_BOT_TOKEN / TELEGRAM_CHAT_ID not set — would have sent:\n" + text);
    return false;
  }
  const res = await fetch("https://api.telegram.org/bot" + token + "/sendMessage", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ chat_id: chat, text, parse_mode: "HTML", disable_web_page_preview: true }),
  });
  if (!res.ok) { console.log("watchdog: Telegram send failed", res.status, await res.text().catch(() => "")); return false; }
  console.log("watchdog: alert sent.");
  return true;
}

function snapshot(state, d) {
  const btcN = (state.quality && state.quality.BTC && state.quality.BTC.n) || 0;
  const lampInfo = {};
  d.tripped.forEach((l) => { lampInfo[l.id] = { label: l.label, severity: l.severity }; });
  return {
    ts: Date.now(),
    offline: !!state.offline,
    btcN,
    price: d.p,
    verdictKey: d.verdict.key,
    verdictTitle: d.verdict.title,
    risk: d.risk,
    regimeKey: d.regime.key,
    regimeName: d.regime.name,
    tripped: d.tripped.map((l) => l.id),
    lampInfo,
  };
}

(async () => {
  // On-demand delivery test (workflow_dispatch with test_ping=true): confirm the
  // Telegram creds work without booting the engine or spending API quota.
  if (process.env.WATCHDOG_TEST_PING === "true") {
    await sendTelegram("✅ <b>Exit Monitor watchdog is online.</b>\nYou'll get a ping here when a rail trips, the regime flips, or the exit verdict changes.\n<a href=\"" + PAGE_URL + "\">Open dashboard →</a>");
    process.exit(0);
  }

  const store = makeStore(readJson(STORE_FILE) || {});
  let wd;
  try {
    wd = await boot({ localStorage: store, document: makeDoc() });
  } catch (e) {
    console.log("watchdog: engine boot failed:", e.message, "— skipping this run.");
    process.exit(0);
  }
  // Persist warmed caches (history/on-chain/regime memory) for the next run regardless.
  writeJson(STORE_FILE, store.dump());

  const s = wd.state;
  if (!s.updated) {
    console.log("watchdog: no usable read this run (" + (s.error || "still loading") + ") — nothing to compare.");
    process.exit(0);
  }

  const cur = snapshot(s, wd.derive());
  const prev = readJson(SNAP_FILE);
  writeJson(SNAP_FILE, cur); // always record for the next run

  const decision = decideAlert(prev, cur);
  console.log("watchdog: " + cur.verdictTitle + " · risk " + cur.risk + " · regime " + cur.regimeName +
    " · sources " + cur.btcN + (cur.offline ? " · OFFLINE" : ""));
  if (!decision.alert) {
    console.log("watchdog: no alert (" + decision.reason + ").");
    process.exit(0);
  }
  await sendTelegram(buildMessage(decision, PAGE_URL));
  process.exit(0);
})();