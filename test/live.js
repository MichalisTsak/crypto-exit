// Live smoke test — boots the real script against the REAL APIs (~16 requests,
// spends bitcoin-data.com daily quota: use sparingly).
const fs = require("fs");
const html = fs.readFileSync("/home/captain-mike/Documents/crypto exit/index.html", "utf8");
const js = html.match(/<script>([\s\S]*)<\/script>/)[1];
const store = new Map();
const ls = { getItem:k=>store.has(k)?store.get(k):null, setItem:(k,v)=>store.set(k,String(v)), removeItem:k=>store.delete(k) };
let capHtml = "";
const handlers = {};
const root = { addEventListener(t,f){handlers[t]=f;}, set innerHTML(h){capHtml=h;}, get innerHTML(){return capHtml;} };
const doc = { getElementById:()=>root };
new Function("localStorage","document", js)(ls, doc);   // real global fetch
(async()=>{
  for(let i=0;i<240;i++){ if(capHtml.includes("median of")) break; await new Promise(r=>setTimeout(r,500)); }
  await new Promise(r=>setTimeout(r,500));
  const hist = JSON.parse(store.get("exitmon2:histv2")||"null");
  const oc = JSON.parse(store.get("exitmon2:onchain")||"null");
  const fngH = JSON.parse(store.get("exitmon2:fnghist")||"null");
  const zH = JSON.parse(store.get("exitmon2:mvrvhist")||"null");
  const grab = (re)=>{ const m=capHtml.match(re); return m?m[0].replace(/<[^>]+>/g," ").replace(/\s+/g," ").trim():"(not found)"; };
  console.log("history days:", hist?hist.days.length:0, "| first:", hist?new Date(hist.days[0][0]).toISOString().slice(0,10):"-", "| last:", hist?new Date(hist.days[hist.days.length-1][0]).toISOString().slice(0,10):"-");
  console.log("on-chain:", oc ? `MVRV Z ${oc.mvrvZ} NUPL ${oc.nupl} Puell ${oc.puell} (${oc.d})` : "none");
  console.log("series: F&G", fngH?Object.keys(fngH.map).length+"d":"none", "| MVRV", zH?Object.keys(zH.map).length+"d":"none");
  console.log("verdict:", grab(/<div class="big"[^>]*>[^<]+<\/div>/));
  console.log("read:", grab(/read [^<]+/));
  console.log("trend note:", grab(/[+\-−]?\d+\.\d% (above|below) 200D MA[^<]*/));
  console.log("momentum note:", grab(/weekly RSI [^<]*/));
  console.log("valuation note:", grab(/on-chain: MVRV[^<]*|proxy[^<]*/));
  const wires = [...capHtml.matchAll(/<div class="tag" style="margin-top:3px">([^<]+)<\/div>/g)].map(m=>m[1]);
  console.log("tripwires:"); wires.forEach(w=>console.log("  ", w.replace(/&lt;/g,"<").replace(/&gt;/g,">").replace(/&amp;/g,"&")));
  // open the track-record panel and print the real backtest
  handlers.click({ target: { closest: () => ({ dataset: { action: "evidence" } }) } });
  const bands = [...capHtml.matchAll(/<span style="font-size:12px[^>]*>([^<]+)<\/span><span class="tag">(N=\d+)<\/span><\/div>(?:<div class="mono"[^>]*>([^<]+)<\/div>)?/g)];
  console.log("track record:");
  bands.forEach(b=>console.log("  ", (b[1]+" "+b[2]+"  "+(b[3]||"")).replace(/&lt;/g,"<").replace(/&gt;/g,">")));
  console.log("caveat:", capHtml.includes("evidence, not prophecy") ? "shown" : "MISSING");
  console.log("NaN check:", capHtml.includes("NaN")?"FAIL":"clean");
  process.exit(0);
})();