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

test("the dashboard passes it only when no sample is on screen", () => {
  ok(/demoOn, showDemo/.test(dash), "the page reads both");
  ok(/onShowDemo: demoOn \? null : showDemo/.test(dash),
     "offering it while the sample IS showing would read as a broken button");
});

test("the first-week card renders the button, and only when given one", () => {
  ok(/onShowDemo/.test(fw), "the prop is taken");
  ok(/\{onShowDemo && \(/.test(fw), "guarded, so a full journal shows no link");
  ok(/Show me a sample journal/.test(fw), "the words say what happens");
});

/* Pinning must clear the dismissal, or the button writes a flag the sample
   test then ignores — clicked, saved, nothing on screen. */
test("pinning clears the dismissal in db.js", () => {
  const db = read("lib/db.js");
  ok(/demo_pinned_at: now, demo_dismissed_at: null/.test(db));
});
