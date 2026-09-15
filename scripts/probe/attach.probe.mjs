import { readFileSync } from "node:fs";
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
