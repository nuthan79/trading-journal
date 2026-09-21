import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok } from "./harness.mjs";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * A PROP USED BUT NEVER DESTRUCTURED IS A BLANK SCREEN.
 *
 * `onSweepSplits` reached the JSX of Holdings while the edit that added it to
 * the props list failed silently, so the page threw "onSweepSplits is not
 * defined" the moment it rendered — caught by the error boundary, which is
 * the friendliest possible way to lose a whole screen. Nothing in a build
 * sees this: it is a plain reference to a name that does not exist, in a
 * branch that only runs when the prop is passed.
 *
 * Probes here read source because there is no JSX compiler — so they read it
 * for exactly this, the class of mistake that compiles and then fails in
 * front of somebody.
 */
const SCREENS = [
  "components/journal/Holdings.jsx",
  "components/journal/Trades.jsx",
  "components/journal/PositionDetail.jsx",
  "components/journal/TradeForm.jsx",
  "components/journal/Diary.jsx",
  "components/journal/Review.jsx",
  "components/ImportTrades.jsx",
];

/* The DOM's own handlers, which are never props of ours. */
const DOM = /^on(Click|Change|Submit|KeyDown|KeyUp|KeyPress|Blur|Focus|Load|Error|MouseDown|MouseUp|MouseEnter|MouseLeave|Drop|DragOver|DragEnter|DragLeave|Input|Paste|Scroll|Select|Toggle|Close|Ended|Play|Pause|Wheel|ContextMenu|AnimationEnd|TransitionEnd)$/;

test("every callback a screen renders is a prop it takes or a name it defines", () => {
  for (const f of SCREENS) {
    const src = read(f);
    const at = src.indexOf("export default function");
    if (at < 0) continue;
    const open = src.indexOf(") {", at);
    const sig = src.slice(at, open);
    const body = src.slice(open);

    /* A name being READ, not one being passed: `onAck={handler}` is this
       file handing a callback to a child, and the child's prop is its own
       business. Only `onThing(` and `onThing &&` and the like are references
       this component must be able to resolve. */
    const used = new Set([...body.matchAll(/(?<![.\w])(on[A-Z]\w*)(?![\w=:])/g)].map((m) => m[1]));
    const defined = new Set([
      ...[...sig.matchAll(/(on[A-Z]\w+)/g)].map((m) => m[1]),
      ...[...body.matchAll(/(?:const|let|var|function)\s+(on[A-Z]\w+)/g)].map((m) => m[1]),
    ]);
    for (const name of used) {
      if (DOM.test(name)) continue;
      ok(defined.has(name), `${f} renders ${name} but never takes or defines it`);
    }
  }
});

test("Holdings takes the props the split card needs", () => {
  const src = read("components/journal/Holdings.jsx");
  const at = src.indexOf("export default function");
  const sig = src.slice(at, src.indexOf(") {", at));
  for (const p of ["onFixSplits", "splitPlan", "splitsUnsure"]) {
    ok(new RegExp(`\\b${p}\\b`).test(sig), `Holdings does not take ${p}`);
  }
});
