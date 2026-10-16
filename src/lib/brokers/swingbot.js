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
 *   ledger_*.csv        record,symbol,pattern,entry_date,exit_date,entry_price,
 *                       exit_price,quantity,stop_loss,exit_reason,score,
 *                       gate_ok,bars_held,pnl,r_multiple,pct,mae_r,mfe_r
 *
 * The LEDGER is the bot's newer single file: both books in one, a `record`
 * column saying "closed" or "open" on each row, the columns renamed, and —
 * the part that matters — a real stop on every row, closed ones included.
 *
 * So it is the journal kind, like the Champions export: whole positions with
 * their stops, rather than lots to be reassembled. One file at a time, each
 * recognised by its own header.
 *
 * WHERE A FILE STATES THE STOP, IT IS READ STRAIGHT OFF — the open file and
 * the ledger both do, and the ledger's agrees with its own r_multiple to the
 * rounding (GVT&D: (5,257.88 − 4,581.00) × 27 risked, −18,820.98 made, −1.03R).
 *
 * THE OLD CLOSED FILE HAS NO STOP COLUMN, AND DOES NOT NEED ONE. It states `pnl`
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

/**
 * The bot's column names, old and new. The ledger renamed most of them —
 * entry → entry_price, qty → quantity, stop → stop_loss, reason →
 * exit_reason, R → r_multiple — and every read below goes through this, so
 * one parser serves all three files.
 */
const ALIASES = {
  entry: ["entry", "entry_price"],
  exit: ["exit", "exit_price"],
  qty: ["qty", "quantity"],
  stop: ["stop", "stop_loss"],
  reason: ["reason", "exit_reason"],
  r: ["r", "r_multiple"],
};
const has = (h, name) => (ALIASES[name] || [name]).some((n) => h.includes(n));

const CLOSED_MARKS = ["symbol", "entry_date", "exit_date", "entry", "exit", "qty", "pnl", "r"];
const OPEN_MARKS = ["symbol", "entry_date", "entry", "qty", "stop"];
const LEDGER_MARKS = ["record", "symbol", "pattern", "entry_date", "entry", "qty", "stop"];

const head = (rows) => (rows?.[0] || []).map((h) => String(h ?? "").trim().toLowerCase());

/** Which of its files this is, or null. Also the detector. */
export function fileKind(rows) {
  const h = head(rows);
  if (!h.length) return null;
  /* First: the ledger carries every column the other two do, and is told
     apart by the `record` column that says which book each row is in. */
  if (LEDGER_MARKS.every((m) => has(h, m))) return "ledger";
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
  /* Each logical name to the first spelling this file uses. */
  for (const [name, spellings] of Object.entries(ALIASES)) {
    const found = spellings.find((n) => n in at);
    if (found !== undefined) at[name] = at[found];
  }
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
  let costed = 0, costSum = 0, turnoverSum = 0;
  const disagree = [];

  for (let i = 1; i < (rows?.length || 0); i++) {
    const r = rows[i] || [];
    const symbol = String(cell(r, "symbol") ?? "").trim().toUpperCase();
    if (!symbol) continue;

    /* The ledger says per row which book it belongs to; the older files are
       one book each. */
    const record = which === "ledger" ? String(cell(r, "record") ?? "").trim().toLowerCase() : which;
    if (record !== "closed" && record !== "open") {
      warnings.push(`${symbol}: skipped — its record is "${record || "blank"}", not closed or open.`);
      continue;
    }

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

    /* A stated stop, where the file has one: below the entry, since every
       position here is long. */
    const stated = num(cell(r, "stop"));
    const statedOk = stated > 0 && stated < entryPrice;

    if (record === "open") {
      p.stop = statedOk ? stated : 0;
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

    /* The stop: read off where the file states it, otherwise back out of P&L
       and R. See the note at the top. */
    const pnl = num(cell(r, "pnl"));
    const R = num(cell(r, "r"));
    if (statedOk) {
      p.stop = stated;
      /* THE CROSS-CHECK. r_multiple is not imported — R is the journal's own
         arithmetic — but it is the bot's answer to the same sum, so it is
         read once as a witness: net P&L over the risk the stated stop
         implies must land on it. Today they agree to 0.0005R on every row.
         A gap past 0.05R means a stop, a price or a quantity changed between
         the bot and this file — a bug, or a hand edit like the Zerodha files
         whose buy values were typed over and silently corrupted every entry
         price. Said before the button; nothing is refused. */
      const risk = (entryPrice - stated) * quantity;
      if (Number.isFinite(pnl) && Number.isFinite(R) && risk > 0) {
        const mine = pnl / risk;
        if (Math.abs(mine - R) > 0.05) disagree.push(`${symbol} (${entryDate}: file ${R}R, its own stop gives ${mine.toFixed(2)}R)`);
      }
    } else if (Number.isFinite(pnl) && Number.isFinite(R) && Math.abs(R) > 1e-6) {
      const risk = Math.abs(pnl / R);
      const perShare = risk / quantity;
      if (perShare > 0 && perShare < entryPrice) {
        p.stop = round2(entryPrice - perShare);
        reconstructed += 1;
      }
    }

    p.netProfit = Number.isFinite(pnl) ? pnl : round2((exitPrice - entryPrice) * quantity);
    p.exitReason = REASON[String(cell(r, "reason") ?? "").trim().toLowerCase()] || null;

    /* COSTS, WHERE THE FILE'S P&L CARRIES THEM. The old trades.csv was gross —
       its pnl is the price move to the paisa — but the ledger's sits 0.13–0.18%
       of turnover below it on every row, which is India's delivery charges
       (STT alone is 0.1% each way). That gap is the bot's own cost figure, so
       it becomes the trade's charges; importing the ledger at zero would
       overstate every net P&L by a few hundred rupees and make the journal's
       R disagree with the file's r_multiple, which is net. Under 0.05% of
       turnover is rounding — the old file rounds pnl to whole rupees, a few
       rupees on lakhs of turnover, where real charges are at least 0.1% —
       and past 2% is not a cost, so neither is taken. All of it sits on the one sell: the
       bot exits in full, and the total is what derivePosition adds either way. */
    const gross = (exitPrice - entryPrice) * quantity;
    const turnover = (entryPrice + exitPrice) * quantity;
    const cost = Number.isFinite(pnl) ? round2(gross - pnl) : 0;
    const charges = cost >= turnover * 0.0005 && cost < turnover * 0.02 ? cost : 0;
    if (charges) { costed++; costSum += charges; turnoverSum += turnover; }
    p.exits.push({ exit_date: exitDate, price: exitPrice, quantity, charges });
    positions.push(p);
  }

  if (disagree.length) {
    notes.push(
      `Check before importing: on ${disagree.length} trade${disagree.length === 1 ? "" : "s"} the R the ` +
      `file states does not match its own stop, prices and P&L — ${disagree.slice(0, 5).join("; ")}` +
      `${disagree.length > 5 ? `; and ${disagree.length - 5} more` : ""}. Something changed between the ` +
      `bot and this file; the journal will use the stop and prices as written.`
    );
  }
  if (reconstructed) {
    notes.push(
      `${reconstructed} stop${reconstructed === 1 ? "" : "s"} worked back from the P&L and R ` +
      `in this file, since ${which === "ledger" ? "those rows state none" : "it has no stop column"} — ` +
      `right to the paisa, give or take the rounding in R. A stop in the file is read straight off it.`
    );
  }
  /* Costs: taken from the file where its P&L is net of them, and said so;
     otherwise said plainly that there are none, rather than left to be found
     in a figure that is quietly a few thousand light. */
  if (costed) {
    notes.push(
      `Charges on ${costed} closed trade${costed === 1 ? "" : "s"} come from the file itself — the ` +
      `gap between each price move and its P&L, about ${(costSum / turnoverSum * 100).toFixed(2)}% ` +
      `of turnover. That is the bot's own cost estimate, not a contract note.` +
      (positions.some((q) => !q.exits.length)
        ? " Positions still open import with no charges, since the file states costs only on a sale."
        : "")
    );
  } else {
    notes.push("Brokerage and taxes are not in this file, so these trades import with no charges.");
  }

  return { positions, warnings, notes };
}
