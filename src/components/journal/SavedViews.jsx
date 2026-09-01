"use client";

/**
 * Saved views — the menu, and the builder behind it.
 *
 * WHAT THIS IS NOT. The obvious shape for this is a query builder: a field
 * dropdown, a generic `=`, a text box, and a tree of AND/OR groups. That is a
 * database console wearing a trading app's colours, and it fails in three
 * specific ways this one tries not to.
 *
 *   1. ONE OPERATOR FOR EVERY TYPE. `=` on a date is almost never the question
 *      somebody meant to ask, and on a tag list it is wrong outright. Here the
 *      operators are worded per type, so the row reads as a sentence:
 *      "Net P&L is below 0", "Entry date is in This financial year".
 *
 *   2. ONE TEXT BOX FOR EVERY VALUE. Typing 2026-04-01 from memory, or
 *      spelling a pattern exactly as the dropdown spells it, is work the app
 *      already knows how to do for you. Dates get a picker and a preset list,
 *      symbols get the ones you have actually traded, tags and patterns get
 *      their own vocabularies.
 *
 *   3. BUILDING BLIND. The count and a sample of matching rows sit under the
 *      rules and update on every keystroke, so you never save a view and only
 *      then discover it matches four trades. An unfinished rule is ignored
 *      rather than applied, because half-typed is the normal state while you
 *      are reading that count.
 *
 * The name field is at the BOTTOM, beside Save, pre-filled from the rules.
 * Asking for a name first — the usual arrangement — asks you to name a thing
 * you have not built yet.
 *
 * See src/lib/filters.js for why there are no nested groups.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronDown, Plus, X, Pencil, Trash2, Check, Filter } from "lucide-react";
import { rupee, rfmt, dmy } from "@/lib/format";
import {
  FIELD_GROUPS, fieldOf, opsFor, arityOf, isNumeric, DATE_PRESETS,
  emptyFilter, emptyRule, withField, withOp, isComplete, matches, suggestName,
} from "@/lib/filters";

/* ------------------------------------------------------------------ *
 *  Value editors
 * ------------------------------------------------------------------ */

/**
 * Several values, shown as what you have picked rather than as a list you
 * have to keep open. The chips ARE the state — a multi-select that only
 * reveals its selection when opened makes you open it to check.
 */
function MultiPick({ options, value, onChange, placeholder = "Add…" }) {
  const picked = Array.isArray(value) ? value : [];
  const left = options.filter((o) => !picked.includes(o));
  return (
    <div className="sv-multi">
      {picked.map((v) => (
        <span key={v} className="sv-tag">
          {v}
          <button type="button" onClick={() => onChange(picked.filter((p) => p !== v))}
                  aria-label={`Remove ${v}`}><X size={10} /></button>
        </span>
      ))}
      {left.length > 0 && (
        <select className="sv-add" value="" onChange={(e) => {
          if (e.target.value) onChange([...picked, e.target.value]);
        }}>
          <option value="">{picked.length ? "+ add" : placeholder}</option>
          {left.map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      )}
    </div>
  );
}

function ValueEditor({ field, rule, symbols, onChange }) {
  const f = fieldOf(field);
  if (!f) return null;
  const n = arityOf(f.type, rule.op);
  if (n === 0) return <div className="sv-novalue">—</div>;

  const set = (patch) => onChange({ ...rule, ...patch });

  if (n === "many") {
    const opts = f.type === "symbol" ? symbols : (f.options || []);
    return <MultiPick options={opts} value={rule.value}
                      onChange={(v) => set({ value: v })}
                      placeholder={f.type === "symbol" ? "Pick a symbol…" : "Pick one…"} />;
  }

  if (f.type === "date") {
    if (rule.op === "within") {
      return (
        <select className="in sv-val" value={rule.value || ""}
                onChange={(e) => set({ value: e.target.value })}>
          <option value="">Pick a period…</option>
          {DATE_PRESETS.map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
      );
    }
    return (
      <div className="sv-pair">
        <input className="in sv-val" type="date" value={rule.value || ""}
               onChange={(e) => set({ value: e.target.value })} />
        {n === 2 && <>
          <span className="sv-and">and</span>
          <input className="in sv-val" type="date" value={rule.value2 || ""}
                 onChange={(e) => set({ value2: e.target.value })} />
        </>}
      </div>
    );
  }

  if (isNumeric(f.type)) {
    const unit = f.type === "money" ? "₹" : f.type === "percent" ? "%"
      : f.type === "r" ? "R" : f.unit || "";
    const box = (k) => (
      <span className="sv-num">
        {unit === "₹" && <i>₹</i>}
        <input className="in sv-val" type="number" step="any" value={rule[k] ?? ""}
               onChange={(e) => set({ [k]: e.target.value })} />
        {unit && unit !== "₹" && <i>{unit}</i>}
      </span>
    );
    return (
      <div className="sv-pair">
        {box("value")}
        {n === 2 && <><span className="sv-and">and</span>{box("value2")}</>}
      </div>
    );
  }

  return (
    <input className="in sv-val" type="text" value={rule.value || ""}
           placeholder={f.type === "symbol" ? "part of a symbol" : "text"}
           onChange={(e) => set({ value: e.target.value })} />
  );
}

/* ------------------------------------------------------------------ *
 *  One rule
 * ------------------------------------------------------------------ */

function RuleRow({ rule, symbols, onChange, onRemove, canRemove }) {
  const f = fieldOf(rule.field);
  return (
    <div className="sv-rule">
      <select className="in sv-field" value={rule.field || ""}
              onChange={(e) => onChange(withField(rule, e.target.value))}>
        <option value="">Pick a field…</option>
        {Object.entries(FIELD_GROUPS).map(([group, fields]) => (
          <optgroup key={group} label={group}>
            {fields.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </optgroup>
        ))}
      </select>

      <select className="in sv-op" value={rule.op || ""} disabled={!f}
              onChange={(e) => onChange(withOp(rule, e.target.value))}>
        {f ? opsFor(f.type).map((o) => <option key={o.op} value={o.op}>{o.label}</option>)
           : <option value="">—</option>}
      </select>

      <div className="sv-value">
        {f
          ? <ValueEditor field={rule.field} rule={rule} symbols={symbols} onChange={onChange} />
          : <div className="sv-novalue">pick a field first</div>}
      </div>

      <button type="button" className="sv-x" onClick={onRemove} disabled={!canRemove}
              aria-label="Remove this condition"><X size={13} /></button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  The builder
 * ------------------------------------------------------------------ */

function Builder({ all, draft, existing, onCancel, onSave }) {
  const [f, setF] = useState(draft);
  const [name, setName] = useState(draft.name || "");
  const [touchedName, setTouchedName] = useState(!!draft.name);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState("");

  /* Only the symbols in this book, because a filter on one you have never
     traded is a rule that can only ever match nothing. */
  const symbols = useMemo(() => {
    const s = new Set();
    for (const t of all || []) if (t.symbol) s.add(t.symbol);
    return [...s].sort();
  }, [all]);

  const suggestion = suggestName(f);
  useEffect(() => { if (!touchedName) setName(suggestion); }, [suggestion, touchedName]);

  const hits = useMemo(() => (all || []).filter((t) => matches(t, f)), [all, f]);
  const live = (f.rules || []).filter(isComplete).length;

  const setRule = (i, r) => setF((s) => ({ ...s, rules: s.rules.map((x, j) => (j === i ? r : x)) }));
  const addRule = () => setF((s) => ({ ...s, rules: [...s.rules, emptyRule()] }));
  const dropRule = (i) => setF((s) => ({
    ...s,
    rules: s.rules.length > 1 ? s.rules.filter((_, j) => j !== i) : [emptyRule()],
  }));

  const clash = existing.find((x) =>
    x.id !== draft.id && x.name.trim().toLowerCase() === name.trim().toLowerCase());

  const save = async () => {
    setErr("");
    if (!name.trim()) return setErr("Give the view a name.");
    if (!live) return setErr("Add at least one condition.");
    setSaving(true);
    try {
      await onSave({ ...f, name: name.trim(), rules: f.rules.filter(isComplete) });
    } catch (e) {
      setErr(e?.message || "That did not save.");
      setSaving(false);
    }
  };

  return (
    <div className="modal" onMouseDown={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="sheet sv-sheet">
        <div className="sheethead">
          <b>{draft.id ? "Edit view" : "New view"}</b>
          <button className="btn ghost sm" onClick={onCancel}><X size={13} /></button>
        </div>

        <div className="sv-body">
          <div className="sv-lead">Show trades where</div>

          <div className="sv-rules">
            {f.rules.map((r, i) => (
              <div key={i}>
                {i > 0 && (
                  /* The conjunction is a control, not a label — one word between
                     the rows rather than a dropdown above them, because that is
                     where you read it. It applies to the whole list: mixing and
                     with or in a flat set has no unambiguous meaning. */
                  <button type="button" className="sv-conj" onClick={() => setF((s) => ({
                    ...s, conjunction: s.conjunction === "and" ? "or" : "and",
                  }))} title="Switch between and / or">
                    {f.conjunction}
                  </button>
                )}
                <RuleRow rule={r} symbols={symbols} canRemove={f.rules.length > 1 || !!r.field}
                         onChange={(x) => setRule(i, x)} onRemove={() => dropRule(i)} />
              </div>
            ))}
          </div>

          <button type="button" className="btn ghost sm sv-addrule" onClick={addRule}>
            <Plus size={12} />Add condition
          </button>

          {/* The whole point of the panel: you are never building blind. */}
          <div className="sv-preview">
            <div className="sv-count">
              <b>{live ? hits.length : all.length}</b>
              <span>of {all.length} trades{live ? " match" : " — no conditions yet"}</span>
            </div>
            {live > 0 && (
              hits.length === 0
                ? <div className="sv-none">Nothing matches. Loosen a condition above.</div>
                : <div className="sv-rows">
                    {hits.slice(0, 6).map((t) => (
                      <div key={t.id} className="sv-row">
                        <span className="sv-sym">{t.symbol}</span>
                        <span className="sv-d">{dmy(t.entry_date)}</span>
                        <span className="sv-p" data-neg={t.pnl < 0 ? 1 : 0}>
                          {isFinite(t.pnl) ? rupee(t.pnl) : "—"}
                        </span>
                        {/* rfmt already carries the R and the sign, and already
                            renders an em dash when there is none. */}
                        <span className="sv-r">{rfmt(t.r, 1)}</span>
                      </div>
                    ))}
                    {hits.length > 6 && (
                      <div className="sv-more">and {hits.length - 6} more</div>
                    )}
                  </div>
            )}
          </div>
        </div>

        <div className="sv-foot">
          <label className="sv-name">
            <span>Name</span>
            <input className="in" value={name} placeholder="Name this view"
                   onChange={(e) => { setName(e.target.value); setTouchedName(true); }} />
          </label>
          <div className="sv-foot-r">
            {(err || clash) && (
              <span className="sv-err">{err || "Saving replaces the view with this name."}</span>
            )}
            <button className="btn ghost" onClick={onCancel}>Cancel</button>
            <button className="btn" onClick={save} disabled={saving || !live || !name.trim()}>
              {saving ? "Saving…" : draft.id ? "Save changes" : "Save view"}
            </button>
          </div>
        </div>
      </div>
      <Styles />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  The menu
 * ------------------------------------------------------------------ */

export default function SavedViews({ all = [], filters = [], activeId = null,
                                     onApply, onSave, onDelete, seed = null }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(null);
  const wrap = useRef(null);

  useEffect(() => {
    if (!open) return;
    const away = (e) => { if (wrap.current && !wrap.current.contains(e.target)) setOpen(false); };
    const esc = (e) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", away);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);

  /* Counted against the same book the table is showing, so the menu is
     informative before you click anything — and a view that has gone empty
     says so rather than looking like a broken filter after you apply it. */
  const counts = useMemo(() => {
    const m = new Map();
    for (const f of filters) m.set(f.id, (all || []).filter((t) => matches(t, f)).length);
    return m;
  }, [filters, all]);

  const active = filters.find((f) => f.id === activeId) || null;

  const remove = async (f) => {
    if (!window.confirm(`Delete the view "${f.name}"? The trades are not touched.`)) return;
    setBusy(f.id);
    try { await onDelete(f.id); } finally { setBusy(null); }
  };

  return (
    <div className="sv-wrap" ref={wrap}>
      <button className="btn ghost sm sv-btn" data-on={active ? 1 : 0}
              onClick={() => setOpen((o) => !o)}>
        <Filter size={12} />
        {active ? active.name : "Views"}
        <ChevronDown size={12} />
      </button>

      {open && (
        <div className="sv-menu">
          {filters.length === 0 ? (
            <div className="sv-empty">
              No saved views yet. Build one from any set of conditions —
              stop distance, tags, a financial year — and it lands here.
            </div>
          ) : (
            <div className="sv-list">
              {filters.map((f) => (
                <div key={f.id} className="sv-item" data-on={f.id === activeId ? 1 : 0}>
                  <button type="button" className="sv-pick"
                          onClick={() => { onApply(f.id === activeId ? null : f); setOpen(false); }}>
                    <span className="sv-check">{f.id === activeId ? <Check size={12} /> : null}</span>
                    <span className="sv-nm">{f.name}</span>
                    <span className="sv-n">{counts.get(f.id) ?? 0}</span>
                  </button>
                  <span className="sv-acts">
                    <button type="button" title="Edit" disabled={busy === f.id}
                            onClick={() => { setDraft({ ...f }); setOpen(false); }}>
                      <Pencil size={11} />
                    </button>
                    <button type="button" title="Delete" disabled={busy === f.id}
                            onClick={() => remove(f)}><Trash2 size={11} /></button>
                  </span>
                </div>
              ))}
            </div>
          )}

          <div className="sv-menufoot">
            {seed && seed.rules?.length > 0 && (
              /* The path most views will actually come from: you already
                 narrowed the table with the tabs, and this keeps what you are
                 looking at instead of asking you to rebuild it in a dialog. */
              <button type="button" onClick={() => { setDraft({ ...emptyFilter(), ...seed }); setOpen(false); }}>
                <Check size={12} />Save what I am looking at
              </button>
            )}
            <button type="button" onClick={() => { setDraft(emptyFilter()); setOpen(false); }}>
              <Plus size={12} />New view
            </button>
          </div>
        </div>
      )}

      {draft && (
        <Builder all={all} draft={draft} existing={filters}
                 onCancel={() => setDraft(null)}
                 onSave={async (f) => { await onSave(f); setDraft(null); }} />
      )}
      <Styles />
    </div>
  );
}

/* ------------------------------------------------------------------ *
 *  Styles
 *
 *  Global rather than scoped: RuleRow, ValueEditor and MultiPick are separate
 *  component functions in this file, and a non-global styled-jsx block only
 *  reaches markup rendered by the function that declares it. Every selector is
 *  prefixed sv- so the global scope stays honest.
 * ------------------------------------------------------------------ */

function Styles() {
  return (
    <style jsx global>{`
      .sv-wrap { position: relative; display: inline-block; }
      .sv-btn { display: inline-flex; align-items: center; gap: 6px; }
      .sv-btn[data-on="1"] { border-color: var(--brass); color: var(--brass); }

      .sv-menu { position: absolute; top: calc(100% + 6px); right: 0; z-index: 50;
        min-width: 268px; max-width: 340px; background: var(--card);
        border: 1px solid var(--rule); border-radius: 3px;
        box-shadow: 0 10px 28px rgba(19, 28, 26, 0.16); overflow: hidden; }
      .sv-empty { padding: 14px; font-size: 11.5px; line-height: 1.55; color: var(--ink3); }
      .sv-list { max-height: 320px; overflow-y: auto; padding: 4px; }
      .sv-item { display: flex; align-items: center; border-radius: 2px; }
      .sv-item:hover { background: var(--paper); }
      .sv-item[data-on="1"] .sv-nm { color: var(--brass); font-weight: 700; }
      .sv-pick { flex: 1; min-width: 0; display: flex; align-items: center; gap: 7px;
        background: transparent; border: 0; padding: 8px 6px; cursor: pointer;
        font: inherit; font-size: 12px; color: var(--ink); text-align: left; }
      .sv-check { width: 12px; flex: none; color: var(--brass); display: inline-flex; }
      .sv-nm { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis;
        white-space: nowrap; }
      .sv-n { flex: none; font-size: 10.5px; color: var(--ink3);
        font-variant-numeric: tabular-nums; }
      .sv-acts { display: none; gap: 2px; padding-right: 5px; }
      .sv-item:hover .sv-acts { display: flex; }
      .sv-item:hover .sv-n { display: none; }
      .sv-acts button { background: transparent; border: 0; padding: 4px; cursor: pointer;
        color: var(--ink3); display: inline-flex; border-radius: 2px; }
      .sv-acts button:hover { color: var(--ink); background: var(--card); }

      .sv-menufoot { border-top: 1px solid var(--rule); display: flex; flex-direction: column; }
      .sv-menufoot button { display: flex; align-items: center; gap: 7px; background: transparent;
        border: 0; padding: 9px 12px; cursor: pointer; font: inherit; font-size: 11.5px;
        font-weight: 600; color: var(--ink2); text-align: left; }
      .sv-menufoot button:hover { background: var(--paper); color: var(--ink); }

      /* ---- the builder ---- */
      .sv-sheet { width: min(760px, 94vw); max-height: 90vh; display: flex;
        flex-direction: column; }
      .sv-body { padding: 16px 18px; overflow-y: auto; }
      .sv-lead { font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em;
        text-transform: uppercase; color: var(--ink3); margin-bottom: 10px; }

      .sv-rules { display: flex; flex-direction: column; }
      .sv-rule { display: grid; grid-template-columns: 168px 148px 1fr 28px;
        gap: 8px; align-items: start; }
      .sv-conj { margin: 5px 0 5px 12px; background: transparent; border: 1px solid var(--rule);
        border-radius: 999px; padding: 1px 11px; font: inherit; font-size: 10.5px;
        font-weight: 700; letter-spacing: 0.05em; text-transform: uppercase;
        color: var(--brass); cursor: pointer; }
      .sv-conj:hover { border-color: var(--brass); background: var(--paper); }
      .sv-field, .sv-op, .sv-val { width: 100%; font-size: 12px; }
      .sv-op:disabled { opacity: 0.45; }
      .sv-value { min-width: 0; }
      .sv-novalue { font-size: 11px; color: var(--ink3); padding: 8px 2px; }
      .sv-x { background: transparent; border: 0; color: var(--ink3); cursor: pointer;
        padding: 8px 0; display: inline-flex; justify-content: center; }
      .sv-x:hover:not(:disabled) { color: var(--short); }
      .sv-x:disabled { opacity: 0.25; cursor: default; }

      .sv-pair { display: flex; align-items: center; gap: 7px; }
      .sv-and { font-size: 10.5px; color: var(--ink3); flex: none; }
      .sv-num { position: relative; display: flex; align-items: center; flex: 1; min-width: 0; }
      .sv-num i { position: absolute; font-style: normal; font-size: 11px; color: var(--ink3);
        pointer-events: none; }
      .sv-num i:first-child { left: 9px; }
      .sv-num i:last-child { right: 9px; }
      .sv-num:has(i:first-child) .sv-val { padding-left: 20px; }

      .sv-multi { display: flex; flex-wrap: wrap; gap: 5px; align-items: center;
        border: 1px solid var(--rule); border-radius: 2px; padding: 5px 6px;
        background: var(--card); min-height: 34px; }
      .sv-tag { display: inline-flex; align-items: center; gap: 4px; background: var(--paper);
        border: 1px solid var(--rule); border-radius: 2px; padding: 2px 4px 2px 7px;
        font-size: 11px; color: var(--ink); }
      .sv-tag button { background: transparent; border: 0; padding: 1px; cursor: pointer;
        color: var(--ink3); display: inline-flex; }
      .sv-tag button:hover { color: var(--short); }
      .sv-add { border: 0; background: transparent; font: inherit; font-size: 11px;
        color: var(--ink3); cursor: pointer; outline: none; padding: 2px; }

      /* ---- live preview ---- */
      .sv-addrule { margin-top: 10px; }
      .sv-preview { margin-top: 16px; border-top: 1px solid var(--rule); padding-top: 12px; }
      .sv-count { display: flex; align-items: baseline; gap: 7px; }
      .sv-count b { font-size: 19px; color: var(--ink); font-variant-numeric: tabular-nums; }
      .sv-count span { font-size: 11.5px; color: var(--ink3); }
      .sv-none { margin-top: 8px; font-size: 11.5px; color: var(--ink3); }
      .sv-rows { margin-top: 8px; border: 1px solid var(--rule); border-radius: 2px;
        overflow: hidden; }
      .sv-row { display: grid; grid-template-columns: 1fr 92px 108px 60px; gap: 8px;
        padding: 6px 10px; font-size: 11.5px; border-bottom: 1px solid var(--rule);
        align-items: center; }
      .sv-row:last-child { border-bottom: 0; }
      .sv-sym { font-weight: 600; color: var(--ink); overflow: hidden;
        text-overflow: ellipsis; white-space: nowrap; }
      .sv-d { color: var(--ink3); font-variant-numeric: tabular-nums; }
      .sv-p, .sv-r { text-align: right; font-variant-numeric: tabular-nums; color: var(--long); }
      .sv-p[data-neg="1"] { color: var(--short); }
      .sv-r { color: var(--ink2); }
      .sv-more { padding: 6px 10px; font-size: 11px; color: var(--ink3);
        background: var(--paper); }

      /* ---- footer ---- */
      .sv-foot { border-top: 1px solid var(--rule); padding: 12px 18px;
        display: flex; align-items: center; gap: 16px; flex-wrap: wrap; }
      .sv-name { display: flex; align-items: center; gap: 9px; flex: 1; min-width: 220px; }
      .sv-name span { font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em;
        text-transform: uppercase; color: var(--ink3); flex: none; }
      .sv-name .in { flex: 1; min-width: 0; font-size: 12px; }
      .sv-foot-r { display: flex; align-items: center; gap: 9px; margin-left: auto; }
      .sv-err { font-size: 11px; color: var(--short); max-width: 260px; }

      @media (max-width: 720px) {
        .sv-rule { grid-template-columns: 1fr 1fr; grid-template-areas:
          "field field" "op x" "value value"; }
        .sv-field { grid-area: field; }
        .sv-op { grid-area: op; }
        .sv-value { grid-area: value; }
        .sv-x { grid-area: x; justify-self: end; }
        .sv-rules > div + div { margin-top: 4px; }
        .sv-rule { padding-bottom: 10px; border-bottom: 1px dashed var(--rule); }

        /* The three fixed columns add up to more than a phone is wide, so the
           symbol's 1fr resolved to zero and the preview listed six unnamed
           rows. R is the one to drop: the question this panel answers is
           "did I get the right trades", and that is symbol and date. */
        .sv-row { grid-template-columns: 1fr 74px 80px; }
        .sv-row .sv-r { display: none; }
      }
    `}</style>
  );
}
