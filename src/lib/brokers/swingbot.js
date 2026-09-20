/**
 * SwingBot — a backtest/scanner's own two files, not a broker report.
 *
 * `trades.csv` is every position the bot has closed; `open_positions.csv` is
 * what it still holds. Between them they carry more than any broker export
 * can: the pattern that triggered the entry, why the exit fired, and — in the
 * open file — the stop itself.
 *
 *   trades.csv          symbol,pattern,entry_date,exit_date,entry,exit,qty,
 *                       reason,score,gate_ok,bars,pnl,R,pct,mae_R,mfe_R
 *   open_positions.csv  symbol,pattern,entry_date,entry,qty,stop,score,bars,
 *                       mae_R,mfe_R
 *
 * So it is the journal kind, like the Champions export: whole positions with
 * their stops, rather than lots to be reassembled. One file at a time, each
 * recognised by its own header.
 *
 * THE CLOSED FILE HAS NO STOP COLUMN, AND DOES NOT NEED ONE. It states `pnl`
 * and `R`, and R is that P&L over the risk taken — so the risk is pnl/R, the
 * per-share risk is that over the quantity, and the stop is the entry less it.
 * Reconstructed, not invented: it is the bot's own stop, recovered from two of
 * the bot's own numbers. The only loss is rounding — R comes to two decimals,
 * which moves the stop by well under a rupee on these files — and a stop the
 * user can see is a few paise out is worth incomparably more than no stop at
 * all, which would put every closed trade in the /stops queue and leave every
 * R figure derived from a guess. Where pnl or R is missing or zero, nothing is
 * reconstructed and the row arrives stopless, as an honest gap.
 *
 * WHAT IS NOT TAKEN: bars, pct, mae_R and mfe_R. The app derives holding
 * period, percentage return and the excursions from the trade and its daily
 * bars; importing a second copy creates two versions of one number that can
 * disagree, and the imported one is the one nothing recomputes. Score and the
 * gate flag have no column to live in, so they go in the note, where they read
 * as what they are — the bot's own remarks about the setup.
 */

const num = (v) => {
  if (v === null || v === undefined || v === "") return NaN;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[₹,\s]/g, ""));
  return Number.isFinite(n) ? n : NaN;
};

const round2 = (v) => Math.round(v * 100) / 100;

/** ISO only. The bot writes its own dates and writes them one way. */
const toDay = (v) => {
  const m = String(v ?? "").trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  return m ? `${m[1]}-${m[2]}-${m[3]}` : null;
};

/**
 * The bot's pattern names are the app's, in snake_case — with one it does not
 * have. A Darvas box is a real base and naming it "Other" would merge it with
 * everything unclassified, which is exactly the breakdown worth having.
 */
const PATTERN = {
  darvas_box: "Darvas Box",
  high_tight_flag: "High Tight Flag",
  flat_base: "Flat Base",
  cup_handle: "Cup & Handle",
  vcp: "VCP",
  double_bottom: "Double Bottom",
  ascending_base: "Ascending Base",
  pullback: "Pullback Entry",
};

/** Its exit reasons, in the app's words. Anything else is left for the user. */
const REASON = {
  "stop": "Stop hit",
  "time stop": "Time stop",
  "close below 50 sma": "Breached 50 SMA",
  "close below 20 sma": "Breached 20 SMA",
  "target": "Target reached",
  "trailing stop": "Trailing stop",
};

export const id = "swingbot";
export const label = "SwingBot";
export const kind = "journal";

const CLOSED_MARKS = ["symbol", "entry_date", "exit_date", "entry", "exit", "qty", "pnl", "r"];
const OPEN_MARKS = ["symbol", "entry_date", "entry", "qty", "stop"];

const head = (rows) => (rows?.[0] || []).map((h) => String(h ?? "").trim().toLowerCase());

/** Which of its two files this is, or null. Also the detector. */
export function fileKind(rows) {
  const h = head(rows);
  if (!h.length) return null;
  if (CLOSED_MARKS.every((m) => h.includes(m))) return "closed";
  /* `pattern` is required on the open file and absent from every broker
     holdings export, which is what keeps this from claiming one of those. */
  if (OPEN_MARKS.every((m) => h.includes(m)) && h.includes("pattern")) return "open";
  return null;
}

export function detectRows(rows) { return !!fileKind(rows); }

/* CSV only — there is no workbook, and claiming one would have the xlsx path
   hand this adapter a spreadsheet it has never seen. */
export function findSheet() { return null; }
export function detect() { return false; }

const col = (rows) => {
  const h = head(rows);
  const at = {};
  h.forEach((name, i) => { at[name] = i; });
  return at;
};

/**
 * Positions, in the shape `journalImport.toJournalRows` consumes.
 *
 * A closed file yields one exit per position — the bot exits in full — and an
 * open file yields none.
 */
export function parseRows(rows) {
  /* `warnings` means A ROW WAS LOST — the import screen files them under "N
     rows unreadable in the file itself". Anything true of the file as a whole
     goes in `notes`, which is shown plainly. Putting an advisory in warnings
     claims a loss that did not happen and sends somebody hunting for a trade
     that is sitting right there; Groww's charge note did exactly that once. */
  const warnings = [];
  const notes = [];
  const positions = [];
  const which = fileKind(rows);
  if (!which) return { positions, warnings: ["This is not a SwingBot file."], notes };

  const at = col(rows);
  const cell = (r, name) => r[at[name]];
  let reconstructed = 0;

  for (let i = 1; i < (rows?.length || 0); i++) {
    const r = rows[i] || [];
    const symbol = String(cell(r, "symbol") ?? "").trim().toUpperCase();
    if (!symbol) continue;

    const entryDate = toDay(cell(r, "entry_date"));
    const entryPrice = num(cell(r, "entry"));
    const quantity = num(cell(r, "qty"));
    if (!entryDate || !(entryPrice > 0) || !(quantity > 0)) {
      warnings.push(`${symbol || `row ${i + 1}`}: skipped — needs a date, an entry price and a quantity.`);
      continue;
    }

    const patternRaw = String(cell(r, "pattern") ?? "").trim().toLowerCase();
    const score = num(cell(r, "score"));
    const gate = String(cell(r, "gate_ok") ?? "").trim().toLowerCase();
    const notes = [
      "SwingBot",
      patternRaw && !PATTERN[patternRaw] ? patternRaw.replace(/_/g, " ") : null,
      Number.isFinite(score) ? `score ${score}` : null,
      gate === "true" ? "gate met" : gate === "false" ? "gate not met" : null,
    ].filter(Boolean).join(" · ");

    const p = {
      symbol,
      side: "long",
      entryDate,
      entryPrice,
      quantity,
      stop: 0,
      charges: 0,
      netProfit: 0,
      exits: [],
      pattern: PATTERN[patternRaw] || null,
      notes,
    };

    if (which === "open") {
      p.stop = num(cell(r, "stop")) || 0;
      positions.push(p);
      continue;
    }

    const exitDate = toDay(cell(r, "exit_date"));
    const exitPrice = num(cell(r, "exit"));
    if (!exitDate || !(exitPrice > 0)) {
      warnings.push(`${symbol} (${entryDate}): no exit price or date — imported as still open.`);
      positions.push(p);
      continue;
    }

    /* The stop, back out of P&L and R. See the note at the top. */
    const pnl = num(cell(r, "pnl"));
    const R = num(cell(r, "r"));
    if (Number.isFinite(pnl) && Number.isFinite(R) && Math.abs(R) > 1e-6) {
      const risk = Math.abs(pnl / R);
      const perShare = risk / quantity;
      if (perShare > 0 && perShare < entryPrice) {
        p.stop = round2(entryPrice - perShare);
        reconstructed += 1;
      }
    }

    p.netProfit = Number.isFinite(pnl) ? pnl : round2((exitPrice - entryPrice) * quantity);
    p.exitReason = REASON[String(cell(r, "reason") ?? "").trim().toLowerCase()] || null;
    p.exits.push({ exit_date: exitDate, price: exitPrice, quantity, charges: 0 });
    positions.push(p);
  }

  if (reconstructed) {
    notes.push(
      `${reconstructed} stop${reconstructed === 1 ? "" : "s"} worked back from the P&L and R ` +
      `in this file, since it has no stop column — right to the paisa, give or take ` +
      `the rounding in R. Add a stop column to trades.csv and they will be read straight off it.`
    );
  }
  /* The bot states no costs, and its P&L is gross. Said once here rather than
     left to be discovered in a figure that is quietly a few thousand light. */
  notes.push("Brokerage and taxes are not in this file, so these trades import with no charges.");

  return { positions, warnings, notes };
}
