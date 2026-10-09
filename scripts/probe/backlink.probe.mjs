import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok } from "./harness.mjs";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/*
 * FROM A ROW ON WHAT WORKS TO ITS TRADES, AND BACK TO THE SAME CUT. The tab
 * was component state alone, so Back — the browser's or the banner's —
 * always landed on Base pattern.
 */
test("What works opens on the tab named in its address, and writes it there", () => {
  const s = read("components/journal/Edge.jsx");
  ok(/new URLSearchParams\(window\.location\.search\)\.get\("dim"\)\) \|\| "pattern"/.test(s),
     "the initial tab comes from ?dim=");
  ok(/window\.history\.replaceState\([^)]*`\?dim=\$\{encodeURIComponent\(id\)\}`\)/.test(s),
     "choosing a tab replaces the address — replaced, so Back does not step through tabs");
  ok(/className="sec" id="mistakes" style=\{\{ scrollMarginTop: \d+ \}\}/.test(s),
     "the mistakes section is an anchor, clear of the sticky top bar");
});

test("the banner on Trades leads back to the cut that sent you", () => {
  const s = read("components/journal/Trades.jsx");
  ok(/edge\?\.dim \? `\/analysis\/edge\?dim=\$\{encodeURIComponent\(edge\.dim\)\}`/.test(s),
     "a row of the edge table goes back to its own tab");
  ok(/mistake \? "\/analysis\/edge#mistakes"/.test(s), "a mistake goes back to the mistakes section");
  ok(/\{backTo && \(\s*<Link className="btn ghost sm" href=\{backTo\}>/.test(s), "and the link is drawn");
  /* Beside Clear, which still keeps you on Trades. */
  const back = s.indexOf("<ArrowLeft size={12} />Back");
  ok(back > 0 && back < s.indexOf("<X size={12} />Clear", back), "Back sits before Clear");
});
