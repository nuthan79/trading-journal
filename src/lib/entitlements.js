/**
 * Which markets this user may WRITE in.
 *
 * THE LOCK IS IN THE DATABASE, not here. Migration 053 puts a restrictive
 * policy on `trades`, so a write into a market you are not entitled to fails
 * whatever client sends it. Everything in this file is the POLITE half: it
 * stops the app offering a Save that the database would refuse, and says why.
 * A user who bypasses it gets an error instead of a lie, which is the right
 * way round.
 *
 * INDIA IS FREE. It needs no row and is never locked, so every existing
 * journal behaves exactly as it always has.
 *
 * WRITES BLOCKED, READS KEPT. A lapsed book stays open and readable — its
 * owner logged those trades. What stops is adding to it.
 */
import { DEFAULT_REGION, regionOf } from "./regions";

/** Rows from `region_access`, as the app loads them. */
const rowFor = (access, id) =>
  (access || []).find((a) => regionOf({ region: a.region }) === regionOf({ region: id })) || null;

const live = (row) => {
  if (!row) return false;
  if (!row.expires_at) return true;           // no expiry — a lifetime grant
  const t = Date.parse(row.expires_at);
  return Number.isFinite(t) ? t > Date.now() : true;
};

/** May this user write trades in this market? */
export function canWrite(access, id) {
  if (regionOf({ region: id }) === DEFAULT_REGION) return true;
  return live(rowFor(access, id));
}

/**
 * Why not, in the three states worth telling apart:
 *
 *   "open"     it is theirs — free, or granted and current
 *   "expired"  they had it; the book is readable and closed to new trades
 *   "locked"   never granted
 *
 * The middle one exists because "your access ended on 3 April" and "you have
 * never had this" deserve different sentences, and a renewal is the easier
 * conversation of the two.
 */
export function accessState(access, id) {
  if (regionOf({ region: id }) === DEFAULT_REGION) return { state: "open", until: null };
  const row = rowFor(access, id);
  if (!row) return { state: "locked", until: null };
  if (live(row)) return { state: "open", until: row.expires_at || null };
  return { state: "expired", until: row.expires_at || null };
}

/** For the switch: every market, with what this user may do in it. */
export const accessFor = (access, regions) =>
  regions.map((r) => ({ ...r, ...accessState(access, r.id) }));
