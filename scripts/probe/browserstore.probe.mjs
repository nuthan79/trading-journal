import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { setStorageUser, scopedKey, sweepLegacy } from "@/lib/browserStore";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/** Enough localStorage for the sweep to run against. */
function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i) => [...map.keys()][i] ?? null,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _keys: () => [...map.keys()],
  };
}



/**
 * TWO ACCOUNTS, ONE BROWSER.
 *
 * localStorage belongs to the origin, not to whoever is signed in, so every
 * preference and every draft was shared by every account used on that machine.
 * Reported from the column picker; the serious half was drafts, which are
 * restored automatically into whichever account opens the app next.
 */
test("two accounts on one browser do not share a key", () => {
  setStorageUser("user-a");
  const a = scopedKey("ledgerr:columns:holdings");
  setStorageUser("user-b");
  const b = scopedKey("ledgerr:columns:holdings");
  ok(a !== b, "both accounts read and write the same key");
  setStorageUser("user-a");
  eq(scopedKey("ledgerr:columns:holdings"), a, "the same account must come back to its own key");
  setStorageUser(null);
  ok(scopedKey("trade-draft-v1").length > "trade-draft-v1".length,
     "signed out still has to produce a key rather than throw");
});

/**
 * The sweep runs once in everybody's browser with no undo, so what it may take
 * is an explicit list. These are the keys it must NOT take: one already scoped,
 * one that is user-scoped by its own older scheme, one that is deliberately
 * shared, and one belonging to somebody else entirely.
 */
test("the sweep clears the unscoped keys and nothing else", () => {
  const store = fakeStorage({
    "ledgerr:columns:holdings": "a",
    "ledgerr:columns:trades.US": "b",
    "ledgerr:show-as": "keep",
    "trade-draft-v1": "{}",
    "settings-draft-v1": "{}",
    "ledgerr:columns:holdings::user-a": "keep",
    "ledgerr:first-week-hidden:user-a": "keep",
    "ledgerr:splits:v1": "keep",
    "sb-abc-auth-token": "keep",
    "some-other-app": "keep",
  });
  globalThis.localStorage = store;
  const n = sweepLegacy();
  eq(n, 4, "it took the wrong number of keys");
  /* show-as is in this list on purpose: the rupee/dollar view is per browser
     by an earlier decision, so it has no unscoped copy to clear. */
  for (const k of ["ledgerr:columns:holdings::user-a", "ledgerr:first-week-hidden:user-a",
                   "ledgerr:splits:v1", "sb-abc-auth-token", "some-other-app",
                   "ledgerr:show-as"]) {
    ok(store.getItem(k) === "keep", `the sweep took ${k}, which is not its to take`);
  }
  for (const k of ["ledgerr:columns:holdings", "ledgerr:columns:trades.US", "trade-draft-v1"]) {
    ok(store.getItem(k) === null, `${k} survived the sweep`);
  }
  delete globalThis.localStorage;
});

test("a browser that refuses storage does not break the sweep", () => {
  globalThis.localStorage = { get length() { throw new Error("denied"); } };
  eq(sweepLegacy(), 0, "a private window must not throw out of the app layout");
  delete globalThis.localStorage;
});

/**
 * The id must be set during RENDER. The screens read storage in their own
 * useState initializers, which run before any effect, so an effect here would
 * let the first render of a second account read the first account's keys —
 * the exact bug, narrowed to one paint.
 */
test("the layout names the account during render, not in an effect", () => {
  const src = read("app/(app)/layout.jsx");
  ok(/^\s*setStorageUser\(userId\);/m.test(src), "setStorageUser is not called plainly during render");
  ok(!/useEffect\(\(\) => \{?\s*setStorageUser/.test(src), "it is being set from an effect");
});

/**
 * Every key this app writes goes through the helper. Two exceptions, both
 * deliberate: splitCache is a fact about a stock rather than about anybody,
 * and FirstWeek already builds the id into its own key.
 */
test("nothing writes an unscoped key behind the helper's back", () => {
  /* Everything that keeps per-account state in the browser. The layout is
     checked too but is not in `scopers`: its job is to NAME the account and
     sweep, not to build keys. */
  const scopers = [
    "lib/useColumnPrefs.js", "lib/useAutosave.js",
    "components/journal/HeadlineNumbers.jsx", "components/journal/TradeForm.jsx",
  ];
  const files = [...scopers, "app/(app)/layout.jsx"];
  for (const f of files) {
    const src = read(f).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
    const calls = src.match(/localStorage\.(get|set|remove)Item\(\s*("[^"]*"|`[^`]*`)/g) || [];
    /* One key is deliberately shared between accounts and is named here so
       that it stays the ONLY one: the rupee/dollar view is how you are
       reading the screen rather than a fact about whose journal it is, and
       fxview.probe.mjs records that decision. Anything else unscoped is the
       bug this file exists for. */
    const allowed = calls.filter((c) => c.includes("ledgerr:show-as"));
    eq(calls.length - allowed.length, 0,
       `${f} passes a bare string to localStorage: `
       + `${calls.find((c) => !c.includes("ledgerr:show-as")) || ""} — it must go through scopedKey`);
    /* A bare literal is the obvious way to lose the scope; building the key
       into a variable first is the quiet one, and that is exactly how the
       columns were written before this. Every one of these files must still
       CALL the helper, not merely import it. */
    if (scopers.includes(f)) {
      ok(/scopedKey\(/.test(src), `${f} no longer calls scopedKey at all`);
    }
  }
});
