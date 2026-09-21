import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { test, ok, eq, near } from "./harness.mjs";
import { mergeConfig, DEFAULT_CHARGE_CONFIG, STATUTORY_KEYS, legCharges } from "@/lib/charges";
import { mtfPrefs, PLEDGE_FEE, UNPLEDGE_FEE } from "@/lib/mtf";

const SRC = path.resolve(fileURLToPath(new URL("../../src", import.meta.url)));
const read = (p) => readFileSync(path.join(SRC, p), "utf8");

/**
 * THE RATES NOBODY CHOOSES.
 *
 * STT, the exchange and SEBI fees, stamp duty, GST, and the depository's
 * pledge fees are set by the government, the exchanges and CDSL/NSDL. They
 * were editable in Setup until 2026-09-21, which asked every user a question
 * with one right answer — and a mistyped STT understates every charge and
 * every net P&L in that journal, silently, forever.
 */
test("a stored config cannot override a statutory rate", () => {
  const tampered = mergeConfig({ sttPct: 0.01, gstPct: 0, stampDutyPct: 9,
                                 sebiPct: 5, exchangeNsePct: 1, exchangeBsePct: 1 });
  for (const k of STATUTORY_KEYS) {
    eq(tampered[k], DEFAULT_CHARGE_CONFIG[k], `${k} comes from the code, not the profile`);
  }
});

test("what IS the user's still comes through", () => {
  const mine = mergeConfig({ brokerageModel: "percent", brokeragePct: 0.3,
                             brokerageCap: 1e15, dpChargePerSell: 20 });
  eq(mine.brokerageModel, "percent");
  near(mine.brokeragePct, 0.3, 1e-9);
  near(mine.dpChargePerSell, 20, 1e-9, "the depository fee differs by broker and stays editable");
});

test("the charge a trade computes uses the statutory rate regardless", () => {
  const honest = legCharges({ leg: "buy", exchange: "NSE", price: 100, quantity: 100 },
                            { brokerageModel: "zero" });
  const tampered = legCharges({ leg: "buy", exchange: "NSE", price: 100, quantity: 100 },
                              { brokerageModel: "zero", sttPct: 0, gstPct: 0 });
  near(tampered.total, honest.total, 1e-9, "a profile claiming no STT is charged STT anyway");
  ok(honest.stt > 0);
});

test("pledge fees are central too, and the real choice is not", () => {
  eq(mtfPrefs({ mtf_pledge_fee: 5, mtf_unpledge_fee: 99 })._mtfPledge, PLEDGE_FEE);
  eq(mtfPrefs({ mtf_pledge_fee: 5, mtf_unpledge_fee: 99 })._mtfUnpledge, UNPLEDGE_FEE);
  eq(mtfPrefs({ mtf_in_pnl: false })._mtfInPnl, false, "whether MTF hits P&L stays the user's");
});

test("Setup offers no box for any of them", () => {
  const sheet = read("components/journal/SettingsSheet.jsx");
  for (const k of STATUTORY_KEYS) {
    ok(!new RegExp(`["'\`]${k}["'\`]`).test(sheet), `${k} has no field in Setup`);
  }
  ok(!/mtf_pledge_fee|mtf_unpledge_fee/.test(sheet), "nor the pledge fees");
  /* The plan and the MTF choice are what remain, and must. */
  ok(/BROKER_PRESETS/.test(sheet), "the broker plan is still chosen here");
  ok(/mtf_in_pnl/.test(sheet), "and whether MTF comes out of P&L");
});
