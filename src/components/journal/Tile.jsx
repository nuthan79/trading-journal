"use client";

export default function Tile({ label, value, sub, tone, hint }) {
  return (
    <div className="tile" title={hint || undefined}>
      <div className="eyebrow">{label}</div>
      <div className={`v mono ${tone || ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
