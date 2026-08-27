import { test, ok, eq } from "./harness.mjs";

/**
 * The strip chart's label placement, as arithmetic.
 *
 * These two bugs were visible on screen and invisible to everything else: a
 * caption printed straight through the threshold line, and a threshold
 * caption printed straight through the axis label beside it. Both needed a
 * book where every point lands on one side of the line — which is what a real
 * one does and what synthetic data, spread evenly because that is what you
 * write when generating it, never did.
 *
 * The geometry is copied from StripChart rather than imported, because the
 * component is JSX and this is the only part of it worth asserting. If the
 * constants there change, this drifts — so they are named here.
 */
const W = 640, PAD = 34, CH_LBL = 5.4, CH_VAL = 6.2;

function layout({ threshold, points, mid, left, right, past }) {
  const lo = Math.min(...points, threshold) - 0.25;
  const hi = Math.max(...points, 0) + 0.15;
  const x = (v) => PAD + ((v - lo) / (hi - lo)) * (W - PAD * 2);
  const tx = x(threshold);
  const half = (mid.length * CH_LBL) / 2;
  const w = past.length * CH_VAL;
  return {
    tx,
    showLeft: tx - half > PAD + left.length * CH_LBL + 8,
    showRight: tx + half < W - PAD - right.length * CH_LBL - 8,
    pastInsideTint: tx - PAD > w + 12,
  };
}

const STOP = { threshold: -1, points: [-3, -2.4, -1.8, -1.2, -0.9, -0.4, 0],
               mid: "your stop · −1R", left: "bigger losses", right: "break even · 0R",
               past: "14 past your stop" };
const ROUND = { threshold: 1.5, points: [1.6, 1.8, 2, 2.6, 3.4, 3.6, 6.6],
                mid: "risk free · 1.5R", left: "least in front", right: "furthest in front",
                past: "7 reached this, then came back" };
const MAE = { threshold: -1, points: [-1.2, -0.9, -0.8, -0.5, -0.3, -0.1],
              mid: "your stop · −1R", left: "deeper against you",
              right: "never went against you · 0R", past: "2 closed below it and still won" };

test("a mid-axis threshold keeps all three captions", () => {
  const g = layout(STOP);
  ok(g.showLeft, "bigger losses");
  ok(g.showRight, "break even");
});

test("a threshold hard against the left edge drops its neighbour", () => {
  /* Not the threshold caption — that is the one carrying a number. */
  const g = layout(ROUND);
  ok(!g.showLeft, "'least in front' would have printed through 'risk free · 1.5R'");
  ok(g.showRight, "the far side is unaffected");
});

test("the count caption moves out of a tint too narrow to hold it", () => {
  ok(layout(STOP).pastInsideTint, "a wide tint holds its own label");
  ok(!layout(ROUND).pastInsideTint, "a sliver does not — it goes beside the line");
  ok(!layout(MAE).pastInsideTint);
});

/* ---- the scale --------------------------------------------------------- */

function ticks({ threshold, points }) {
  const lo = Math.min(...points, threshold) - 0.25;
  const hi = Math.max(...points, 0) + 0.15;
  const x = (v) => PAD + ((v - lo) / (hi - lo)) * (W - PAD * 2);
  const tx = x(threshold);
  const rough = (hi - lo) / 5;
  const mag = Math.pow(10, Math.floor(Math.log10(rough || 1)));
  const n = rough / mag;
  const step = (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
  const out = [];
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) {
    const r = +v.toFixed(6);
    if (Math.abs(x(r) - tx) < 20) continue;
    out.push(r);
  }
  return out;
}

test("every strip carries a readable scale", () => {
  /* It had none: dots with no values, an axis captioned "furthest in front"
     with no figure on it, and no way to tell 3R from 30R without hovering. */
  for (const [name, spec] of [["stop", STOP], ["round-trip", ROUND], ["mae", MAE]]) {
    const t = ticks(spec);
    ok(t.length >= 2, `${name} needs enough ticks to read a value off, got ${t.length}`);
    ok(t.every((v) => Number.isFinite(v)), `${name} ticks must be numbers`);
  }
});

test("no tick sits on top of the threshold line", () => {
  for (const spec of [STOP, ROUND, MAE]) {
    ok(!ticks(spec).includes(spec.threshold), "that line already prints its own value");
  }
});
