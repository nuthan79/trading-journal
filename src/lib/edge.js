/**
 * "Where the edge is" — the setup breakdown.
 *
 * Same closed trades, sliced a different way each time. Expectancy is the
 * column that decides anything; total R tells you how much that expectancy has
 * actually been worth given how often the slice came up.
 *
 * CONTINUOUS DIMENSIONS USE ADAPTIVE BANDS.
 *
 * Fixed bands fail in both directions. Set them wide and every trade lands in
 * one row -- the old "0.5-1%" risk band swallowed a whole journal and said
 * nothing. Set them narrow and each row holds too few trades to read.
 *
 * So the bands are cut from your own distribution instead: split the recorded
 * values into groups of roughly equal size and label them with the real
 * ranges. Rows stay populated whatever your habits are, and when your
 * discipline tightens the bands follow you down.
 *
 * Categorical dimensions -- pattern, exit reason, stage -- are left alone.
 */

import { stats } from "./calc";

const n = (v) => (v === "" || v == null ? NaN : Number(v));
const mean = (a) => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : NaN);

export const NOT_RECORDED = "Not recorded";

/* ==================================================================== */
/*  Adaptive banding                                                    */
/* ==================================================================== */

/**
 * How many bands the sample can support.
 *
 * Roughly fifteen trades per band. Below that a single outlier moves the row,
 * and a table that moves on one trade isn't telling you about your system.
 */
export function bandCountFor(sampleSize, max = 5) {
  return Math.max(2, Math.min(max, Math.floor(sampleSize / 15) || 2));
}

/**
 * Cut points at equal-count intervals. Duplicates are dropped, so a heavily
 * tied distribution simply yields fewer bands rather than empty ones.
 */
function quantileCuts(sortedAsc, k) {
  const cuts = [];
  for (let i = 1; i < k; i++) {
    const idx = Math.min(sortedAsc.length - 1, Math.floor((sortedAsc.length * i) / k));
    const v = sortedAsc[idx];
    if (!cuts.length || v > cuts[cuts.length - 1]) cuts.push(v);
  }
  return cuts;
}

const fmtNum = (v, dp) => {
  const s = v.toFixed(dp);
  return dp > 0 ? s.replace(/\.?0+$/, "") : s;
};

/**
 * Build a labeller for one continuous dimension from the values present.
 *
 * Returns { label(v), order(label), bands }. `order` keeps the table in
 * ascending band sequence rather than sorted by outcome, so a stop-width
 * table reads as a progression instead of a leaderboard.
 */
export function adaptiveBander(values, { k, unit = "", dp = 1 } = {}) {
  const scale = Math.pow(10, dp);
  const step = 1 / scale;
  /**
   * Band on the values as they are shown, not as they are stored.
   *
   * A stop filled at 18% of entry is stored as a price rounded to the paisa,
   * so 1070 trades meant to share one stop width actually spread from 17.9758
   * to 18.0236. Quantile cuts then landed at 17.999, 18.000, 18.001 and 18.002
   * — four boundaries inside a twentieth of a percent, indistinguishable once
   * printed at one decimal. They collapsed to the same label and the groups
   * merged behind it, which is how a band reading "2.2-17.9%" came to hold 216
   * trades: twelve real stops and two hundred assumed ones that rounded a hair
   * low. The table looked like a finding and was an artefact of float noise.
   *
   * Rounding first makes the bands mean what the labels say. Differences
   * below display precision are not differences a reader can act on.
   */
  const shown = (v) => Math.round(v * scale) / scale;

  const clean = values.filter((v) => isFinite(v)).map(shown).sort((a, b) => a - b);
  if (clean.length < 2) {
    return { label: () => NOT_RECORDED, order: () => 0, bands: [] };
  }

  const count = k || bandCountFor(clean.length);
  const cuts = quantileCuts(clean, count);
  const edges = [clean[0], ...cuts, clean[clean.length - 1]];

  /**
   * Labels that match how the bands actually work.
   *
   * A band holds [lo, hi) — a 42-day trade goes in the band starting at 42,
   * not the one ending there. Printing both ends verbatim gave "0-42 d" and
   * "42-106 d", which claim the same day twice and leave no way to tell which
   * one owns it. Showing the top as one step below the next band's floor is
   * the same bucketing, described honestly: 0-41, 42-105, 106-274.
   *
   * The last band is closed, so it keeps the real maximum.
   *
   * A band whose ends meet is a single value, not a range — that happens when
   * one number dominates the column, as an assumed stop does. "18-18%" reads
   * like a bug; "18%" is what it is.
   */
  const bands = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lo = shown(edges[i]);
    const hi = edges[i + 1];
    const last = i === edges.length - 2;
    const top = last ? shown(hi) : shown(hi) - step;
    const point = top <= lo;   // the ends meet: one value, not a range
    // An en dash reads as a range where a hyphen fights the minus sign, and
    // where either end is negative even that isn't enough: "-4--1%" is not a
    // thing anyone should have to parse.
    const sep = lo < 0 || top < 0 ? " to " : "–";
    bands.push({
      i, lo: edges[i], hi,
      /*
        The bounds a filter must use — CLOSED, and in display space.

        `lo`/`hi` above are the raw cut points and are half-open: a value equal
        to `hi` belongs to the NEXT band. Filtering on those would put a trade
        sitting exactly on a boundary into two buckets at once. `fLo`/`fHi` are
        the pair the label actually claims — the same numbers a reader sees —
        so a filter built from them selects precisely the trades the row
        counted. fixedBander exposes the same two names with the same meaning,
        which is what lets one comparison serve both kinds of band.
      */
      fLo: lo, fHi: top,
      label: point
        ? `${fmtNum(lo, dp)}${unit}`
        : `${fmtNum(lo, dp)}${sep}${fmtNum(top, dp)}${unit}`,
    });
  }

  const orderOf = new Map(bands.map((b) => [b.label, b.i]));

  return {
    bands,
    label(v) {
      if (!isFinite(v)) return NOT_RECORDED;
      // Rounded the same way the edges were, or a value a hair under a cut
      // lands in the band below the one its printed form belongs to.
      const r = shown(v);
      let i = 0;
      while (i < cuts.length && r >= cuts[i]) i++;
      return bands[Math.min(i, bands.length - 1)].label;
    },
    order(label) {
      return orderOf.has(label) ? orderOf.get(label) : 999;
    },
  };
}

/* ==================================================================== */
/*  Fixed bands                                                         */
/* ==================================================================== */

/**
 * How long a trade was held, in the units people actually think in.
 *
 * This is the one continuous column where adaptive bands are the wrong tool.
 * Everywhere else -- stop width, risk taken, RS -- there is no universal
 * scale, so bands cut from your own distribution are the only ones that mean
 * anything. Days are different: everyone already knows what six months is,
 * and nobody knows what "503-1781 d" is. Worse, quantile bands re-cut
 * themselves as you trade, so this quarter's third band is not last quarter's
 * third band and the table can't be compared against its own past.
 *
 * The steps widen as they go, because the difference between three days and
 * ten matters and the difference between three years and four does not.
 *
 * Bands nobody landed in never become rows -- the rows are built from the
 * trades, not from this list -- so a journal with forty trades in it shows
 * three or four rows rather than ten, most of them empty.
 */
export const HOLD_BANDS = [
  { max: 5, label: "0–5 d" },
  { max: 15, label: "6–15 d" },
  { max: 30, label: "16–30 d" },
  { max: 45, label: "31–45 d" },
  { max: 60, label: "46–60 d" },
  { max: 90, label: "61–90 d" },
  { max: 180, label: "3–6 months" },
  { max: 365, label: "6–12 months" },
  { max: 730, label: "1–2 years" },
  { max: Infinity, label: "2 years+" },
];

/**
 * Round money bands, stepped, covering whatever was actually risked.
 *
 * A tenth of a lakh means the same thing to everyone in rupees and nothing
 * like the same thing as a bet — so this is the one continuous dimension where
 * fixed edges are what the trader asked for and adaptive quantiles would be
 * unreadable ("₹13.4k–₹19.7k" is a cut point, not a category anyone thinks in).
 *
 * The STEP is chosen from the data rather than hardcoded. ₹10k bands are right
 * for an account risking ₹15–25k a trade and useless either way outside that:
 * a ₹2L account risking ₹1,500 puts every trade in the first band, and one
 * risking ₹2L a trade would need forty rows. Picking the roundest step that
 * lands near seven bands keeps the shape readable at any size, and for a book
 * risking tens of thousands it lands on ₹10k by itself.
 *
 * THE CAVEAT THIS CANNOT FIX, and the UI says it out loud: rupee risk is not
 * comparable across a growing account. ₹15k risked against ₹20L is a large
 * bet; the same ₹15k against ₹1.2Cr is a small one. Sorted into fixed bands
 * over a record where capital grew tenfold, the low bands fill with early
 * trades and the high bands with recent ones, so the table is partly reading
 * WHEN rather than HOW MUCH. The "Risk % of capital" tab beside it has no such
 * problem, which is why both exist.
 */
const STEPS = [250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000];

/** Band edges read better trimmed — "₹10k" not "₹10.0k". */
const edge = (v) => {
  if (v >= 1e7) return `₹${(v / 1e7).toFixed(2).replace(/\.?0+$/, "")}Cr`;
  if (v >= 1e5) return `₹${(v / 1e5).toFixed(2).replace(/\.?0+$/, "")}L`;
  if (v >= 1e3) return `₹${(v / 1e3).toFixed(1).replace(/\.?0+$/, "")}k`;
  return `₹${Math.round(v)}`;
};

export function moneyBands(values, { target = 7 } = {}) {
  const vals = values.filter((v) => isFinite(v) && v > 0);
  if (!vals.length) return [{ max: Infinity, label: NOT_RECORDED }];

  const hi = Math.max(...vals);
  const step = STEPS.find((sp) => hi / sp <= target) || STEPS[STEPS.length - 1];

  const out = [];
  for (let lo = 0; lo < hi; lo += step) {
    out.push({
      max: lo + step,
      label: lo === 0 ? `under ${edge(step)}` : `${edge(lo)} – ${edge(lo + step)}`,
    });
  }
  // The top band is open-ended so nothing falls off the end of the table.
  if (out.length) out[out.length - 1].max = Infinity;
  else out.push({ max: Infinity, label: `under ${edge(step)}` });
  return out;
}

/**
 * Same interface as `adaptiveBander`, over a list you supply. `max` is the
 * last value that belongs to the band, so the labels can be read literally:
 * a 15-day trade is in "6-15 d" and a 16-day one is not.
 */
export function fixedBander(spec) {
  const bands = spec.map((b, i) => {
    const lo = i === 0 ? -Infinity : spec[i - 1].max + 1;
    return {
      i, lo, hi: b.max,
      /*
        EXCLUSIVE lower bound, matching what `label()` below actually does:
        it takes the first band whose `max` the value does not exceed, so a
        band owns everything above the previous band's max.

        `lo` beside it is `prev.max + 1`, which reads correctly in a label
        ("6–15 d") and is wrong as a filter the moment values are not whole
        numbers — a ₹7,500.50 risk is labelled into the band above ₹7,500 and
        would fail a `>= 7501` test, leaving one trade out of a list its own
        row had counted. Days are integers and rupees are not, and the same
        bander serves both.
      */
      fLo: i === 0 ? -Infinity : spec[i - 1].max, fHi: b.max,
      label: b.label,
    };
  });
  const orderOf = new Map(bands.map((b) => [b.label, b.i]));

  return {
    bands,
    label(v) {
      if (!isFinite(v)) return NOT_RECORDED;
      const b = bands.find((x) => v <= x.hi);
      return (b || bands[bands.length - 1]).label;
    },
    order(label) {
      return orderOf.has(label) ? orderOf.get(label) : 999;
    },
  };
}

/* ==================================================================== */
/*  Dimensions                                                          */
/* ==================================================================== */

/**
 * `continuous` dimensions supply a numeric `value()`. They get adaptive bands
 * cut from the data unless they name a `fixed` list, which is for units that
 * already mean something to a reader. Categorical ones supply `get()` and are
 * grouped as-is.
 */
export const DIMENSIONS = [
  { id: "pattern", label: "Base pattern",
    get: (t) => t.pattern || NOT_RECORDED },

  { id: "dist", label: "Extension at entry", continuous: true, unit: "%", dp: 1,
    value: (t) => t.distPivot },

  { id: "vol", label: "Breakout volume", continuous: true, unit: "%", dp: 0,
    value: (t) => n(t.vol_pct_avg) },

  { id: "sl", label: "Stop width", continuous: true, unit: "%", dp: 1,
    value: (t) => t.slPct },

  { id: "risk", label: "Risk % of capital", continuous: true, unit: "%", dp: 2,
    value: (t) => t.riskPct },

  // The same question in money. See moneyBands for why this one is banded on
  // fixed edges while every other continuous dimension is banded adaptively.
  { id: "riskamt", label: "Risk in rupees", continuous: true, money: true,
    fixed: (closed) => moneyBands(closed.map((t) => t.riskAmt)),
    value: (t) => t.riskAmt },

  { id: "rs", label: "RS rank", continuous: true, unit: "", dp: 0,
    value: (t) => n(t.rs_rank) },

  { id: "hold", label: "Holding period", continuous: true, fixed: HOLD_BANDS,
    value: (t) => t.heldDays },

  { id: "stage", label: "Weinstein stage",
    get: (t) => (t.weinstein_stage ? `Stage ${t.weinstein_stage}` : NOT_RECORDED) },

  { id: "exit", label: "Exit reason",
    get: (t) => t.exit_reason || NOT_RECORDED },

  { id: "month", label: "Month",
    get: (t) => (t.exit_date || t.entry_date || "").slice(0, 7) || "-" },
];

/* ==================================================================== */
/*  Rows                                                                */
/* ==================================================================== */

/**
 * Rows for the edge table.
 *
 * Continuous dimensions come back in band order -- low to high -- because the
 * question is usually "does this get better or worse as the value rises", and
 * sorting by outcome destroys exactly that reading. Categorical dimensions
 * sort by contribution, where there is no natural sequence.
 */
export function dimensionRows(closed, dimensionId, { accountSize = 0, bands } = {}) {
  const dim = DIMENSIONS.find((d) => d.id === dimensionId) || DIMENSIONS[0];

  let labelOf, orderOf = null, bandInfo = [];

  if (dim.continuous) {
    const spec = typeof dim.fixed === "function" ? dim.fixed(closed) : dim.fixed;
    const bander = spec
      ? fixedBander(spec)
      : adaptiveBander(closed.map(dim.value), { k: bands, unit: dim.unit, dp: dim.dp });
    labelOf = (t) => bander.label(dim.value(t));
    orderOf = bander.order;
    bandInfo = bander.bands;
  } else {
    labelOf = dim.get;
  }

  const groups = new Map();
  for (const t of closed) {
    const k = labelOf(t);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(t);
  }

  /* Band edges by label, so a row can carry the numbers behind its own name.
     See `edgeFilterFor` below for why the numbers and not the name travel. */
  const edges = new Map(bandInfo.map((b) => [b.label, b]));

  const rows = [...groups.entries()].map(([key, trades]) => {
    const s = stats(trades);
    const band = edges.get(key) || null;
    const values = trades.map((t) => t.exposure).filter(isFinite);
    const risks = trades.map((t) => t.riskAmt).filter(isFinite);
    const pnls = trades.map((t) => t.pnl).filter(isFinite);
    const avgRisk = mean(risks);
    const netPnl = pnls.reduce((a, b) => a + b, 0);

    return {
      ...s,
      key,
      /* The numeric edges of this row's band, for continuous dimensions only.
         Null on categorical rows and on NOT_RECORDED, both of which are
         matched by name rather than by range. */
      lo: band ? band.fLo : null,
      hi: band ? band.fHi : null,
      trades: trades.length,
      netPnl,
      avgValue: mean(values),
      totalValue: values.reduce((a, b) => a + b, 0),
      avgRisk,
      avgRiskPct: accountSize > 0 && isFinite(avgRisk) ? (avgRisk / accountSize) * 100 : NaN,
      avgSlPct: mean(trades.map((t) => t.slPct).filter(isFinite)),
      returnOnRisk: avgRisk > 0 && trades.length ? netPnl / (avgRisk * trades.length) : NaN,
    };
  });

  if (orderOf) {
    rows.sort((a, b) => orderOf(a.key) - orderOf(b.key));
  } else {
    rows.sort((a, b) => {
      if (a.key === NOT_RECORDED) return 1;
      if (b.key === NOT_RECORDED) return -1;
      return b.totalR - a.totalR;
    });
  }

  return Object.assign(rows, { continuous: !!dim.continuous, bands: bandInfo });
}

export const maxAbsTotalR = (rows) =>
  Math.max(...rows.map((r) => Math.abs(r.totalR || 0)), 1);

/**
 * Slices too small to mean anything. Fifteen is not a statistical threshold so
 * much as the point below which one trade stops moving the row.
 */
export const THIN_SLICE = 15;
export const isThin = (row) => row.trades < THIN_SLICE;

/* ==================================================================== */
/*  Reaching the trades behind a row                                    */
/* ==================================================================== */

/**
 * The query that takes a row on the edge table to the trades inside it.
 *
 * WHY THE NUMBERS TRAVEL AND NOT THE LABEL. Six of the ten dimensions are cut
 * into ADAPTIVE quantile bands — "0.01–0.11%" is not a threshold anybody
 * chose, it is wherever the quintile happened to fall for this particular set
 * of trades. Sending that label to the trades screen and asking it to work out
 * what it meant would require recomputing the same quantiles over the same
 * set, and the trades screen holds a different set: it lists open positions
 * too. The bands would shift, and the row would send you to trades it never
 * counted. Silently, and only for some buckets.
 *
 * So the band is resolved to real numbers HERE, where it was cut, and the URL
 * carries `lo` and `hi`. The trades screen then does arithmetic a child could
 * check, with no notion of a quantile at all.
 *
 * `NOT_RECORDED` is matched by name in both kinds, because "this field is
 * blank" is not a range.
 */
export function edgeFilterFor(dimensionId, row) {
  const q = { dim: dimensionId };
  if (row.key === NOT_RECORDED || row.lo == null || row.hi == null) {
    q.key = row.key;
  } else {
    q.lo = String(row.lo);
    q.hi = String(row.hi);
    /* The row's own label, carried for the banner and nothing else — never
       parsed back. Rebuilding "₹5k – ₹7.5k" or "0–5 d" from lo/hi meant a
       second formatter that had to know about money, units and open-ended
       bands, and it already disagreed with the table ("up to 5" for "0–5 d").
       Sending the string the row printed makes the two impossible to
       diverge. */
    q.band = row.key;
  }
  return q;
}

/** The same query as a `/trades` href. One place builds these. */
export function edgeHref(dimensionId, row) {
  const q = edgeFilterFor(dimensionId, row);
  return `/trades?${new URLSearchParams(q).toString()}`;
}

/**
 * Does this trade belong to that filter?
 *
 * Deliberately reuses each dimension's own `value()` / `get()`, so the
 * membership test on the trades screen is the identical function that put the
 * trade in the bucket in the first place. Two implementations of "what counts
 * as a 2.5% stop" would eventually disagree, and the disagreement would show
 * as a row claiming 26 trades and a list showing 24.
 */
export function matchesEdgeFilter(t, { dim, key, lo, hi } = {}) {
  const d = DIMENSIONS.find((x) => x.id === dim);
  if (!d) return true;

  if (d.continuous) {
    const v = d.value(t);
    if (key === NOT_RECORDED) return !isFinite(v);
    if (!isFinite(v)) return false;
    /*
      Round exactly as this dimension's bander did, and not otherwise.

      adaptiveBander cuts its bands on DISPLAY values — a stop stored as
      17.9758 reads as 18.0, and the row that counted it is labelled "18%", so
      the filter has to round before comparing or it drops trades the row
      promised. fixedBander does the opposite: its edges are round numbers and
      it tests the raw value, so ₹7,500.40 belongs above ₹7,500 and rounding
      would pull it down a band.

      `d.fixed` is precisely the flag for which bander ran, so it is also the
      right flag for which comparison to use. Getting this wrong is not a
      crash — it is a row saying 22 trades and the list showing 23.
    */
    // -Infinity and Infinity survive String() and Number() intact, so the
    // open-ended first and last bands need no special case.
    const a = Number(lo), b = Number(hi);
    // Fixed bands are (lo, hi] — exclusive below, per `label()`. Adaptive
    // bands are [lo, hi] on the rounded value, per the label they print.
    if (d.fixed) return v > a && v <= b;
    const scale = Math.pow(10, d.dp ?? 0);
    const r = Math.round(v * scale) / scale;
    return r >= a && r <= b;
  }
  return d.get(t) === key;
}

/** What the trades screen says it is showing. Built from the same pieces, so
 *  the banner cannot describe one filter while another is applied. */
export function describeEdgeFilter({ dim, key, band } = {}) {
  const d = DIMENSIONS.find((x) => x.id === dim);
  if (!d) return null;
  return { label: d.label, value: key != null ? key : band };
}
