/** A test runner small enough to read in one screen. No dependency, because
 *  the repo has none and one probe file is not worth a framework. */

export const cases = [];
export const test = (name, fn) => cases.push({ name, fn });

class Failed extends Error {}
const show = (v) => (typeof v === "string" ? JSON.stringify(v) : String(v));

export function eq(actual, expected, what = "") {
  if (Object.is(actual, expected)) return;
  throw new Failed(`${what ? what + ": " : ""}expected ${show(expected)}, got ${show(actual)}`);
}
export function ok(value, what = "expected truthy") {
  if (value) return;
  throw new Failed(what);
}
export function near(actual, expected, tol, what = "") {
  if (Number.isFinite(actual) && Math.abs(actual - expected) <= tol) return;
  throw new Failed(`${what ? what + ": " : ""}expected ${expected} ±${tol}, got ${show(actual)}`);
}
export { Failed };
