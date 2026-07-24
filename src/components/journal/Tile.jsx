"use client";

export default function Tile({ label, value, sub, tone }) {
  return (
    <div className="tile">
      <div className="eyebrow">{label}</div>
      <div className={`v mono ${tone || ""}`}>{value}</div>
      {sub && <div className="sub">{sub}</div>}
    </div>
  );
}
