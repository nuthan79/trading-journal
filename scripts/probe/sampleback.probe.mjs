import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok } from "./harness.mjs";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * A WAY BACK TO THE SAMPLE BOOK, FROM THE EMPTY PAGE ITSELF.
 *
 * The sample shows to an account with no trades that has not dismissed it —
 * but an account that HAS dismissed it, on the day it signed up, sees an app
 * where every chart reads "once you close your first trade". The only way
 * back was the profile sheet, which is precisely where somebody who has not
 * worked out what the app does will not look. The pin already existed; this
 * pins the button where the emptiness is.
 */
const layout = read("app/(app)/layout.jsx");
const dash = read("app/(app)/dashboard/page.jsx");
const fw = read("components/journal/FirstWeek.jsx");

test("the layout offers showDemo through the journal context", () => {
  ok(/setDemoPinned/.test(layout), "layout imports the pin writer");
  ok(/const showDemo = async/.test(layout), "showDemo exists");
  ok(/demoOn,\s*showDemo,/.test(layout), "both are in the context value");
});

test("the offer sits in the banner's own slot, on every screen", () => {
  ok(/SampleOffer/.test(layout), "the layout renders it");
  ok(/\{!demo && trades\.length === 0 && bookRegion === DEFAULT_REGION && \(/.test(layout),
     "only with no sample showing, nothing of the user's own, and a book the sample suits");
  const i = layout.indexOf("<DemoBanner"), j = layout.indexOf("<SampleOffer");
  ok(i > 0 && j > i && layout.indexOf("{children}") > j,
     "above the screen being read, beside the banner it mirrors");
});

test("the offer says what it does and how to leave", () => {
  const so = read("components/journal/SampleOffer.jsx");
  ok(/Show me a sample journal/.test(so), "the words say what happens");
  ok(/yours are never touched/.test(so), "and that nothing of theirs moves");
  ok(/\/import/.test(so), "the other way to fill a journal is right there");
});

test("the dashboard card does not offer it a second time", () => {
  ok(!/onShowDemo/.test(fw) && !/onShowDemo/.test(dash),
     "two buttons for one thing on one page is the clutter, not the fix");
});

/* Pinning must clear the dismissal, or the button writes a flag the sample
   test then ignores — clicked, saved, nothing on screen. */
test("pinning clears the dismissal in db.js", () => {
  const db = read("lib/db.js");
  ok(/demo_pinned_at: now, demo_dismissed_at: null/.test(db));
});
