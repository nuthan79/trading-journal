import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { headline } from "@/lib/calc";
import { summaryParts } from "@/lib/dashboard";
import { derivePosition } from "@/lib/positions";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * THE PARAGRAPH AND THE TILE MUST PRINT ONE NET P&L.
 *
 * With the 21 tiles folded away, the summary paragraph became the Dashboard's
 * headline and took on the net P&L in rupees. It used to compute that from
 * finished positions only, while the tile counted every sell — including the
 * part of a position already banked. On a book with a part-sold holding those
 * are two different rupee totals, one above the other.
 */
const mk = (t) => ({ ...t, ...derivePosition(t, 5e6), status: t.status, exits: t.exits });

/* Sold 40 of 100 at 150: 2000 banked on a position still held. */
const PART = mk({ id: "part", symbol: "PART", side: "long", status: "partial",
  entry_date: "2026-06-01", entry_price: 100, quantity: 100,
  stop_loss: 90, stop_source: "recorded", charges: 0, last_price: 200,
  exits: [{ exit_date: "2026-09-10", quantity: 40, price: 150, charges: 0 }] });
const DONE = mk({ id: "done", symbol: "DONE", side: "long", status: "closed",
  entry_date: "2026-06-01", entry_price: 100, quantity: 100,
  stop_loss: 90, stop_source: "recorded", charges: 0,
  exit_date: "2026-09-12", exit_price: 130,
  exits: [{ exit_date: "2026-09-12", quantity: 100, price: 130, charges: 0 }] });

test("with a part-sold position, the paragraph and the tile agree on net P&L", () => {
  const opts = { openingCapital: 5e6, banking: [DONE, PART] };
  const tile = headline([DONE], opts).netPnl;
  const para = summaryParts([DONE], opts).netPnl;
  near(tile, 5000, 0.01, "the tile: both sells");
  near(para, tile, 0.01, "the paragraph must say the same rupees");
});

test("the verdict figures in the paragraph stay on finished positions", () => {
  /* Only the money widens. A part-sold position has not earned a vote on
     the win rate, exactly as on the tile. */
  const s = summaryParts([DONE], { openingCapital: 5e6, banking: [DONE, PART] });
  eq(s.trades, 1);
  eq(s.withR, 1);
});

test("with no banking list, nothing about the paragraph changes", () => {
  near(summaryParts([DONE], { openingCapital: 5e6 }).netPnl, 3000, 0.01);
});

test("the Dashboard hands the paragraph the same banking list as the tiles", () => {
  const dash = read("components/journal/Dashboard.jsx");
  ok(/<Summary closed=\{closed\} banking=\{banking\}/.test(dash));
  ok(/<HeadlineNumbers closed=\{closed\} banking=\{banking\}/.test(dash));
});

/* ---- the fold ------------------------------------------------------ */

test("the tiles are folded by default and the choice is remembered", () => {
  const src = read("components/journal/HeadlineNumbers.jsx");
  ok(/localStorage\.getItem\(OPEN_KEY\) === "1"; \} catch \{ return false; \}/.test(src),
    "closed unless the user opened it, and closed if storage is blocked");
  ok(/\{open && bands\.map/.test(src), "the bands render only when open");
});

test("the stop warnings stay visible with the tiles folded", () => {
  /* They qualify every R figure on the page, the paragraph's included, and
     each links to where it is fixed. */
  const src = read("components/journal/HeadlineNumbers.jsx");
  ok(/\{assumed > 0 && \(/.test(src), "the assumed-stop warning is not gated on open");
  ok(/\{h\.nNeedStop > 0 && \(/.test(src), "nor the missing-stop one");
  ok(!/\{open && assumed > 0/.test(src) && !/\{open && h\.nNeedStop/.test(src));
});
