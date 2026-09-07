import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok } from "./harness.mjs";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const src = readFileSync(path.join(SRC, "components/SymbolSearch.jsx"), "utf8");

/**
 * A DROPDOWN OPTION MUST COMMIT ON MOUSEDOWN.
 *
 * On Safari, clicking a suggestion closed the list and left the typed text
 * behind, picking nothing — the user had to click outside the dropdown
 * instead. WebKit does not focus a button when it is clicked, so the focus
 * and blur sequence around mousedown differs from every other browser and
 * the row can be gone before `click` arrives.
 *
 * It worked in Chrome and Firefox throughout, which is what made it look like
 * a browser quirk rather than a handler on the wrong event — and is exactly
 * why a static check earns its place: nothing in a Chromium-driven render
 * test would ever fail if this were reverted.
 */

test("suggestions are chosen on mousedown, not on click alone", () => {
  ok(/onMouseDown=\{\(e\) => \{ e\.preventDefault\(\); choose\(item\); \}\}/.test(src),
    "the option row must select on mousedown");
  ok(/onClick=\{\(\) => choose\(item\)\}/.test(src),
    "and keep onClick, which is how keyboards and screen readers activate it");
});

test("preventDefault keeps the caret in the field", () => {
  /* Without it the browser moves focus to the button, so the next keystroke
     goes nowhere and tabbing continues from the wrong place. */
  const md = src.match(/onMouseDown=\{[^}]*\}/)?.[0] || "";
  ok(/preventDefault\(\)/.test(md), `mousedown must preventDefault, got: ${md}`);
});

test("every button in the picker declares its type", () => {
  /*
    An untyped button inside a form is a submit button. This component sits
    in a sheet today and in a form tomorrow, and the failure then is a page
    reload on choosing a symbol — which would read as the app crashing.
  */
  const buttons = src.match(/<button[\s\S]*?>/g) || [];
  ok(buttons.length >= 2, `expected the clear and option buttons, found ${buttons.length}`);
  for (const b of buttons) {
    ok(/type="button"/.test(b), `a button without type="button": ${b.slice(0, 80)}`);
  }
});
