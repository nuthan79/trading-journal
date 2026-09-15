import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const diary = () => readFileSync(path.join(SRC, "components/journal/Diary.jsx"), "utf8");

/**
 * THE SAVE BUTTON HAS TO BE WHERE THE WRITING IS.
 *
 * A diary entry carrying a chart runs to about fifteen hundred pixels, nearly
 * all of it the chart. With the actions under the form, the note was typed in
 * a box near the top and saved from somewhere off the bottom of the screen —
 * reported as the save "not working", meaning nobody could find it.
 *
 * Pinned structurally rather than by looking for a class name, because what
 * matters is the ORDER: the actions come before the body field, whatever the
 * markup around them ends up being called.
 */

test("save and cancel sit above the field they act on", () => {
  const src = diary();
  const save = src.indexOf("onClick={commit}");
  const cancel = src.indexOf("onClick={discard}");
  const body = src.indexOf("<textarea");
  ok(save > 0 && cancel > 0 && body > 0, "all three must exist to be ordered");
  ok(save < body, "the save must come before the note field, not after the chart");
  ok(cancel < body, "and so must cancel");
});

test("there is exactly one save and one cancel", () => {
  const src = diary();
  /* Two saves on one form is the other way this goes wrong: the pair gets
     added at the top and the old pair is left at the bottom, and the form now
     has two primary buttons that do the same thing. */
  eq(src.split("onClick={commit}").length - 1, 1, "one save button");
  eq(src.split("onClick={discard}").length - 1, 1, "one cancel button");
});

test("a new entry gets a heading too, not just an edit", () => {
  const src = diary();
  /* The eyebrow used to render only when draft.id was set, so opening a fresh
     entry gave a card with no heading — and now, no header row to hold the
     buttons either. */
  ok(/draft\.id \? `Editing the entry from/.test(src),
    "the header must read for both cases from one expression");
  ok(!/\{draft\.id && \(\s*<div className="eyebrow"/.test(src),
    "and must not go back to rendering only on an edit");
});

/**
 * The chart button is the one action that stays at the bottom, because it acts
 * on the thing it sits beside rather than on the entry as a whole.
 */
test("the chart link button stays with the chart", () => {
  const src = diary();
  const link = src.indexOf("onClick={openLink}");
  const body = src.indexOf("<textarea");
  ok(link > body, "pasting a chart link belongs below the note, next to the chart");
});
