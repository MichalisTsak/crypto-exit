// Watchdog engine loader — reuses the EXACT engine from index.html so the alert
// logic can never drift from what the phone shows. We extract the inline <script>,
// unwrap its outer IIFE at runtime (no edit to index.html), and append a tiny hook
// that exposes `state` and `derive` so we can read the computed verdict as
// structured data instead of scraping rendered HTML.
const fs = require("fs");
const path = require("path");

const INDEX = path.join(__dirname, "..", "index.html");

function hookedScript() {
  const html = fs.readFileSync(INDEX, "utf8");
  const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
  const open = js.indexOf("(function(){");
  const close = js.lastIndexOf("})();");
  if (open === -1 || close === -1 || open >= close)
    throw new Error("watchdog: could not locate index.html IIFE wrapper");
  if (js.slice(0, open).trim() !== "")
    throw new Error("watchdog: unexpected code before IIFE — refusing to unwrap");
  const body = js.slice(open + "(function(){".length, close);
  // `state` and `derive` are top-level in the IIFE body; expose them once the
  // synchronous setup finishes (refresh() keeps mutating the same `state` object).
  return body + "\n;globalThis.__wd = { get state(){ return state; }, derive: derive };";
}

// Boot the engine with the given environment and resolve once the first refresh
// settles (state.updated set, or state.error with nothing cached). env = { fetch?,
// localStorage, document }. Omit `fetch` to use Node's real global fetch (live run).
async function boot(env, opts = {}) {
  const timeoutMs = opts.timeoutMs || 60000;
  delete globalThis.__wd;
  const body = hookedScript();
  const names = [], vals = [];
  if (env.fetch) { names.push("fetch"); vals.push(env.fetch); }
  names.push("localStorage", "document");
  vals.push(env.localStorage, env.document);
  new Function(...names, body)(...vals);

  const wd = globalThis.__wd;
  if (!wd) throw new Error("watchdog: state hook was not installed");
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const s = wd.state;
    if (s.updated || (s.error && !s.loading)) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  await new Promise((r) => setTimeout(r, 150)); // let trailing async settle
  return wd;
}

// File-backed localStorage shim: seed from a plain object, dump back to one.
function makeStore(initial) {
  const m = new Map(Object.entries(initial || {}));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    dump: () => Object.fromEntries(m),
  };
}

// Minimal DOM stub — enough for the engine's single #root render target.
function makeDoc() {
  const root = {
    handlers: {},
    addEventListener(t, f) { this.handlers[t] = f; },
    _html: "",
    set innerHTML(h) { this._html = h; },
    get innerHTML() { return this._html; },
  };
  return { getElementById: () => root };
}

module.exports = { boot, makeStore, makeDoc, hookedScript };