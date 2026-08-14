import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import {
  Plus, X, Pencil, Trash2, Download, Upload, Settings2,
  BookOpen, LayoutGrid, Table2, LineChart, Image as ImageIcon, Check,
} from "lucide-react";

/* ------------------------------------------------------------------ */
/*  CONSTANTS                                                          */
/* ------------------------------------------------------------------ */

const PATTERNS = [
  "VCP", "Cup & Handle", "Flat Base", "Double Bottom",
  "High Tight Flag", "Ascending Base", "Power Play",
  "Pullback Entry", "Other",
];

const EXIT_REASONS = [
  "Stop hit", "Trailing stop", "Sold into strength", "Target reached",
  "Time stop", "Broke support", "Market conditions", "Discretionary",
];

const MISTAKES = [
  "Chased extended", "No volume confirmation", "Ignored the stop",
  "Oversized", "Undersized", "Averaged down", "Sold too early",
  "Traded against market trend", "Not a real base", "Revenge trade",
];

const EMOTIONS = [
  "Calm", "Confident", "Patient", "Detached",
  "FOMO", "Hesitant", "Impatient", "Anxious", "Frustrated", "Euphoric",
];

const MARKETS = [
  { id: "NSE", label: "NSE", ccy: "INR" },
  { id: "BSE", label: "BSE", ccy: "INR" },
  { id: "US", label: "US", ccy: "USD" },
];

const STAGES = [
  { v: 1, label: "1 — Basing" },
  { v: 2, label: "2 — Advancing" },
  { v: 3, label: "3 — Topping" },
  { v: 4, label: "4 — Declining" },
];

const K = {
  trades: "journal:trades",
  diary: "journal:diary",
  settings: "journal:settings",
  img: (id) => `journal:img:${id}`,
};

const DEFAULT_SETTINGS = {
  name: "Breakout Ledger",
  accountINR: 1000000,
  accountUSD: 10000,
  defaultRiskPct: 0.75,
};

/* ------------------------------------------------------------------ */
/*  HELPERS                                                            */
/* ------------------------------------------------------------------ */

const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const num = (v) => (v === "" || v === null || v === undefined ? NaN : Number(v));
const ccyOf = (market) => (market === "US" ? "USD" : "INR");

function money(v, ccy) {
  if (!isFinite(v)) return "—";
  const loc = ccy === "USD" ? "en-US" : "en-IN";
  return new Intl.NumberFormat(loc, {
    style: "currency", currency: ccy, maximumFractionDigits: 0,
  }).format(v);
}

function rfmt(v, dp = 2) {
  if (!isFinite(v)) return "—";
  return `${v >= 0 ? "+" : ""}${v.toFixed(dp)}R`;
}

function pct(v, dp = 1) {
  if (!isFinite(v)) return "—";
  return `${v.toFixed(dp)}%`;
}

/** All derived numbers for a trade. R-multiples are currency-agnostic — this
 *  is what lets NSE and US trades sit in one performance table. */
function derive(t, settings) {
  const entry = num(t.entryPrice);
  const stop = num(t.stopLoss);
  const qty = num(t.quantity);
  const exit = num(t.exitPrice);
  const pivot = num(t.pivotPrice);
  const dir = t.side === "short" ? -1 : 1;
  const ccy = ccyOf(t.market);

  const riskPerShare = Math.abs(entry - stop);
  const riskAmt = riskPerShare * qty;              // 1R in currency
  const account = ccy === "USD" ? num(settings.accountUSD) : num(settings.accountINR);
  const riskPct = isFinite(riskAmt) && account > 0 ? (riskAmt / account) * 100 : NaN;
  const exposure = entry * qty;
  const exposurePct = isFinite(exposure) && account > 0 ? (exposure / account) * 100 : NaN;

  const distPivot = isFinite(pivot) && pivot > 0 ? ((entry - pivot) / pivot) * 100 * dir : NaN;

  let pnl = NaN, r = NaN, heldDays = NaN;
  if (t.status === "closed" && isFinite(exit)) {
    pnl = (exit - entry) * qty * dir;
    r = riskAmt > 0 ? pnl / riskAmt : NaN;
    if (t.entryDate && t.exitDate) {
      heldDays = Math.round(
        (new Date(t.exitDate) - new Date(t.entryDate)) / 86400000
      );
    }
  }
  return { ccy, riskPerShare, riskAmt, riskPct, exposure, exposurePct, distPivot, pnl, r, heldDays, account };
}

function stats(rows) {
  const rs = rows.map((x) => x.r).filter((x) => isFinite(x));
  const n = rs.length;
  if (!n) return { n: 0 };
  const wins = rs.filter((x) => x > 0);
  const losses = rs.filter((x) => x <= 0);
  const sum = rs.reduce((a, b) => a + b, 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const avgWin = wins.length ? grossWin / wins.length : 0;
  const avgLoss = losses.length ? grossLoss / losses.length : 0;

  // Max drawdown measured on the cumulative-R curve
  let cum = 0, peak = 0, maxDD = 0;
  for (const x of rs) {
    cum += x;
    peak = Math.max(peak, cum);
    maxDD = Math.max(maxDD, peak - cum);
  }
  // Streaks
  let curW = 0, curL = 0, bestW = 0, worstL = 0;
  for (const x of rs) {
    if (x > 0) { curW++; curL = 0; bestW = Math.max(bestW, curW); }
    else { curL++; curW = 0; worstL = Math.max(worstL, curL); }
  }

  return {
    n,
    winRate: (wins.length / n) * 100,
    expectancy: sum / n,
    totalR: sum,
    avgWin, avgLoss,
    payoff: avgLoss > 0 ? avgWin / avgLoss : Infinity,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : Infinity,
    maxDD, bestW, worstL,
    best: Math.max(...rs), worst: Math.min(...rs),
  };
}

function band(v, edges, labels) {
  if (!isFinite(v)) return "Not recorded";
  for (let i = 0; i < edges.length; i++) if (v < edges[i]) return labels[i];
  return labels[labels.length - 1];
}

/* Volume used to be logged as a multiple of average (2.4). It is now a
   percentage (240). A value under 20 can only be the old format — nobody
   records a breakout at 20% of average volume. Converted once, on load. */
function migrateVolume(list) {
  return list.map((t) => {
    const v = num(t.volVsAvg);
    return isFinite(v) && v > 0 && v < 20
      ? { ...t, volVsAvg: String(Math.round(v * 100)) }
      : t;
  });
}

/* ------------------------------------------------------------------ */
/*  STORAGE                                                            */
/* ------------------------------------------------------------------ */

const mem = new Map();
const hasStore = () => typeof window !== "undefined" && !!window.storage;

async function sGet(key, fallback) {
  if (!hasStore()) return mem.has(key) ? mem.get(key) : fallback;
  try {
    const res = await window.storage.get(key, false);
    return res ? JSON.parse(res.value) : fallback;
  } catch { return fallback; }
}
async function sSet(key, value) {
  if (!hasStore()) { mem.set(key, value); return true; }
  try { await window.storage.set(key, JSON.stringify(value), false); return true; }
  catch { return false; }
}
async function sDel(key) {
  if (!hasStore()) { mem.delete(key); return; }
  try { await window.storage.delete(key, false); } catch { /* already gone */ }
}

/* Downscale a chart screenshot so it fits comfortably in storage. */
function fileToCompressed(file, maxW = 1400, quality = 0.72) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new window.Image();
      img.onload = () => {
        const scale = Math.min(1, maxW / img.width);
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * scale);
        c.height = Math.round(img.height * scale);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/jpeg", quality));
      };
      img.onerror = () => reject(new Error("That file could not be read as an image."));
      img.src = reader.result;
    };
    reader.onerror = () => reject(new Error("That file could not be read."));
    reader.readAsDataURL(file);
  });
}

/* ------------------------------------------------------------------ */
/*  STYLES                                                             */
/* ------------------------------------------------------------------ */

const CSS = `
@import url('https://fonts.googleapis.com/css2?family=Archivo:wdth,wght@62..125,400..700&family=Spline+Sans+Mono:wght@400;500;600&display=swap');

.bl { --paper:#EDF0EE; --card:#FBFCFB; --grid:#CFD8D4; --rule:#DCE3E0;
      --ink:#131C1A; --ink2:#4A5A56; --ink3:#7C8B87;
      --long:#0F7A63; --short:#A83E27; --brass:#B8862F;
      background:var(--paper); color:var(--ink); min-height:100vh;
      font-family:'Archivo',ui-sans-serif,system-ui,sans-serif; font-size:14px; line-height:1.5; }
.bl *,.bl *::before,.bl *::after { box-sizing:border-box; }
.bl button { font-family:inherit; cursor:pointer; }
.bl :focus-visible { outline:2px solid var(--brass); outline-offset:2px; }

.mono { font-family:'Spline Sans Mono',ui-monospace,SFMono-Regular,monospace;
        font-variant-numeric:tabular-nums; letter-spacing:-0.01em; }
.disp { font-family:'Archivo',sans-serif; font-stretch:125%; font-weight:600;
        letter-spacing:0.02em; }
.eyebrow { font-family:'Archivo',sans-serif; font-stretch:125%; font-weight:600;
           font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:var(--ink3); }

.wrap { max-width:1180px; margin:0 auto; padding:0 20px 72px; }
.topbar { border-bottom:1px solid var(--rule); background:var(--paper);
          position:sticky; top:0; z-index:20; }
.topin { max-width:1180px; margin:0 auto; padding:16px 20px 0;
         display:flex; align-items:flex-start; justify-content:space-between; gap:16px; flex-wrap:wrap; }
.brand { display:flex; align-items:baseline; gap:10px; }
.brand h1 { margin:0; font-size:19px; }
.tabs { display:flex; gap:2px; margin-top:14px; flex-wrap:wrap; }
.tab { background:none; border:0; padding:9px 14px; font-size:12px; font-weight:600;
       letter-spacing:0.1em; text-transform:uppercase; color:var(--ink3);
       border-bottom:2px solid transparent; display:flex; align-items:center; gap:7px; }
.tab:hover { color:var(--ink2); }
.tab[data-on="1"] { color:var(--ink); border-bottom-color:var(--brass); }

.card { background:var(--card); border:1px solid var(--rule); border-radius:3px; }
.pad { padding:18px 20px; }
.sec { margin-top:26px; }
.sechead { display:flex; align-items:baseline; justify-content:space-between; gap:12px;
           margin-bottom:10px; flex-wrap:wrap; }

.grid4 { display:grid; grid-template-columns:repeat(4,1fr); gap:10px; }
.grid3 { display:grid; grid-template-columns:repeat(3,1fr); gap:10px; }
.grid2 { display:grid; grid-template-columns:repeat(2,1fr); gap:16px; }
@media(max-width:820px){ .grid4{grid-template-columns:repeat(2,1fr);} .grid3{grid-template-columns:repeat(2,1fr);} .grid2{grid-template-columns:1fr;} }
@media(max-width:460px){ .grid4{grid-template-columns:1fr;} }

.tile { background:var(--card); border:1px solid var(--rule); border-radius:3px; padding:14px 16px; }
.tile .v { font-size:27px; font-weight:500; margin-top:5px; line-height:1.1; }
.tile .sub { font-size:11px; color:var(--ink3); margin-top:4px; }

.btn { border:1px solid var(--ink); background:var(--ink); color:var(--paper);
       padding:8px 14px; border-radius:2px; font-size:12px; font-weight:600;
       letter-spacing:0.06em; text-transform:uppercase; display:inline-flex;
       align-items:center; gap:7px; }
.btn:hover { background:#000; }
.btn.ghost { background:transparent; color:var(--ink2); border-color:var(--rule); }
.btn.ghost:hover { border-color:var(--ink2); color:var(--ink); background:transparent; }
.btn.sm { padding:5px 10px; font-size:11px; }
.btn.danger { background:transparent; color:var(--short); border-color:var(--rule); }
.btn.danger:hover { border-color:var(--short); background:transparent; }

.seg { display:inline-flex; border:1px solid var(--rule); border-radius:2px; overflow:hidden;
       background:var(--card); flex-wrap:wrap; }
.seg button { border:0; background:transparent; padding:7px 12px; font-size:11px; font-weight:600;
              letter-spacing:0.07em; text-transform:uppercase; color:var(--ink3);
              border-right:1px solid var(--rule); }
.seg button:last-child { border-right:0; }
.seg button[data-on="1"] { background:var(--ink); color:var(--paper); }

label.f { display:block; }
label.f > span { display:block; font-size:10px; font-weight:600; letter-spacing:0.12em;
                 text-transform:uppercase; color:var(--ink3); margin-bottom:5px; }
.in { width:100%; padding:8px 10px; border:1px solid var(--rule); border-radius:2px;
      background:#fff; color:var(--ink); font-size:14px; font-family:'Spline Sans Mono',monospace;
      font-variant-numeric:tabular-nums; }
.in:focus { border-color:var(--brass); outline:none; }
textarea.in { font-family:'Archivo',sans-serif; line-height:1.6; resize:vertical; }
select.in { font-family:'Archivo',sans-serif; }

.chips { display:flex; flex-wrap:wrap; gap:6px; }
.chip { border:1px solid var(--rule); background:var(--card); color:var(--ink2);
        padding:5px 10px; border-radius:999px; font-size:11px; font-weight:500; }
.chip[data-on="1"] { background:var(--ink); color:var(--paper); border-color:var(--ink); }
.chip.rd[data-on="1"] { background:var(--short); border-color:var(--short); }

table.t { width:100%; border-collapse:collapse; font-size:13px; }
table.t th { text-align:left; font-size:10px; font-weight:600; letter-spacing:0.11em;
             text-transform:uppercase; color:var(--ink3); padding:9px 10px;
             border-bottom:1px solid var(--rule); white-space:nowrap; }
table.t td { padding:9px 10px; border-bottom:1px solid var(--rule); white-space:nowrap; }
table.t tr:last-child td { border-bottom:0; }
table.t tbody tr:hover { background:#F3F6F4; }
.num { text-align:right; font-family:'Spline Sans Mono',monospace; font-variant-numeric:tabular-nums; }
.pos { color:var(--long); } .neg { color:var(--short); }
.scroll { overflow-x:auto; }

.modal { position:fixed; inset:0; background:rgba(19,28,26,0.45); z-index:60;
         display:flex; align-items:flex-start; justify-content:center;
         padding:28px 16px; overflow-y:auto; }
.sheet { background:var(--paper); border:1px solid var(--rule); border-radius:3px;
         width:100%; max-width:760px; }
.sheethead { display:flex; align-items:center; justify-content:space-between;
             padding:16px 20px; border-bottom:1px solid var(--rule); position:sticky; top:0;
             background:var(--paper); border-radius:3px 3px 0 0; }
.x { background:none; border:0; color:var(--ink3); padding:4px; display:flex; }
.x:hover { color:var(--ink); }

.readout { border:1px solid var(--rule); border-left:2px solid var(--brass);
           background:#F5F8F6; padding:12px 14px; border-radius:2px; }
.readout .row { display:flex; justify-content:space-between; gap:14px; font-size:12px; padding:3px 0; }
.readout .row b { font-family:'Spline Sans Mono',monospace; font-weight:500; }

.empty { text-align:center; padding:56px 20px; color:var(--ink3); }
.empty p { max-width:390px; margin:8px auto 18px; font-size:13px; }

.entry { border:1px solid var(--rule); background:var(--card); border-radius:3px;
         padding:16px 18px; margin-bottom:10px; }
.entry .body { white-space:pre-wrap; font-size:14px; line-height:1.65; margin:10px 0 0; }
.entry img { max-width:100%; border:1px solid var(--rule); border-radius:2px; margin-top:12px; display:block; }

.warn { border:1px solid var(--brass); background:#FBF6EA; color:#6B4E12;
        padding:9px 12px; border-radius:2px; font-size:12px; }
.hint { font-size:11px; color:var(--ink3); margin-top:5px; }
`;

/* ------------------------------------------------------------------ */
/*  SIGNATURE PLOT — cumulative R above, per-trade R bars below        */
/* ------------------------------------------------------------------ */

function LedgerPlot({ rows }) {
  const box = useRef(null);
  const [w, setW] = useState(900);
  const [hov, setHov] = useState(null);

  useEffect(() => {
    const on = () => box.current && setW(box.current.clientWidth);
    on();
    window.addEventListener("resize", on);
    return () => window.removeEventListener("resize", on);
  }, []);

  const H = 300, PL = 46, PR = 14, PT = 16, GAP = 16;
  const curveH = 168, barsH = 74;
  const innerW = Math.max(120, w - PL - PR);

  const pts = useMemo(() => {
    let cum = 0;
    return rows.map((t, i) => { cum += t.r; return { ...t, i, cum }; });
  }, [rows]);

  if (!pts.length) {
    return (
      <div ref={box} className="card pad empty" style={{ minHeight: 220 }}>
        <div className="eyebrow">The plot</div>
        <p>Once you close your first trade, its R-multiple lands here — the running
          curve on top, every individual outcome as a bar below it.</p>
      </div>
    );
  }

  const cums = pts.map((p) => p.cum);
  const cMax = Math.max(0, ...cums), cMin = Math.min(0, ...cums);
  const cPad = Math.max(1, (cMax - cMin) * 0.12);
  const yTop = cMax + cPad, yBot = cMin - cPad;
  const cy = (v) => PT + curveH - ((v - yBot) / (yTop - yBot)) * curveH;

  const rAbs = Math.max(1, ...pts.map((p) => Math.abs(p.r)));
  const barsTop = PT + curveH + GAP;
  const zeroY = barsTop + barsH / 2;
  const by = (v) => zeroY - (v / rAbs) * (barsH / 2);

  const step = innerW / Math.max(1, pts.length - (pts.length > 1 ? 1 : 0));
  const x = (i) => PL + (pts.length === 1 ? innerW / 2 : i * step);
  const bw = Math.max(1.5, Math.min(14, (innerW / pts.length) * 0.62));

  const line = pts.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${cy(p.cum).toFixed(1)}`).join(" ");
  const area = `${line} L${x(pts.length - 1).toFixed(1)},${cy(0).toFixed(1)} L${x(0).toFixed(1)},${cy(0).toFixed(1)} Z`;

  const ticks = [];
  const tStep = Math.max(1, Math.ceil((yTop - yBot) / 5));
  for (let v = Math.ceil(yBot / tStep) * tStep; v <= yTop; v += tStep) ticks.push(v);

  const last = pts[pts.length - 1];

  return (
    <div ref={box} className="card" style={{ padding: "16px 14px 10px" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline",
                    padding: "0 6px 8px", flexWrap: "wrap", gap: 10 }}>
        <div className="eyebrow">Cumulative R · every closed trade in sequence</div>
        <div className="mono" style={{ fontSize: 20, color: last.cum >= 0 ? "var(--long)" : "var(--short)" }}>
          {rfmt(last.cum)}
        </div>
      </div>

      <svg viewBox={`0 0 ${w} ${H}`} width="100%" height={H} style={{ display: "block", overflow: "visible" }}>
        {ticks.map((v) => (
          <g key={`t${v}`}>
            <line x1={PL} x2={w - PR} y1={cy(v)} y2={cy(v)}
                  stroke={v === 0 ? "var(--ink3)" : "var(--grid)"}
                  strokeWidth={v === 0 ? 1 : 0.5} strokeDasharray={v === 0 ? "" : "2 4"} />
            <text x={PL - 8} y={cy(v) + 3.5} textAnchor="end" className="mono"
                  fontSize="9.5" fill="var(--ink3)">{v > 0 ? `+${v}` : v}</text>
          </g>
        ))}

        <path d={area} fill={last.cum >= 0 ? "var(--long)" : "var(--short)"} opacity="0.07" />
        <path d={line} fill="none" stroke={last.cum >= 0 ? "var(--long)" : "var(--short)"}
              strokeWidth="1.75" strokeLinejoin="round" strokeLinecap="round" />
        <circle cx={x(pts.length - 1)} cy={cy(last.cum)} r="3.5"
                fill="var(--card)" stroke={last.cum >= 0 ? "var(--long)" : "var(--short)"} strokeWidth="1.75" />

        <line x1={PL} x2={w - PR} y1={zeroY} y2={zeroY} stroke="var(--ink3)" strokeWidth="1" />
        <text x={PL - 8} y={zeroY + 3.5} textAnchor="end" className="mono"
              fontSize="9.5" fill="var(--ink3)">0R</text>

        {pts.map((p) => {
          const h = Math.abs(by(p.r) - zeroY);
          return (
            <rect key={p.id} x={x(p.i) - bw / 2} y={p.r >= 0 ? zeroY - h : zeroY}
                  width={bw} height={Math.max(1, h)}
                  fill={p.r >= 0 ? "var(--long)" : "var(--short)"}
                  opacity={hov && hov.id !== p.id ? 0.3 : 0.9} />
          );
        })}

        {pts.map((p) => (
          <rect key={`h${p.id}`} x={x(p.i) - step / 2} y={PT} width={Math.max(step, 6)}
                height={curveH + GAP + barsH} fill="transparent" style={{ cursor: "crosshair" }}
                onMouseEnter={() => setHov(p)} onMouseLeave={() => setHov(null)} />
        ))}

        {hov && (
          <g pointerEvents="none">
            <line x1={x(hov.i)} x2={x(hov.i)} y1={PT} y2={barsTop + barsH}
                  stroke="var(--brass)" strokeWidth="1" strokeDasharray="3 3" />
            <circle cx={x(hov.i)} cy={cy(hov.cum)} r="3" fill="var(--brass)" />
          </g>
        )}
      </svg>

      <div style={{ padding: "2px 6px 4px", minHeight: 22, display: "flex",
                    justifyContent: "space-between", fontSize: 11.5, color: "var(--ink2)", gap: 12 }}>
        {hov ? (
          <>
            <span><b className="disp">{hov.symbol}</b>
              <span style={{ color: "var(--ink3)" }}> · {hov.market} · {hov.pattern || "no pattern"}</span></span>
            <span className="mono" style={{ color: hov.r >= 0 ? "var(--long)" : "var(--short)" }}>
              {rfmt(hov.r)} <span style={{ color: "var(--ink3)" }}>· running {rfmt(hov.cum)}</span>
            </span>
          </>
        ) : (
          <span style={{ color: "var(--ink3)" }}>{pts.length} closed trades · hover any point</span>
        )}
      </div>
    </div>
  );
}

/* Distribution of R outcomes — the input a Monte Carlo resamples from. */
function Distribution({ rows }) {
  const buckets = useMemo(() => {
    const defs = [
      { k: "≤ -1R", t: (r) => r <= -1 }, { k: "-1 to -0.5", t: (r) => r > -1 && r <= -0.5 },
      { k: "-0.5 to 0", t: (r) => r > -0.5 && r <= 0 }, { k: "0 to 1R", t: (r) => r > 0 && r <= 1 },
      { k: "1 to 2R", t: (r) => r > 1 && r <= 2 }, { k: "2 to 3R", t: (r) => r > 2 && r <= 3 },
      { k: "3 to 5R", t: (r) => r > 3 && r <= 5 }, { k: "> 5R", t: (r) => r > 5 },
    ];
    return defs.map((d) => ({ k: d.k, n: rows.filter((x) => d.t(x.r)).length, win: d.k.indexOf("-") !== 0 && !d.k.startsWith("≤") }));
  }, [rows]);

  const max = Math.max(1, ...buckets.map((b) => b.n));
  return (
    <div className="card pad">
      <div className="eyebrow" style={{ marginBottom: 14 }}>R distribution</div>
      <div style={{ display: "flex", alignItems: "flex-end", gap: 6, height: 118 }}>
        {buckets.map((b) => (
          <div key={b.k} style={{ flex: 1, display: "flex", flexDirection: "column",
                                  alignItems: "center", justifyContent: "flex-end", height: "100%" }}>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink2)", marginBottom: 4 }}>
              {b.n || ""}
            </div>
            <div style={{ width: "100%", height: `${(b.n / max) * 84}%`, minHeight: b.n ? 3 : 0,
                          background: b.win ? "var(--long)" : "var(--short)", opacity: 0.85, borderRadius: "1px 1px 0 0" }} />
          </div>
        ))}
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 7, borderTop: "1px solid var(--rule)", paddingTop: 7 }}>
        {buckets.map((b) => (
          <div key={b.k} className="mono" style={{ flex: 1, textAlign: "center", fontSize: 9, color: "var(--ink3)" }}>
            {b.k}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  TRADE FORM                                                         */
/* ------------------------------------------------------------------ */

const blank = () => ({
  id: uid(), status: "open", symbol: "", market: "NSE", side: "long",
  entryDate: new Date().toISOString().slice(0, 10),
  entryPrice: "", quantity: "", stopLoss: "",
  pattern: "", pivotPrice: "", volVsAvg: "", weinsteinStage: "", rsRank: "",
  exitDate: "", exitPrice: "", exitReason: "", mistakes: [], notes: "",
});

function TradeForm({ initial, settings, onSave, onClose }) {
  const [t, setT] = useState(initial || blank());
  const [riskPct, setRiskPct] = useState(settings.defaultRiskPct);
  const set = (k) => (e) => setT((p) => ({ ...p, [k]: e.target.value }));
  const d = derive(t, settings);
  const editing = !!initial;

  const toggleMistake = (m) =>
    setT((p) => ({ ...p, mistakes: p.mistakes.includes(m)
      ? p.mistakes.filter((x) => x !== m) : [...p.mistakes, m] }));

  const sizeIt = () => {
    const account = ccyOf(t.market) === "USD" ? num(settings.accountUSD) : num(settings.accountINR);
    const rps = Math.abs(num(t.entryPrice) - num(t.stopLoss));
    if (!(rps > 0) || !(account > 0)) return;
    setT((p) => ({ ...p, quantity: String(Math.floor((account * (riskPct / 100)) / rps)) }));
  };

  const valid = t.symbol.trim() && isFinite(num(t.entryPrice)) &&
    isFinite(num(t.quantity)) && isFinite(num(t.stopLoss)) &&
    (t.status === "open" || isFinite(num(t.exitPrice)));

  const overRisk = isFinite(d.riskPct) && d.riskPct > 2;

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheethead">
          <div>
            <div className="eyebrow">{editing ? "Edit trade" : "New trade"}</div>
            <div className="disp" style={{ fontSize: 17, marginTop: 2 }}>
              {t.symbol ? t.symbol.toUpperCase() : "Untitled position"}
            </div>
          </div>
          <button className="x" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>

        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 20 }}>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Position</div>
            <div className="grid4" style={{ gap: 12 }}>
              <label className="f"><span>Symbol</span>
                <input className="in" value={t.symbol} placeholder="TATAMOTORS"
                       onChange={(e) => setT((p) => ({ ...p, symbol: e.target.value.toUpperCase() }))} /></label>
              <label className="f"><span>Market</span>
                <select className="in" value={t.market} onChange={set("market")}>
                  {MARKETS.map((m) => <option key={m.id} value={m.id}>{m.label} · {m.ccy}</option>)}
                </select></label>
              <label className="f"><span>Direction</span>
                <select className="in" value={t.side} onChange={set("side")}>
                  <option value="long">Long</option><option value="short">Short</option>
                </select></label>
              <label className="f"><span>Entry date</span>
                <input className="in" type="date" value={t.entryDate} onChange={set("entryDate")} /></label>
            </div>
            <div className="grid3" style={{ gap: 12, marginTop: 12 }}>
              <label className="f"><span>Entry price</span>
                <input className="in" inputMode="decimal" value={t.entryPrice} onChange={set("entryPrice")} /></label>
              <label className="f"><span>Stop loss</span>
                <input className="in" inputMode="decimal" value={t.stopLoss} onChange={set("stopLoss")} /></label>
              <label className="f"><span>Quantity</span>
                <input className="in" inputMode="numeric" value={t.quantity} onChange={set("quantity")} /></label>
            </div>
          </div>

          <div className="readout">
            <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span className="eyebrow" style={{ color: "var(--ink2)" }}>Size it for me</span>
              <input className="in mono" style={{ width: 68, padding: "4px 7px", fontSize: 13 }}
                     value={riskPct} inputMode="decimal"
                     onChange={(e) => setRiskPct(e.target.value)} />
              <span style={{ fontSize: 12, color: "var(--ink2)" }}>% of account at risk</span>
              <button className="btn ghost sm" onClick={sizeIt}>Set quantity</button>
            </div>
            <div className="row"><span>Risk per share</span>
              <b>{isFinite(d.riskPerShare) ? d.riskPerShare.toFixed(2) : "—"}</b></div>
            <div className="row"><span>1R — total risk</span>
              <b>{money(d.riskAmt, d.ccy)}</b></div>
            <div className="row"><span>Risk as % of {d.ccy} account</span>
              <b style={{ color: overRisk ? "var(--short)" : "inherit" }}>{pct(d.riskPct, 2)}</b></div>
            <div className="row"><span>Position value / exposure</span>
              <b>{money(d.exposure, d.ccy)} · {pct(d.exposurePct)}</b></div>
            {overRisk && (
              <div className="warn" style={{ marginTop: 9 }}>
                This position risks more than 2% of the account. Reduce the quantity or tighten the stop.
              </div>
            )}
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>The setup</div>
            <div className="grid4" style={{ gap: 12 }}>
              <label className="f"><span>Base pattern</span>
                <select className="in" value={t.pattern} onChange={set("pattern")}>
                  <option value="">—</option>
                  {PATTERNS.map((p) => <option key={p} value={p}>{p}</option>)}
                </select></label>
              <label className="f"><span>Pivot price</span>
                <input className="in" inputMode="decimal" value={t.pivotPrice} onChange={set("pivotPrice")} />
                <div className="hint">
                  {isFinite(d.distPivot)
                    ? `Entered ${d.distPivot >= 0 ? "" : "−"}${Math.abs(d.distPivot).toFixed(1)}% ${d.distPivot >= 0 ? "above" : "below"} pivot`
                    : "Sets your extension at entry"}
                </div></label>
              <label className="f"><span>Volume % of avg</span>
                <input className="in" inputMode="decimal" placeholder="240" value={t.volVsAvg} onChange={set("volVsAvg")} />
                <div className="hint" style={{ color: isFinite(num(t.volVsAvg)) && num(t.volVsAvg) < 100 ? "var(--short)" : undefined }}>
                  {isFinite(num(t.volVsAvg))
                    ? num(t.volVsAvg) >= 100
                      ? `${(num(t.volVsAvg) - 100).toFixed(0)}% above the 30-day average`
                      : `${(100 - num(t.volVsAvg)).toFixed(0)}% below average — thin breakout`
                    : "100 = the 30-day average"}
                </div></label>
              <label className="f"><span>RS rank</span>
                <input className="in" inputMode="numeric" placeholder="1–99" value={t.rsRank} onChange={set("rsRank")} /></label>
            </div>
            <label className="f" style={{ marginTop: 12, maxWidth: 280 }}><span>Weinstein stage</span>
              <select className="in" value={t.weinsteinStage} onChange={set("weinsteinStage")}>
                <option value="">—</option>
                {STAGES.map((s) => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select></label>
          </div>

          <div>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Exit</div>
            <div className="seg" style={{ marginBottom: 12 }}>
              <button data-on={t.status === "open" ? 1 : 0}
                      onClick={() => setT((p) => ({ ...p, status: "open" }))}>Still open</button>
              <button data-on={t.status === "closed" ? 1 : 0}
                      onClick={() => setT((p) => ({ ...p, status: "closed",
                        exitDate: p.exitDate || new Date().toISOString().slice(0, 10) }))}>Closed</button>
            </div>
            {t.status === "closed" && (
              <>
                <div className="grid3" style={{ gap: 12 }}>
                  <label className="f"><span>Exit price</span>
                    <input className="in" inputMode="decimal" value={t.exitPrice} onChange={set("exitPrice")} /></label>
                  <label className="f"><span>Exit date</span>
                    <input className="in" type="date" value={t.exitDate} onChange={set("exitDate")} /></label>
                  <label className="f"><span>Why you exited</span>
                    <select className="in" value={t.exitReason} onChange={set("exitReason")}>
                      <option value="">—</option>
                      {EXIT_REASONS.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select></label>
                </div>
                {isFinite(d.r) && (
                  <div className="readout" style={{ marginTop: 12 }}>
                    <div className="row"><span>Realised P&amp;L</span>
                      <b className={d.pnl >= 0 ? "pos" : "neg"}>{money(d.pnl, d.ccy)}</b></div>
                    <div className="row"><span>Outcome in R</span>
                      <b className={d.r >= 0 ? "pos" : "neg"} style={{ fontSize: 15 }}>{rfmt(d.r)}</b></div>
                    {isFinite(d.heldDays) && (
                      <div className="row"><span>Held</span><b>{d.heldDays} days</b></div>)}
                  </div>
                )}
                <div style={{ marginTop: 14 }}>
                  <div className="eyebrow" style={{ marginBottom: 8 }}>Anything you got wrong</div>
                  <div className="chips">
                    {MISTAKES.map((m) => (
                      <button key={m} className="chip rd" data-on={t.mistakes.includes(m) ? 1 : 0}
                              onClick={() => toggleMistake(m)}>{m}</button>
                    ))}
                  </div>
                </div>
              </>
            )}
          </div>

          <label className="f"><span>Notes on this trade</span>
            <textarea className="in" rows={3} value={t.notes} onChange={set("notes")}
              placeholder="What the chart looked like, what the market was doing, what you were thinking." /></label>

          <div style={{ display: "flex", gap: 10, justifyContent: "flex-end",
                        borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" disabled={!valid} style={{ opacity: valid ? 1 : 0.4 }}
                    onClick={() => valid && onSave(t)}>
              <Check size={14} />{editing ? "Save changes" : "Log trade"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  APP                                                                */
/* ------------------------------------------------------------------ */

export default function App() {
  const [tab, setTab] = useState("dash");
  const [loading, setLoading] = useState(true);
  const [trades, setTrades] = useState([]);
  const [diary, setDiary] = useState([]);
  const [settings, setSettings] = useState(DEFAULT_SETTINGS);
  const [editing, setEditing] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [flash, setFlash] = useState("");

  useEffect(() => {
    (async () => {
      const [t, d, s] = await Promise.all([
        sGet(K.trades, []), sGet(K.diary, []), sGet(K.settings, DEFAULT_SETTINGS),
      ]);
      const raw = Array.isArray(t) ? t : [];
      const fixed = migrateVolume(raw);
      setTrades(fixed);
      if (JSON.stringify(fixed) !== JSON.stringify(raw)) sSet(K.trades, fixed);
      setDiary(Array.isArray(d) ? d : []);
      setSettings({ ...DEFAULT_SETTINGS, ...(s || {}) });
      setLoading(false);
    })();
  }, []);

  const say = useCallback((m) => { setFlash(m); setTimeout(() => setFlash(""), 2600); }, []);

  const persistTrades = async (next) => { setTrades(next); if (!(await sSet(K.trades, next))) say("Could not save — storage is unavailable."); };
  const persistDiary = async (next) => { setDiary(next); if (!(await sSet(K.diary, next))) say("Could not save — storage is unavailable."); };
  const persistSettings = async (next) => { setSettings(next); await sSet(K.settings, next); };

  const saveTrade = async (t) => {
    const exists = trades.some((x) => x.id === t.id);
    await persistTrades(exists ? trades.map((x) => (x.id === t.id ? t : x)) : [...trades, t]);
    setShowForm(false); setEditing(null);
    say(exists ? "Trade updated." : "Trade logged.");
  };

  const removeTrade = async (id) => { await persistTrades(trades.filter((x) => x.id !== id)); say("Trade removed."); };

  /* Enrich once, use everywhere */
  const all = useMemo(
    () => trades.map((t) => ({ ...t, ...derive(t, settings) })),
    [trades, settings]
  );
  const closed = useMemo(
    () => all.filter((t) => t.status === "closed" && isFinite(t.r))
             .sort((a, b) => new Date(a.exitDate || a.entryDate) - new Date(b.exitDate || b.entryDate)),
    [all]
  );
  const open = useMemo(() => all.filter((t) => t.status === "open"), [all]);
  const S = useMemo(() => stats(closed), [closed]);

  const exportAll = () => {
    const blob = new Blob([JSON.stringify({ version: 1, exportedAt: new Date().toISOString(), settings, trades, diary }, null, 2)],
      { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trading-journal-${new Date().toISOString().slice(0, 10)}.json`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const exportCsv = () => {
    const cols = ["symbol","market","side","entryDate","entryPrice","quantity","stopLoss","riskAmt","riskPct",
      "pattern","pivotPrice","distPivot","volVsAvg","weinsteinStage","rsRank",
      "exitDate","exitPrice","exitReason","pnl","r","heldDays","mistakes","notes"];
    const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [cols.join(",")].concat(all.map((t) =>
      cols.map((c) => esc(Array.isArray(t[c]) ? t[c].join(" | ") :
        typeof t[c] === "number" ? (isFinite(t[c]) ? t[c].toFixed(4) : "") : t[c])).join(",")));
    const blob = new Blob([lines.join("\n")], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `trades-${new Date().toISOString().slice(0, 10)}.csv`;
    a.click(); URL.revokeObjectURL(a.href);
  };

  const importAll = async (file) => {
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      if (data.trades) await persistTrades(data.trades);
      if (data.diary) await persistDiary(data.diary);
      if (data.settings) await persistSettings({ ...DEFAULT_SETTINGS, ...data.settings });
      say("Journal restored.");
    } catch { say("That file isn't a journal export."); }
  };

  if (loading) {
    return (
      <div className="bl"><style>{CSS}</style>
        <div className="wrap" style={{ paddingTop: 90 }}>
          <div className="eyebrow">Opening the ledger</div>
        </div>
      </div>
    );
  }

  const TABS = [
    { id: "dash", label: "Dashboard", icon: LayoutGrid },
    { id: "trades", label: "Trades", icon: Table2 },
    { id: "perf", label: "Performance", icon: LineChart },
    { id: "diary", label: "Diary", icon: BookOpen },
  ];

  return (
    <div className="bl">
      <style>{CSS}</style>

      <div className="topbar">
        <div className="topin">
          <div style={{ flex: "1 1 240px" }}>
            <div className="brand">
              <h1 className="disp">{settings.name}</h1>
              <span className="eyebrow" style={{ position: "relative", top: -1 }}>
                {closed.length} closed · {open.length} open
              </span>
            </div>
            <div className="tabs">
              {TABS.map((t) => {
                const I = t.icon;
                return (
                  <button key={t.id} className="tab" data-on={tab === t.id ? 1 : 0} onClick={() => setTab(t.id)}>
                    <I size={13} />{t.label}
                  </button>
                );
              })}
            </div>
          </div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", paddingBottom: 12 }}>
            <button className="btn ghost sm" onClick={() => setShowSettings(true)} aria-label="Settings">
              <Settings2 size={13} />Setup
            </button>
            <button className="btn" onClick={() => { setEditing(null); setShowForm(true); }}>
              <Plus size={14} />New trade
            </button>
          </div>
        </div>
      </div>

      <div className="wrap">
        {flash && (
          <div className="warn" style={{ marginTop: 14 }}>{flash}</div>
        )}

        {tab === "dash" && <Dashboard S={S} closed={closed} open={open} settings={settings} diary={diary} />}
        {tab === "trades" && (
          <Trades all={all} onEdit={(t) => { setEditing(t); setShowForm(true); }} onDelete={removeTrade}
                  onExportCsv={exportCsv} onNew={() => { setEditing(null); setShowForm(true); }} />
        )}
        {tab === "perf" && <Performance closed={closed} S={S} />}
        {tab === "diary" && <Diary diary={diary} trades={all} onSave={persistDiary} say={say} />}
      </div>

      {showForm && (
        <TradeForm initial={editing} settings={settings}
                   onSave={saveTrade} onClose={() => { setShowForm(false); setEditing(null); }} />
      )}

      {showSettings && (
        <SettingsSheet settings={settings} onSave={persistSettings} onClose={() => setShowSettings(false)}
                       onExport={exportAll} onExportCsv={exportCsv} onImport={importAll} />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  DASHBOARD                                                          */
/* ------------------------------------------------------------------ */

function Tile({ label, value, sub, tone }) {
  return (
    <div className="tile">
      <div className="eyebrow">{label}</div>
      <div className={`v mono ${tone || ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}

function Dashboard({ S, closed, open, settings, diary }) {
  const openRisk = useMemo(() => {
    const g = { INR: 0, USD: 0 };
    open.forEach((t) => { if (isFinite(t.riskAmt)) g[t.ccy] += t.riskAmt; });
    return g;
  }, [open]);

  const pnlByCcy = useMemo(() => {
    const g = { INR: 0, USD: 0 };
    closed.forEach((t) => { if (isFinite(t.pnl)) g[t.ccy] += t.pnl; });
    return g;
  }, [closed]);

  const openRiskR = useMemo(() => {
    return open.reduce((a, t) => a + (isFinite(t.riskPct) ? t.riskPct : 0), 0);
  }, [open]);

  const lastEntry = diary[0];

  return (
    <>
      <div className="sec"><LedgerPlot rows={closed} /></div>

      <div className="sec grid4">
        <Tile label="Expectancy" value={S.n ? rfmt(S.expectancy) : "—"}
              tone={S.n && S.expectancy >= 0 ? "pos" : S.n ? "neg" : ""}
              sub={S.n ? `across ${S.n} closed trades` : "log a closed trade"} />
        <Tile label="Win rate" value={S.n ? pct(S.winRate, 0) : "—"}
              sub={S.n ? `payoff ${isFinite(S.payoff) ? S.payoff.toFixed(1) : "∞"} : 1` : "—"} />
        <Tile label="Profit factor" value={S.n ? (isFinite(S.profitFactor) ? S.profitFactor.toFixed(2) : "∞") : "—"}
              sub={S.n ? `max drawdown ${S.maxDD.toFixed(1)}R` : "—"} />
        <Tile label="Open risk" value={pct(openRiskR, 2)}
              tone={openRiskR > 6 ? "neg" : ""}
              sub={`${open.length} position${open.length === 1 ? "" : "s"} live`} />
      </div>

      <div className="sec grid2">
        <Distribution rows={closed} />
        <div className="card pad">
          <div className="eyebrow" style={{ marginBottom: 14 }}>Realised P&amp;L by market</div>
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            {["INR", "USD"].map((c) => (
              <div key={c} style={{ display: "flex", justifyContent: "space-between",
                                    alignItems: "baseline", borderBottom: "1px solid var(--rule)", paddingBottom: 12 }}>
                <div>
                  <div className="disp" style={{ fontSize: 13 }}>{c === "INR" ? "India · NSE / BSE" : "United States"}</div>
                  <div style={{ fontSize: 11, color: "var(--ink3)", marginTop: 2 }}>
                    {closed.filter((t) => t.ccy === c).length} closed ·
                    {" "}account {money(c === "USD" ? settings.accountUSD : settings.accountINR, c)}
                  </div>
                </div>
                <div className={`mono ${pnlByCcy[c] >= 0 ? "pos" : "neg"}`} style={{ fontSize: 19 }}>
                  {money(pnlByCcy[c], c)}
                </div>
              </div>
            ))}
            <div style={{ fontSize: 11.5, color: "var(--ink3)", lineHeight: 1.6 }}>
              Currency totals stay separate on purpose. Every performance number in this
              journal is measured in R, which is why NSE and US trades can sit in one table
              without an exchange rate distorting them.
            </div>
          </div>
        </div>
      </div>

      <div className="sec">
        <div className="sechead">
          <div className="eyebrow">Open positions</div>
          {open.length > 0 && (
            <div className="mono" style={{ fontSize: 12, color: "var(--ink2)" }}>
              at risk: {money(openRisk.INR, "INR")} · {money(openRisk.USD, "USD")}
            </div>
          )}
        </div>
        <div className="card scroll">
          {open.length === 0 ? (
            <div className="empty"><p style={{ margin: 0 }}>Nothing open. Flat is a position.</p></div>
          ) : (
            <table className="t">
              <thead><tr>
                <th>Symbol</th><th>Entered</th><th>Pattern</th>
                <th className="num">Entry</th><th className="num">Stop</th>
                <th className="num">Qty</th><th className="num">1R</th><th className="num">Risk %</th>
              </tr></thead>
              <tbody>
                {open.map((t) => (
                  <tr key={t.id}>
                    <td><b className="disp">{t.symbol}</b>
                      <span style={{ color: "var(--ink3)", fontSize: 11 }}> {t.market}</span></td>
                    <td className="mono" style={{ fontSize: 12 }}>{t.entryDate}</td>
                    <td style={{ color: "var(--ink2)", fontSize: 12 }}>{t.pattern || "—"}</td>
                    <td className="num">{Number(t.entryPrice).toFixed(2)}</td>
                    <td className="num" style={{ color: "var(--short)" }}>{Number(t.stopLoss).toFixed(2)}</td>
                    <td className="num">{t.quantity}</td>
                    <td className="num">{money(t.riskAmt, t.ccy)}</td>
                    <td className="num" style={{ color: t.riskPct > 2 ? "var(--short)" : "inherit" }}>
                      {pct(t.riskPct, 2)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {lastEntry && (
        <div className="sec">
          <div className="sechead"><div className="eyebrow">Latest from the diary</div>
            <div className="mono" style={{ fontSize: 11, color: "var(--ink3)" }}>{lastEntry.date}</div></div>
          <div className="card pad">
            <div className="chips" style={{ marginBottom: 8 }}>
              {(lastEntry.emotions || []).map((e) => <span key={e} className="chip">{e}</span>)}
            </div>
            <div style={{ whiteSpace: "pre-wrap", fontSize: 14, lineHeight: 1.65,
                          maxHeight: 120, overflow: "hidden" }}>{lastEntry.body}</div>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  TRADE SHEET                                                        */
/* ------------------------------------------------------------------ */

function Trades({ all, onEdit, onDelete, onExportCsv, onNew }) {
  const [filter, setFilter] = useState("all");
  const [q, setQ] = useState("");
  const [sort, setSort] = useState({ k: "entryDate", dir: -1 });

  const rows = useMemo(() => {
    let r = all;
    if (filter === "open") r = r.filter((t) => t.status === "open");
    if (filter === "closed") r = r.filter((t) => t.status === "closed");
    if (filter === "winners") r = r.filter((t) => t.r > 0);
    if (filter === "losers") r = r.filter((t) => isFinite(t.r) && t.r <= 0);
    if (q.trim()) {
      const s = q.trim().toLowerCase();
      r = r.filter((t) => (t.symbol || "").toLowerCase().includes(s) ||
        (t.pattern || "").toLowerCase().includes(s) || (t.notes || "").toLowerCase().includes(s));
    }
    return [...r].sort((a, b) => {
      const av = a[sort.k], bv = b[sort.k];
      if (typeof av === "number" || typeof bv === "number")
        return ((isFinite(av) ? av : -1e12) - (isFinite(bv) ? bv : -1e12)) * sort.dir;
      return String(av || "").localeCompare(String(bv || "")) * sort.dir;
    });
  }, [all, filter, q, sort]);

  const th = (k, label, cls) => (
    <th className={cls} style={{ cursor: "pointer" }}
        onClick={() => setSort((s) => ({ k, dir: s.k === k ? -s.dir : -1 }))}>
      {label}{sort.k === k ? (sort.dir === 1 ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="sec">
      <div className="sechead">
        <div className="seg">
          {[["all","All"],["open","Open"],["closed","Closed"],["winners","Winners"],["losers","Losers"]].map(([id,l]) => (
            <button key={id} data-on={filter === id ? 1 : 0} onClick={() => setFilter(id)}>{l}</button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input className="in" style={{ width: 180, padding: "6px 10px", fontSize: 13 }}
                 placeholder="Search" value={q} onChange={(e) => setQ(e.target.value)} />
          <button className="btn ghost sm" onClick={onExportCsv}><Download size={13} />CSV</button>
        </div>
      </div>

      <div className="card scroll">
        {rows.length === 0 ? (
          <div className="empty">
            <div className="eyebrow">Nothing here yet</div>
            <p>Every trade you log becomes a row here and a bar on the plot. Start with
              one — even an old trade you still remember clearly.</p>
            <button className="btn" onClick={onNew}><Plus size={14} />Log a trade</button>
          </div>
        ) : (
          <table className="t">
            <thead><tr>
              {th("symbol", "Symbol")}
              {th("entryDate", "In")}
              {th("exitDate", "Out")}
              {th("pattern", "Pattern")}
              {th("distPivot", "Δ pivot", "num")}
              {th("volVsAvg", "Vol %", "num")}
              {th("weinsteinStage", "Stg", "num")}
              {th("rsRank", "RS", "num")}
              {th("entryPrice", "Entry", "num")}
              {th("stopLoss", "Stop", "num")}
              {th("quantity", "Qty", "num")}
              {th("riskPct", "Risk", "num")}
              {th("pnl", "P&L", "num")}
              {th("r", "R", "num")}
              <th></th>
            </tr></thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td>
                    <b className="disp">{t.symbol}</b>
                    <span style={{ color: "var(--ink3)", fontSize: 11 }}> {t.market}</span>
                    {t.side === "short" && <span style={{ color: "var(--short)", fontSize: 10 }}> ▾</span>}
                    {(t.mistakes || []).length > 0 && (
                      <span title={t.mistakes.join(", ")}
                            style={{ color: "var(--brass)", fontSize: 11, marginLeft: 4 }}>▲</span>)}
                  </td>
                  <td className="mono" style={{ fontSize: 12 }}>{t.entryDate}</td>
                  <td className="mono" style={{ fontSize: 12, color: t.exitDate ? "inherit" : "var(--ink3)" }}>
                    {t.exitDate || "open"}</td>
                  <td style={{ fontSize: 12, color: "var(--ink2)" }}>{t.pattern || "—"}</td>
                  <td className="num" style={{ fontSize: 12,
                        color: t.distPivot > 5 ? "var(--short)" : "inherit" }}>
                    {isFinite(t.distPivot) ? `${t.distPivot >= 0 ? "+" : ""}${t.distPivot.toFixed(1)}%` : "—"}</td>
                  <td className="num" style={{ fontSize: 12,
                        color: isFinite(num(t.volVsAvg)) && num(t.volVsAvg) < 100 ? "var(--short)" : "inherit" }}>
                    {t.volVsAvg ? `${t.volVsAvg}%` : "—"}</td>
                  <td className="num" style={{ fontSize: 12 }}>{t.weinsteinStage || "—"}</td>
                  <td className="num" style={{ fontSize: 12 }}>{t.rsRank || "—"}</td>
                  <td className="num">{Number(t.entryPrice).toFixed(2)}</td>
                  <td className="num">{Number(t.stopLoss).toFixed(2)}</td>
                  <td className="num">{t.quantity}</td>
                  <td className="num" style={{ fontSize: 12 }}>{pct(t.riskPct, 2)}</td>
                  <td className={`num ${isFinite(t.pnl) ? (t.pnl >= 0 ? "pos" : "neg") : ""}`}>
                    {isFinite(t.pnl) ? money(t.pnl, t.ccy) : "—"}</td>
                  <td className={`num ${isFinite(t.r) ? (t.r >= 0 ? "pos" : "neg") : ""}`}
                      style={{ fontWeight: 500 }}>{isFinite(t.r) ? rfmt(t.r) : "—"}</td>
                  <td style={{ whiteSpace: "nowrap" }}>
                    <button className="x" onClick={() => onEdit(t)} aria-label="Edit"><Pencil size={13} /></button>
                    <button className="x" onClick={() => onDelete(t.id)} aria-label="Delete"><Trash2 size={13} /></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {rows.length > 0 && (
        <div className="hint" style={{ marginTop: 8 }}>
          ▲ marks a trade where you tagged a mistake · ▾ marks a short · click any column to sort
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  PERFORMANCE                                                        */
/* ------------------------------------------------------------------ */

const DIMENSIONS = [
  { id: "pattern", label: "Base pattern", get: (t) => t.pattern || "Not recorded" },
  { id: "dist", label: "Extension at entry",
    get: (t) => band(t.distPivot, [0, 2, 5], ["Below pivot", "0–2% above", "2–5% above", "Over 5% above"]) },
  { id: "vol", label: "Breakout volume",
    get: (t) => band(num(t.volVsAvg), [100, 150, 250, 400],
      ["Below average", "100–150%", "150–250%", "250–400%", "Over 400%"]) },
  { id: "stage", label: "Weinstein stage",
    get: (t) => (t.weinsteinStage ? `Stage ${t.weinsteinStage}` : "Not recorded") },
  { id: "rs", label: "RS rank",
    get: (t) => band(num(t.rsRank), [70, 80, 90], ["Under 70", "70–79", "80–89", "90+"]) },
  { id: "exit", label: "Exit reason", get: (t) => t.exitReason || "Not recorded" },
  { id: "market", label: "Market", get: (t) => t.market },
  { id: "hold", label: "Holding period",
    get: (t) => band(t.heldDays, [5, 15, 40], ["Under 5 days", "5–15 days", "15–40 days", "Over 40 days"]) },
  { id: "month", label: "Month", get: (t) => (t.exitDate || t.entryDate || "").slice(0, 7) || "—" },
];

function Performance({ closed, S }) {
  const [dim, setDim] = useState("pattern");
  const D = DIMENSIONS.find((d) => d.id === dim);

  const groups = useMemo(() => {
    const m = new Map();
    closed.forEach((t) => {
      const k = D.get(t);
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(t);
    });
    return [...m.entries()]
      .map(([k, rows]) => ({ k, ...stats(rows) }))
      .sort((a, b) => b.totalR - a.totalR);
  }, [closed, D]);

  const mistakeCost = useMemo(() => {
    const m = new Map();
    closed.forEach((t) => (t.mistakes || []).forEach((x) => {
      if (!m.has(x)) m.set(x, []);
      m.get(x).push(t);
    }));
    return [...m.entries()].map(([k, rows]) => ({ k, ...stats(rows) }))
      .sort((a, b) => a.totalR - b.totalR);
  }, [closed]);

  if (!closed.length) {
    return (
      <div className="sec card empty">
        <div className="eyebrow">Performance sheet</div>
        <p>This page reads your closed trades and tells you which setups actually pay.
          It needs closed trades to read. Log a few and come back.</p>
      </div>
    );
  }

  return (
    <>
      <div className="sec grid4">
        <Tile label="Total R" value={rfmt(S.totalR, 1)} tone={S.totalR >= 0 ? "pos" : "neg"}
              sub={`${S.n} trades`} />
        <Tile label="Average win" value={rfmt(S.avgWin)} tone="pos"
              sub={`best ${rfmt(S.best)}`} />
        <Tile label="Average loss" value={rfmt(-S.avgLoss)} tone="neg"
              sub={`worst ${rfmt(S.worst)}`} />
        <Tile label="Max drawdown" value={`${S.maxDD.toFixed(1)}R`}
              sub={`longest losing run ${S.worstL}`} />
      </div>

      <div className="sec">
        <div className="sechead">
          <div>
            <div className="eyebrow">Where the edge is</div>
            <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
              Same trades, cut a different way. Expectancy is the column that matters.
            </div>
          </div>
        </div>
        <div className="seg" style={{ marginBottom: 12 }}>
          {DIMENSIONS.map((d) => (
            <button key={d.id} data-on={dim === d.id ? 1 : 0} onClick={() => setDim(d.id)}>{d.label}</button>
          ))}
        </div>
        <div className="card scroll">
          <table className="t">
            <thead><tr>
              <th>{D.label}</th>
              <th className="num">Trades</th><th className="num">Win rate</th>
              <th className="num">Avg win</th><th className="num">Avg loss</th>
              <th className="num">Expectancy</th><th className="num">Total R</th>
              <th style={{ width: "22%" }}></th>
            </tr></thead>
            <tbody>
              {groups.map((g) => {
                const maxAbs = Math.max(...groups.map((x) => Math.abs(x.totalR)), 1);
                const wpx = (Math.abs(g.totalR) / maxAbs) * 100;
                return (
                  <tr key={g.k}>
                    <td><b style={{ fontWeight: 500 }}>{g.k}</b></td>
                    <td className="num">{g.n}</td>
                    <td className="num">{pct(g.winRate, 0)}</td>
                    <td className="num pos">{rfmt(g.avgWin)}</td>
                    <td className="num neg">{rfmt(-g.avgLoss)}</td>
                    <td className={`num ${g.expectancy >= 0 ? "pos" : "neg"}`} style={{ fontWeight: 500 }}>
                      {rfmt(g.expectancy)}</td>
                    <td className={`num ${g.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(g.totalR, 1)}</td>
                    <td>
                      <div style={{ display: "flex", justifyContent: g.totalR >= 0 ? "flex-start" : "flex-end" }}>
                        <div style={{ width: `${wpx}%`, height: 7, borderRadius: 1,
                                      background: g.totalR >= 0 ? "var(--long)" : "var(--short)", opacity: 0.75 }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {groups.some((g) => g.n < 10) && (
          <div className="hint" style={{ marginTop: 8 }}>
            Rows with fewer than about 10 trades are noise, not signal. Read them as questions to watch, not conclusions.
          </div>
        )}
      </div>

      {mistakeCost.length > 0 && (
        <div className="sec">
          <div className="sechead">
            <div>
              <div className="eyebrow">What the mistakes cost</div>
              <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
                Only counts trades where you tagged the mistake yourself.
              </div>
            </div>
          </div>
          <div className="card scroll">
            <table className="t">
              <thead><tr><th>Mistake</th><th className="num">Times</th>
                <th className="num">Win rate</th><th className="num">Expectancy</th><th className="num">Total R</th></tr></thead>
              <tbody>
                {mistakeCost.map((m) => (
                  <tr key={m.k}>
                    <td>{m.k}</td>
                    <td className="num">{m.n}</td>
                    <td className="num">{pct(m.winRate, 0)}</td>
                    <td className={`num ${m.expectancy >= 0 ? "pos" : "neg"}`}>{rfmt(m.expectancy)}</td>
                    <td className={`num ${m.totalR >= 0 ? "pos" : "neg"}`}>{rfmt(m.totalR, 1)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/*  DIARY                                                              */
/* ------------------------------------------------------------------ */

function Diary({ diary, trades, onSave, say }) {
  const [draft, setDraft] = useState(null);
  const [imgs, setImgs] = useState({});
  const fileRef = useRef(null);

  const newDraft = () => setDraft({
    id: uid(), date: new Date().toISOString().slice(0, 10),
    emotions: [], body: "", tradeId: "", hasImage: false, image: null,
  });

  const loadImage = async (id) => {
    if (imgs[id]) return;
    const v = await sGet(K.img(id), null);
    if (v) setImgs((p) => ({ ...p, [id]: v }));
  };

  useEffect(() => { diary.forEach((e) => e.hasImage && loadImage(e.id)); /* eslint-disable-next-line */ }, [diary]);

  const pickFile = async (e) => {
    const f = e.target.files && e.target.files[0];
    if (!f) return;
    try {
      const data = await fileToCompressed(f);
      setDraft((p) => ({ ...p, image: data, hasImage: true }));
    } catch (err) { say(err.message); }
    e.target.value = "";
  };

  const commit = async () => {
    if (!draft.body.trim() && !draft.image) { say("Write something or attach a chart first."); return; }
    if (draft.image) {
      const ok = await sSet(K.img(draft.id), draft.image);
      if (!ok) say("The note saved, but the chart image was too large to store.");
      else setImgs((p) => ({ ...p, [draft.id]: draft.image }));
    }
    const rec = { id: draft.id, date: draft.date, emotions: draft.emotions,
                  body: draft.body, tradeId: draft.tradeId, hasImage: !!draft.image };
    const next = [rec, ...diary.filter((x) => x.id !== rec.id)]
      .sort((a, b) => (a.date < b.date ? 1 : -1));
    await onSave(next);
    setDraft(null);
  };

  const remove = async (id) => {
    await sDel(K.img(id));
    await onSave(diary.filter((x) => x.id !== id));
    setImgs((p) => { const n = { ...p }; delete n[id]; return n; });
  };

  const toggleEmotion = (em) => setDraft((p) => ({
    ...p, emotions: p.emotions.includes(em) ? p.emotions.filter((x) => x !== em) : [...p.emotions, em],
  }));

  return (
    <div className="sec">
      <div className="sechead">
        <div>
          <div className="eyebrow">Diary</div>
          <div style={{ fontSize: 12, color: "var(--ink2)", marginTop: 3 }}>
            What you felt, what the market was doing, and the chart in front of you.
          </div>
        </div>
        {!draft && <button className="btn" onClick={newDraft}><Plus size={14} />New entry</button>}
      </div>

      {draft && (
        <div className="card pad" style={{ marginBottom: 18 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap", marginBottom: 14 }}>
            <label className="f"><span>Date</span>
              <input className="in" type="date" value={draft.date}
                     onChange={(e) => setDraft((p) => ({ ...p, date: e.target.value }))} /></label>
            <label className="f" style={{ flex: 1, minWidth: 200 }}><span>Attach to a trade (optional)</span>
              <select className="in" value={draft.tradeId}
                      onChange={(e) => setDraft((p) => ({ ...p, tradeId: e.target.value }))}>
                <option value="">Not tied to one trade</option>
                {trades.map((t) => (
                  <option key={t.id} value={t.id}>{t.symbol} · {t.entryDate}</option>
                ))}
              </select></label>
          </div>

          <div className="eyebrow" style={{ marginBottom: 8 }}>How you were feeling</div>
          <div className="chips" style={{ marginBottom: 14 }}>
            {EMOTIONS.map((em) => (
              <button key={em} className="chip" data-on={draft.emotions.includes(em) ? 1 : 0}
                      onClick={() => toggleEmotion(em)}>{em}</button>
            ))}
          </div>

          <textarea className="in" rows={7} value={draft.body}
            onChange={(e) => setDraft((p) => ({ ...p, body: e.target.value }))}
            placeholder="What happened today. What you did and why. What you would do differently." />

          {draft.image && (
            <div style={{ marginTop: 12 }}>
              <img src={draft.image} alt="Attached chart"
                   style={{ maxWidth: "100%", border: "1px solid var(--rule)", borderRadius: 2 }} />
              <button className="btn ghost sm" style={{ marginTop: 8 }}
                      onClick={() => setDraft((p) => ({ ...p, image: null, hasImage: false }))}>
                <X size={12} />Remove chart
              </button>
            </div>
          )}

          <input ref={fileRef} type="file" accept="image/*" style={{ display: "none" }} onChange={pickFile} />

          <div style={{ display: "flex", gap: 10, justifyContent: "space-between", marginTop: 16, flexWrap: "wrap" }}>
            <button className="btn ghost" onClick={() => fileRef.current && fileRef.current.click()}>
              <ImageIcon size={13} />{draft.image ? "Replace chart" : "Attach chart"}
            </button>
            <div style={{ display: "flex", gap: 10 }}>
              <button className="btn ghost" onClick={() => setDraft(null)}>Discard</button>
              <button className="btn" onClick={commit}><Check size={14} />Save entry</button>
            </div>
          </div>
        </div>
      )}

      {diary.length === 0 && !draft ? (
        <div className="card empty">
          <div className="eyebrow">Nothing written yet</div>
          <p>The trade sheet records what you did. This records why. Over a year the
            second one usually explains the first.</p>
          <button className="btn" onClick={newDraft}><Plus size={14} />Write the first entry</button>
        </div>
      ) : (
        diary.map((e) => {
          const t = trades.find((x) => x.id === e.tradeId);
          return (
            <div key={e.id} className="entry">
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 12 }}>
                <div>
                  <div className="mono" style={{ fontSize: 12, color: "var(--ink2)" }}>{e.date}</div>
                  {t && (
                    <div style={{ fontSize: 11, color: "var(--brass)", marginTop: 3 }}>
                      on {t.symbol} · {isFinite(t.r) ? rfmt(t.r) : "still open"}
                    </div>
                  )}
                </div>
                <button className="x" onClick={() => remove(e.id)} aria-label="Delete entry">
                  <Trash2 size={13} />
                </button>
              </div>
              {(e.emotions || []).length > 0 && (
                <div className="chips" style={{ marginTop: 9 }}>
                  {e.emotions.map((x) => <span key={x} className="chip">{x}</span>)}
                </div>
              )}
              {e.body && <p className="body">{e.body}</p>}
              {e.hasImage && imgs[e.id] && <img src={imgs[e.id]} alt="Chart from this entry" />}
            </div>
          );
        })
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/*  SETTINGS                                                           */
/* ------------------------------------------------------------------ */

function SettingsSheet({ settings, onSave, onClose, onExport, onExportCsv, onImport }) {
  const [s, setS] = useState(settings);
  const fileRef = useRef(null);
  const set = (k) => (e) => setS((p) => ({ ...p, [k]: e.target.value }));

  return (
    <div className="modal" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="sheet" style={{ maxWidth: 560 }} onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheethead">
          <div className="disp" style={{ fontSize: 16 }}>Setup</div>
          <button className="x" onClick={onClose} aria-label="Close"><X size={19} /></button>
        </div>
        <div style={{ padding: 20, display: "flex", flexDirection: "column", gap: 18 }}>
          <label className="f"><span>Journal name</span>
            <input className="in" style={{ fontFamily: "Archivo, sans-serif" }} value={s.name} onChange={set("name")} /></label>

          <div className="grid2" style={{ gap: 12 }}>
            <label className="f"><span>Account size — INR</span>
              <input className="in" inputMode="numeric" value={s.accountINR} onChange={set("accountINR")} /></label>
            <label className="f"><span>Account size — USD</span>
              <input className="in" inputMode="numeric" value={s.accountUSD} onChange={set("accountUSD")} /></label>
          </div>
          <label className="f" style={{ maxWidth: 200 }}><span>Default risk per trade %</span>
            <input className="in" inputMode="decimal" value={s.defaultRiskPct} onChange={set("defaultRiskPct")} /></label>
          <div className="hint" style={{ marginTop: -8 }}>
            Used to pre-fill the position sizer. Risk % on each trade is always computed
            against the account for that trade's currency.
          </div>

          <div style={{ borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
            <div className="eyebrow" style={{ marginBottom: 10 }}>Your data</div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <button className="btn ghost sm" onClick={onExport}><Download size={13} />Full backup (JSON)</button>
              <button className="btn ghost sm" onClick={onExportCsv}><Download size={13} />Trades (CSV)</button>
              <button className="btn ghost sm" onClick={() => fileRef.current && fileRef.current.click()}>
                <Upload size={13} />Restore backup
              </button>
            </div>
            <input ref={fileRef} type="file" accept="application/json" style={{ display: "none" }}
                   onChange={(e) => { const f = e.target.files && e.target.files[0]; if (f) onImport(f); e.target.value = ""; }} />
            <div className="hint" style={{ marginTop: 9 }}>
              Take a JSON backup regularly. It's also what carries your history over when
              this moves to a real database.
            </div>
          </div>

          <div style={{ display: "flex", justifyContent: "flex-end", gap: 10,
                        borderTop: "1px solid var(--rule)", paddingTop: 16 }}>
            <button className="btn ghost" onClick={onClose}>Cancel</button>
            <button className="btn" onClick={() => { onSave(s); onClose(); }}><Check size={14} />Save setup</button>
          </div>
        </div>
      </div>
    </div>
  );
}
