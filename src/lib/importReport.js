/**
 * What an import decided, in a form that survives the screen.
 *
 * WHY THIS EXISTS. Every reason a row did not arrive is explained once, on the
 * preview, in the seconds before somebody presses the button — and that is
 * exactly when nobody is reading. They confirm, go to their trades, and the
 * explanation is gone.
 *
 * The question turns up later and in a different shape: not "what happened on
 * the fourteenth" but "I hold PTC, where is it?". So this records the outcome
 * PER SYMBOL, because that is the unit the question is asked in. A log
 * organised by import would still have to be read through; a record organised
 * by symbol can be searched.
 *
 * DELIBERATELY NOT A SECOND HISTORY SCREEN. `import_batches` and the Import
 * History already exist and are already where somebody goes to ask what an
 * import did. Two places to look would mean neither is trusted.
 */

/**
 * The cap, and it is a real constraint rather than a formality.
 *
 * This lands in a jsonb column that is read every time the Import page opens,
 * for every batch. A thousand-trade file listing every symbol twice would put
 * a megabyte in a row nobody asked to download. Issues are never truncated —
 * they are the answer somebody is looking for and there are rarely many. The
 * imported list is, because it is the reassuring half and a count carries most
 * of its value.
 */
const MAX_IMPORTED = 400;
const MAX_ISSUES = 300;

const up = (s) => String(s || "").toUpperCase();

/** Unique, in first-seen order — a symbol split across four lots is one name. */
function uniq(list) {
  const seen = new Set();
  const out = [];
  for (const s of list) {
    const k = up(s);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(k);
  }
  return out;
}

/**
 * One outcome per symbol, with the sentence that explains it.
 *
 * `why` is written here rather than assembled in the UI so the stored record
 * is readable on its own — someone reading the row in the database, or an
 * export of it, gets the reason and not a code to look up.
 */
const issue = (s, o, why) => ({ s: up(s), o, why });

/**
 * Drops anything that lost its symbol on the way in.
 *
 * A nameless outcome is unsearchable, which is this file's entire purpose, and
 * showing "" in a list of skipped stocks reads as a bug rather than an
 * explanation. Better absent than blank.
 */
const named = (list) => list.filter((x) => x.s);

/**
 * Build the report for a finished preview.
 *
 * Takes the same `parsed` object the screen renders, so there is no second
 * derivation to drift from what the user was actually shown.
 */
export function buildReport(parsed) {
  const kind = parsed.kind || "taxpnl";
  const issues = [];
  let imported = [];

  if (kind === "tradebook") {
    // Nothing is imported, so "imported" means "dated" here — the same idea,
    // which is what this file did for you.
    imported = uniq((parsed.changing || []).map((d) => d.symbol));
    for (const x of parsed.short || []) {
      issues.push(issue(x.symbol, "short",
        `Not dated. You hold ${x.held}; this file only accounts for ${x.found}, ` +
        `so its earliest buy here (${x.earliest}) is not when the position opened.`));
    }
    for (const x of parsed.absent || []) {
      issues.push(issue(x.symbol, "absent",
        `Not in this file at all — bought before it starts, or on another account.`));
    }
  } else if (kind === "holdings") {
    imported = uniq((parsed.trades || []).map((t) => t.symbol));
    for (const d of parsed.duplicates || []) {
      issues.push(issue(d.symbol, "duplicate",
        `Already in your journal at the same size (${d.quantity}), so it was not added again.`));
    }
    for (const c of parsed.conflicts || []) {
      issues.push(issue(c.symbol, "conflict",
        `Not imported. Your journal holds ${c.journalQuantity} across ` +
        `${c.journalTrades} trade${c.journalTrades === 1 ? "" : "s"}; this file says ` +
        `${c.quantity}. Nothing was changed rather than guess which is right.`));
    }
  } else {
    imported = uniq((parsed.trades || []).map((t) => t.symbol));
    for (const d of parsed.duplicates || []) {
      issues.push(issue(d.symbol, "duplicate",
        `Already in your journal — the same position was imported before.`));
    }
    for (const c of parsed.conflicts || []) {
      issues.push(issue(c.symbol, "conflict",
        c.reason || `Held back for you to decide — importing it could attach sells to the wrong trade.`));
    }
    for (const r of parsed.rejected || []) {
      issues.push(issue(r.symbol, "rejected",
        r.reason || `Held back — the journal needs a positive entry price and quantity.`));
    }
    for (const c of parsed.completions || []) {
      // The position is nested under `group` on a completion, unlike every
      // other list here — c.symbol is undefined and would have recorded an
      // outcome nobody could search for.
      issues.push(issue(c.group?.symbol, "completed",
        `Sells were added to a position you already had, rather than a new trade being created.`));
    }
  }

  /**
   * Warnings are kept whole and unattributed.
   *
   * Most name a symbol in their text, but they are written for a person to
   * read rather than parsed, and inventing a symbol field by regex would
   * attribute some of them wrongly. Searching the text catches them anyway.
   */
  const warnings = (parsed.warnings || []).slice(0, 60);

  const kept = named(issues);
  const truncatedIssues = Math.max(0, kept.length - MAX_ISSUES);
  const truncatedImported = Math.max(0, imported.length - MAX_IMPORTED);

  return {
    kind,
    imported: imported.slice(0, MAX_IMPORTED),
    issues: kept.slice(0, MAX_ISSUES),
    sections: (parsed.skippedSections || []).map((x) => ({
      section: x.section, rows: x.rows,
    })),
    warnings,
    // One number rather than two, because the only thing it changes is whether
    // the screen admits the list is partial.
    truncated: truncatedIssues + truncatedImported,
  };
}

/** Human label for an outcome code, shared by every screen that shows one. */
export const OUTCOME_LABEL = {
  imported: "Imported",
  dated: "Date filled in",
  duplicate: "Already here",
  conflict: "Left for you to decide",
  rejected: "Held back",
  completed: "Added to an existing trade",
  short: "Could not be dated",
  absent: "Not in the file",
};

/**
 * Everything a report says about one symbol.
 *
 * The whole point of storing it this way: given a name, say what happened to
 * it, in which import. Returns null when the batch never saw the symbol, so a
 * caller can tell "this import did not mention it" from "this import skipped
 * it" — two very different answers to "where is my trade".
 */
export function outcomeFor(report, symbol) {
  if (!report) return null;
  const k = up(symbol);
  if (!k) return null;
  const hit = (report.issues || []).find((i) => i.s === k);
  if (hit) return { outcome: hit.o, why: hit.why };
  if ((report.imported || []).includes(k)) {
    return {
      outcome: report.kind === "tradebook" ? "dated" : "imported",
      why: report.kind === "tradebook"
        ? "Its purchase date was read from this tradebook."
        : "Imported from this file.",
    };
  }
  return null;
}
