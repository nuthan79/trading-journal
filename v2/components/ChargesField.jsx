"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { RotateCcw, ChevronDown } from "lucide-react";
import { tradeCharges, entryCharges, CHARGE_LABELS } from "@/lib/charges";
import { rupee } from "@/lib/format";

/**
 * The charges box.
 *
 * Behaviour that matters:
 *
 *   Auto by default on a NEW trade. Once you type in the box it becomes yours
 *   and the calculator stops touching it — for this trade, permanently, even
 *   across later edits. `auto` is persisted, not inferred, so reopening a trade
 *   you adjusted by hand doesn't quietly recalculate it.
 *
 *   Both legs, not just the sell. The intuitive mistake is charging only the
 *   exit, since that's the moment you're filling this in. But stamp duty is
 *   buy-side and STT applies to both, so on delivery the entry accounts for
 *   nearly half the bill.
 *
 *   Nothing recalculates on read. The stored figure is the record. If STT
 *   changes next Budget, old trades keep reporting what they actually cost.
 */

export default function ChargesField({
  trade,            // { exchange, entry_price, quantity, exit_price, exits, status }
  value,            // current charges figure
  auto,             // was it computed rather than typed
  config,           // profile.charge_config
  onChange,         // (charges, auto, breakdown) => void
  disabled,
}) {
  const [open, setOpen] = useState(false);
  const touched = useRef(false);

  const isClosing =
    trade?.status === "closed" ||
    (Array.isArray(trade?.exits) && trade.exits.length > 0) ||
    Number(trade?.exit_price) > 0;

  const computed = useMemo(() => {
    if (!Number(trade?.entry_price) || !Number(trade?.quantity)) return null;
    return isClosing
      ? tradeCharges(trade, config)
      : (() => {
          const leg = entryCharges(trade, config);
          if (!leg) return null;
          return {
            buy: leg, sells: [],
            breakdown: {
              stt: leg.stt, exchangeFee: leg.exchangeFee, sebi: leg.sebi,
              stampDuty: leg.stampDuty, brokerage: leg.brokerage, dp: 0, gst: leg.gst,
            },
            buyTotal: leg.total, sellTotal: 0, total: leg.total,
            pctOfTurnover: (leg.total / leg.turnover) * 100,
            entryOnly: true,
          };
        })();
  }, [trade, config, isClosing]);

  /* Push the computed figure up only while this field is still automatic. */
  useEffect(() => {
    if (!computed || disabled) return;
    if (auto === false) return;                    // user owns it now
    if (touched.current) return;
    if (Math.abs(Number(value || 0) - computed.total) < 0.01) return;
    onChange?.(computed.total, true, computed.breakdown);
  }, [computed, auto, disabled, value, onChange]);

  const typeOver = (e) => {
    touched.current = true;
    const v = e.target.value.replace(/[^0-9.]/g, "");
    onChange?.(v === "" ? 0 : Number(v), false, null);
  };

  const backToAuto = () => {
    touched.current = false;
    if (computed) onChange?.(computed.total, true, computed.breakdown);
  };

  const items = computed
    ? Object.entries(computed.breakdown).filter(([, v]) => v > 0)
    : [];

  return (
    <div className="cf">
      <label className="f">
        <span>Charges — taxes, brokerage, DP</span>
        <div className="cf-row">
          <input
            className="in cf-in"
            inputMode="decimal"
            value={value ?? ""}
            onChange={typeOver}
            disabled={disabled}
            placeholder="0"
          />
          {auto !== false ? (
            <span className="cf-tag" title="Calculated from your charge settings">
              auto
            </span>
          ) : (
            <button type="button" className="cf-reset" onClick={backToAuto}
                    title="Recalculate and hand it back to auto">
              <RotateCcw size={11} /> auto
            </button>
          )}
        </div>
      </label>

      {computed && (
        <>
          <button type="button" className="cf-toggle" onClick={() => setOpen((o) => !o)}>
            <ChevronDown size={11} style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }} />
            {computed.entryOnly ? "Entry side only" : "Both legs"} — {rupee(computed.total)}
            {isFinite(computed.pctOfTurnover) && (
              <span className="cf-dim"> · {computed.pctOfTurnover.toFixed(3)}% of turnover</span>
            )}
          </button>

          {open && (
            <div className="cf-panel">
              {items.map(([k, v]) => (
                <div key={k} className="cf-line">
                  <span>{CHARGE_LABELS[k]}</span>
                  <b className="mono">{v.toFixed(2)}</b>
                </div>
              ))}
              <div className="cf-line cf-split">
                <span>Buy leg</span><b className="mono">{computed.buyTotal.toFixed(2)}</b>
              </div>
              {!computed.entryOnly && (
                <div className="cf-line">
                  <span>Sell leg{computed.sells.length > 1 ? `s (${computed.sells.length})` : ""}</span>
                  <b className="mono">{computed.sellTotal.toFixed(2)}</b>
                </div>
              )}
              {computed.entryOnly && (
                <div className="cf-note">
                  Only the buy side has been incurred so far. The sell side is added
                  when you close the trade — expect roughly to double.
                </div>
              )}
              {computed.sells.length > 1 && (
                <div className="cf-note">
                  Each tranche carries its own DP charge and brokerage, which is what
                  your broker actually bills.
                </div>
              )}
              {auto === false && (
                <div className="cf-note cf-warn">
                  You've set this figure by hand, so it's kept as is. The breakdown
                  above is what the calculator would have proposed.
                </div>
              )}
            </div>
          )}
        </>
      )}

      <style jsx>{`
        .cf { display: block; }
        .cf-row { display: flex; align-items: center; gap: 8px; }
        .cf-in { flex: 1; }
        .cf-tag {
          font-size: 9px; font-weight: 700; letter-spacing: 0.1em;
          text-transform: uppercase; color: var(--brass);
          border: 1px solid var(--brass); border-radius: 2px; padding: 3px 6px;
        }
        .cf-reset {
          display: inline-flex; align-items: center; gap: 4px;
          font-size: 9px; font-weight: 700; letter-spacing: 0.09em;
          text-transform: uppercase; color: var(--ink3);
          background: none; border: 1px solid var(--rule);
          border-radius: 2px; padding: 3px 6px;
        }
        .cf-reset:hover { color: var(--ink); border-color: var(--ink2); }
        .cf-toggle {
          display: flex; align-items: center; gap: 5px;
          background: none; border: 0; padding: 6px 0 0;
          font-size: 11.5px; color: var(--ink2); font-family: inherit;
        }
        .cf-toggle:hover { color: var(--ink); }
        .cf-dim { color: var(--ink3); }
        .cf-panel {
          margin-top: 7px; border: 1px solid var(--rule);
          border-left: 2px solid var(--brass);
          background: #F5F8F6; border-radius: 2px; padding: 10px 12px;
        }
        .cf-line {
          display: flex; justify-content: space-between; gap: 14px;
          font-size: 11.5px; color: var(--ink2); padding: 2px 0;
        }
        .cf-line b { font-weight: 500; font-variant-numeric: tabular-nums; }
        .cf-split {
          border-top: 1px solid var(--rule); margin-top: 6px; padding-top: 6px;
        }
        .cf-note {
          font-size: 11px; color: var(--ink3); line-height: 1.55;
          margin-top: 8px; text-wrap: pretty;
        }
        .cf-warn { color: #6B4E12; }
      `}</style>
    </div>
  );
}
