import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq } from "./harness.mjs";
import { today } from "@/lib/format";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * A CHART IS DATED WHEN IT WAS TAKEN, NOT WHEN THE TRADE WAS OPENED.
 *
 * Attaching a chart writes a diary entry, and that entry was dated to the
 * trade's `entry_date`. The report that found this: a position entered on
 * 31 July and exited on 15 September, with a chart of the EXIT drawn on the
 * 15th, filed in the diary under 31 July.
 *
 * Two things were wrong. The diary lists by date and was being told the wrong
 * one; and every chart on a single trade got an identical date, so a sequence
 * of them had no order.
 */

test("attaching a chart dates the diary entry to today", () => {
  const src = read("components/journal/PositionDetail.jsx");
  const attach = src.slice(src.indexOf("const attach = async"),
                           src.indexOf("/* ---- the chart, full size"));
  ok(attach.includes("entry_date: today()"),
    "the attach must date its diary entry to the day it runs");
  ok(!/entry_date:\s*row\.entry_date/.test(attach),
    "and must not fall back to the trade's entry date");
  ok(!/entry_date:[^\n]*toISOString/.test(attach),
    "nor reach for the UTC day, which is a different date for part of every day");
});

/**
 * `new Date().toISOString().slice(0, 10)` is the UTC day. This app's users are
 * in IST, always +5:30, so that expression names YESTERDAY from midnight until
 * half past five in the morning. The bug is invisible for nineteen hours a
 * day, which is why the clock is injectable rather than read from the wall.
 */
test("today() is the local day, not the UTC one", () => {
  /* 00:30 on 16 September in IST is 19:00 on the 15th in UTC. Built from the
     UTC instant so this holds whatever zone the probe runs in, then compared
     against what the local getters see. */
  const inst = new Date("2026-09-15T19:00:00Z");
  const p = (n) => String(n).padStart(2, "0");
  const local = `${inst.getFullYear()}-${p(inst.getMonth() + 1)}-${p(inst.getDate())}`;
  eq(today(inst), local, "today() must agree with the browser's own calendar");
  ok(today(inst) !== inst.toISOString().slice(0, 10) || local === "2026-09-15",
    "and must not simply be the ISO string");
});

test("today() reads the clock when it is not given one", () => {
  const p = (n) => String(n).padStart(2, "0");
  const n = new Date();
  eq(today(), `${n.getFullYear()}-${p(n.getMonth() + 1)}-${p(n.getDate())}`);
});

/**
 * The diary's compose box has always dated a new entry to the day it is
 * written. Attaching was the one path that did something else, and the fix is
 * only complete if the two now agree.
 */
test("both ways of creating a diary entry agree on what day it is", () => {
  const diary = read("components/journal/Diary.jsx");
  ok(/entry_date: [^\n]*(today\(\)|toISOString)/.test(diary),
    "the compose box still dates a new entry to the day it is written");
});

/**
 * THE WHOLE CLASS, NOT JUST THE ONE THAT WAS REPORTED.
 *
 * Eleven places computed "today" as `new Date().toISOString().slice(0, 10)`.
 * That is the UTC day, and IST is always +5:30, so every one of them named
 * YESTERDAY between midnight and half past five in the morning: a trade
 * entered at 1am dated to the previous day, a diary note filed under it, and
 * a date input that refused today as "the future".
 *
 * One is allowed to remain. `quotes.js` is imported only by the API routes,
 * so it runs on the server where local IS UTC, and a browser-calendar helper
 * there would return the same string while implying it had asked somebody's
 * browser. It is listed by name so a second one cannot quietly join it.
 */
test("nothing computes today from the UTC day except the one server module", () => {
  const ALLOWED = new Set(["lib/quotes.js"]);
  const offenders = [];
  const walk = (dir) => {
    for (const e of readdirSync(path.join(SRC, dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { walk(rel); continue; }
      if (!/\.(js|jsx)$/.test(e.name)) continue;
      /* Comments discuss this expression on purpose — format.js documents why
         it is wrong. Strip them or the probe fails on its own explanation. */
      const src = read(rel).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      if (/new Date\(\)\.toISOString\(\)\.slice\(0, ?10\)/.test(src) && !ALLOWED.has(rel)) {
        offenders.push(rel);
      }
    }
  };
  walk("");
  eq(offenders.length, 0,
    `these must use today() from format.js: ${offenders.join(", ")}`);
});

test("the one allowed exception is still the server module it claims to be", () => {
  const q = read("lib/quotes.js");
  ok(!q.startsWith('"use client"'), "quotes.js must not become a client module");
  ok(/only by the API routes|runs on the server/.test(q),
    "and must keep saying why it is exempt");
});
