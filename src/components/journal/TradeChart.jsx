"use client";

/**
 * One trade, drawn on its own price history.
 *
 * WHY LIGHTWEIGHT CHARTS AND NOT HAND-ROLLED SVG. The wall was going to be
 * hand-rolled — two <path> elements per chart, a hundred DOM nodes for
 * twenty-four of them — and the objection to a library was that it builds a
 * canvas, a resize observer and a chart object per instance, which is a lot to
 * do twenty-four times. That was a guess. The measurement is in the commit
 * message; the library won on everything except instance count, and the
 * instance count turned out not to matter at this size.
 *
 * What it buys that hand-rolling would have cost days to match: price lines
 * pinned to the axis with their own tags, a crosshair with an OHLC readout,
 * log scale, and autoscaling that already knows what to do with a gap.
 *
 * WHAT THE LIBRARY IS NOT ALLOWED TO DECIDE. Two things are forced rather than
 * left to it, because the wall exists to make charts COMPARABLE:
 *
 *   The window. Every chart shows the same shape of window — about three
 *   months before entry, six weeks after the exit, or up to today while the
 *   position is open. Left to `fitContent` alone a two-day trade and a
 *   two-year one would be drawn at the same width and read as the same thing.
 *
 *   The scale. Logarithmic, always, and not as a preference: on a stock that
 *   ran 600 to 920 a linear axis makes the same 10% move half as tall at the
 *   bottom as at the top, so two moves that cost the same in R get drawn at
 *   different sizes — exactly the comparison this screen is for.
 *
 * The module is imported dynamically. It is ~190KB and nobody who never opens
 * the Charts tab should pay for it on first load.
 */

import { useEffect, useRef, useState } from "react";
import { dmy } from "@/lib/format";
import { overlays, hasBars } from "@/lib/candles";

/* Loaded once for the whole wall, not once per chart. Twenty-four charts
   mounting together would otherwise fire twenty-four dynamic imports; they
   resolve to the same module, but the promise is cached here so the first
   paint does not wait on twenty-three redundant resolutions. */
let libPromise = null;
const lib = () => (libPromise ||= import("lightweight-charts"));

const CSS = (name, fallback) => {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(name);
  return v?.trim() || fallback;
};

export default function TradeChart({ trade, bars, height = 220, compact = false }) {
  const box = useRef(null);
  const [err, setErr] = useState("");
  const [hover, setHover] = useState(null);

  useEffect(() => {
    if (!box.current || !hasBars(bars)) return;
    let chart = null, dead = false;

    (async () => {
      let mod;
      try { mod = await lib(); }
      catch { if (!dead) setErr("The chart library did not load."); return; }
      if (dead || !box.current) return;

      const { createChart, CandlestickSeries, HistogramSeries, createSeriesMarkers } = mod;
      const ink3 = CSS("--ink3", "#7C8B87");
      const grid = CSS("--grid", "#CFD8D4"), rule = CSS("--rule", "#DCE3E0");
      const long = CSS("--long", "#0F7A63"), short = CSS("--short", "#A83E27");
      const card = CSS("--card", "#FBFCFB");

      chart = createChart(box.current, {
        height,
        layout: { background: { color: card }, textColor: ink3, fontSize: compact ? 9 : 11,
                  attributionLogo: false },
        grid: { vertLines: { color: rule }, horzLines: { color: rule } },
        rightPriceScale: {
          visible: !compact,          // the labels are illegible at thumbnail size anyway
          borderColor: grid,
          /* Room at the bottom for the volume histogram, which shares the pane
             rather than getting one of its own — a separate pane would halve
             the price chart on a thumbnail. */
          scaleMargins: { top: 0.08, bottom: 0.26 },
          mode: 1,                    // logarithmic. See the note above.
        },
        timeScale: { borderColor: grid, visible: !compact, fixLeftEdge: true },
        crosshair: { mode: 0 },
        handleScroll: false,          // the window is the point; panning off it loses the trade
        handleScale: false,
      });

      const candles = chart.addSeries(CandlestickSeries, {
        upColor: long, downColor: short, borderUpColor: long, borderDownColor: short,
        wickUpColor: long, wickDownColor: short,
        priceLineVisible: false, lastValueVisible: !compact,
      });
      candles.setData(bars.map((b) => ({
        time: b.d,
        open: b.o ?? b.c, high: b.h ?? b.c, low: b.l ?? b.c, close: b.c,
      })));

      /* Volume in the same pane, pinned to the bottom quarter. Coloured by the
         same rule as the candle above it, so a heavy day reads as heavy
         buying or heavy selling rather than just as activity. */
      if (bars.some((b) => b.v != null)) {
        const vol = chart.addSeries(HistogramSeries, {
          priceFormat: { type: "volume" }, priceScaleId: "vol",
          priceLineVisible: false, lastValueVisible: false,
        });
        chart.priceScale("vol").applyOptions({
          scaleMargins: { top: 0.78, bottom: 0 }, visible: false,
        });
        vol.setData(bars.map((b, i) => ({
          time: b.d,
          value: b.v ?? 0,
          color: (b.c >= (i > 0 ? bars[i - 1].c : b.o ?? b.c) ? long : short) + "55",
        })));
      }

      const o = overlays(trade, bars);

      /* Price lines carry their own axis tag, which is the thing worth having
         from this library: the number sits where the eye already goes for
         price and cannot collide with a candle — the fault visible in the
         reference screenshots, where "Entry@1096" ran into the SL tag. */
      if (o.entry) {
        candles.createPriceLine({ price: o.entry.price, color: ink3, lineWidth: 1,
          lineStyle: 2, axisLabelVisible: !compact, title: compact ? "" : "entry" });
      }
      if (o.stop != null) {
        candles.createPriceLine({ price: o.stop, color: short, lineWidth: 1,
          lineStyle: 2, axisLabelVisible: !compact, title: compact ? "" : "stop" });
      }
      /* An assumed stop is dotted and unlabelled — the importer invented it,
         and drawing it like a decision would put a number in the trader's
         mouth on a chart they are reading to judge that decision. */
      if (o.assumedStop != null) {
        candles.createPriceLine({ price: o.assumedStop, color: ink3, lineWidth: 1,
          lineStyle: 1, axisLabelVisible: false, title: "" });
      }

      /* EVERY EXIT. A 55%-closed position is two moments, not one. */
      /**
       * IN and OUT, and nothing else but the share.
       *
       * The price was tried under each arrow and taken out: the arrow already
       * points AT the candle whose price it would repeat, so the number
       * annotated something the chart was showing anyway — and it did it by
       * covering the candles either side. The entry and stop levels are on the
       * axis where prices belong.
       *
       * The share stays, because that is the one thing the chart cannot say by
       * pointing: two arrows look identical whether the position came off in
       * halves or ninety-ten. Only where there was more than one tranche —
       * "100%" on a single exit is noise.
       */
      const markers = [];
      if (o.entry?.time) {
        markers.push({ time: o.entry.time, position: "belowBar", color: long,
                       shape: "arrowUp", text: compact ? "" : "IN" });
      }
      o.exits.forEach((e, i) => {
        const share = o.exitShare[i];
        const part = isFinite(share) && o.exits.length > 1 ? ` ${Math.round(share)}%` : "";
        markers.push({
          time: e.time, position: "aboveBar", color: short, shape: "arrowDown",
          text: compact ? "" : `OUT${part}`,
        });
      });
      if (markers.length) createSeriesMarkers(candles, markers);

      /**
       * EMPTY SESSIONS AT THE RIGHT, AND SET AS A RANGE RATHER THAN AS AN
       * OFFSET.
       *
       * A price line's title is drawn from the axis leftward INTO the plot, so
       * with the last candle flush against the axis "entry" and "stop" sat on
       * top of the final week of price — exactly where the eye goes to see how
       * the trade ended.
       *
       * The first attempt set `rightOffset` and it did nothing, because
       * fitContent() runs after it and fits the data to the full width, which
       * is precisely the thing the offset was asking not to happen. Setting
       * the logical range says both at once: show every bar, and leave this
       * many bar-widths blank after the last one. `fixRightEdge` had to go
       * with it — it clamps the view to the last bar, which is the same
       * override wearing a different name.
       */
      /**
       * THE GAP IS SIZED IN PIXELS, THEN CONVERTED TO BARS.
       *
       * A price line's title is a fixed lump of text — "entry 1622.41" is
       * about ninety pixels wide whatever the chart is showing. Reserving a
       * number of BARS instead was the mistake: twelve bars is a comfortable
       * gap on a book of forty sessions and twenty-four pixels on a book of a
       * hundred and eighty, which is how the tags were still sitting on the
       * candles after the first fix.
       *
       * Solving `pad * width / (n + pad) = tagPx` for pad gives the number of
       * bar-widths that comes to tagPx on THIS chart at THIS width. Recomputed
       * inside fit(), because the answer changes with the width.
       */
      const tagPx = compact ? 6 : 92;

      /* The OHLC readout, which is the other thing the library gives for
         nothing. Only where there is room to print it. */
      if (!compact) {
        chart.subscribeCrosshairMove((param) => {
          const d = param.seriesData?.get(candles);
          setHover(d && param.time ? { ...d, time: param.time } : null);
        });
      }

      /**
       * THE RANGE IS RE-APPLIED ON EVERY RESIZE, not set once.
       *
       * Lightweight Charts keeps BAR SPACING across a width change, not the
       * visible range — so a chart that grew wider went on drawing its bars at
       * the old pitch and let the extra width become blank space. On a window
       * resize that turned the modest strip reserved for the tags into most of
       * the plot, with the candles crushed into the left third.
       *
       * Cheap to redo, and it means the reserved strip stays proportional at
       * every width rather than only at the one it happened to mount at.
       */
      const fit = () => {
        if (!box.current) return;
        const w = box.current.clientWidth;
        chart.applyOptions({ width: w });
        const pad = Math.max(2,
          Math.round((tagPx * bars.length) / Math.max(w - tagPx, 80)));
        chart.timeScale().setVisibleLogicalRange({ from: -0.5, to: bars.length - 1 + pad });
      };
      const ro = new ResizeObserver(fit);
      ro.observe(box.current);
      fit();
      chart.__ro = ro;
    })();

    return () => {
      dead = true;
      /* remove() takes the canvas, the listeners and the observer with it.
         Skipping this is how a wall that is paged through twenty times ends
         up holding twenty walls' worth of charts. */
      if (chart) { chart.__ro?.disconnect(); chart.remove(); }
    };
  }, [trade, bars, height, compact]);

  if (!hasBars(bars)) return null;

  return (
    <div className="tc-wrap">
      <div ref={box} className="tc-box" style={{ height }} />
      {err && <div className="tc-err">{err}</div>}
      {hover && (
        <div className="tc-ohlc mono">
          <span>{dmy(hover.time)}</span>
          <span>O {hover.open?.toFixed(2)}</span>
          <span>H {hover.high?.toFixed(2)}</span>
          <span>L {hover.low?.toFixed(2)}</span>
          <span>C {hover.close?.toFixed(2)}</span>
        </div>
      )}
      <style jsx>{`
        .tc-wrap { position: relative; }
        /* The plot gets its own hairline. Without it the candles bleed into
           the card edge and a wall of them reads as one field of ticks rather
           than as a row of separate charts. */
        .tc-box { width: 100%; border: 1px solid var(--rule); border-radius: 2px;
          overflow: hidden; background: var(--card); }
        .tc-ohlc { position: absolute; top: 4px; left: 6px; display: flex; gap: 9px;
          font-size: 10px; color: var(--ink2); background: var(--card);
          padding: 2px 6px; border-radius: 2px; pointer-events: none;
          border: 1px solid var(--rule); }
        .tc-err { position: absolute; inset: 0; display: grid; place-items: center;
          font-size: 11px; color: var(--ink3); }
      `}</style>
    </div>
  );
}
