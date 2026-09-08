import { test, eq, ok, near } from "./harness.mjs";
import { MISTAKES, NEUTRAL_TAGS, isExecutionError } from "@/lib/constants";
import { mistakeCost, outcomeTagCounts } from "@/lib/analysis";

/**
 * WHAT THE MARKET DID, VERSUS WHAT YOU DID.
 *
 * The tag list mixes both on purpose, and one predicate keeps them apart —
 * `mistakeCost` counts only the errors, `outcomeTagCounts` only the rest. Put
 * a tag on the wrong side and the app either scolds somebody for the market's
 * behaviour or quietly stops counting a real lapse.
 *
 * It matters most for a breakout method, where failed breakouts are the cost
 * of doing the thing at all. Scored as indiscipline they would dominate "what
 * your mistakes cost", which exists to isolate the losses that were avoidable.
 */

test("False breakout is an outcome, not an execution error", () => {
  ok(MISTAKES.includes("False breakout"), "the tag is offered");
  ok(NEUTRAL_TAGS.has("False breakout"));
  eq(isExecutionError("False breakout"), false);
  eq(isExecutionError("Setup failed"), false, "as its neighbour already was");
  eq(isExecutionError("Ignored the stop"), true, "while a real lapse still is");
});

test("it is costed as an outcome and never as indiscipline", () => {
  const trade = (id, tags, pnl) => ({
    id, symbol: "X", status: "closed", side: "long",
    entry_date: "2026-01-05", exit_date: "2026-01-20",
    entry_price: 100, quantity: 100, stop_loss: 90, stop_source: "recorded",
    mistakes: tags, pnl, r: pnl / 1000,
  });
  const book = [
    trade("a", ["False breakout"], -8000),
    trade("b", ["Ignored the stop"], -5000),
    trade("c", ["Setup failed"], -3000),
  ];

  const cost = mistakeCost(book, isExecutionError);
  const tags = cost.map((r) => r.tag ?? r.mistake ?? r.name);
  ok(!tags.includes("False breakout"),
    `a failed breakout is not money lost to indiscipline: ${tags.join(", ")}`);
  ok(tags.includes("Ignored the stop"), "a real lapse still is");

  const outcomes = outcomeTagCounts(book, isExecutionError);
  const oTags = outcomes.map((r) => r.tag ?? r.name);
  ok(oTags.includes("False breakout"), "it is counted as an outcome instead");
  ok(!oTags.includes("Ignored the stop"));
});

test("every tag is on exactly one side of the line", () => {
  /* A tag that is neither counted nor excluded would vanish from both
     screens, which is how a tag people use stops being reported at all. */
  for (const tag of MISTAKES) {
    const error = isExecutionError(tag);
    ok(error === true || error === false, `${tag} must classify`);
    eq(error, !NEUTRAL_TAGS.has(tag), `${tag} must agree with NEUTRAL_TAGS`);
  }
  for (const tag of NEUTRAL_TAGS) {
    ok(MISTAKES.includes(tag), `${tag} is neutral but not offered as a tag`);
  }
});
