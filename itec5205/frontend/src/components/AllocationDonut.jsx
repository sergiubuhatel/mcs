// Categorical slots in fixed order (validated palette), light / dark steps.
export const SLOT_COLORS = {
  light: ["#2a78d6", "#1baf7a", "#eb6834", "#6250d6", "#eda100", "#e87ba4", "#008300", "#e34948"],
  dark: ["#3987e5", "#199e70", "#d95926", "#9085e9", "#c98500", "#d55181", "#008300", "#e66767"],
};

const fmtAlloc = (v) => (Number.isFinite(v) ? `${+v.toFixed(2)}%` : "–");

/** Donut of the allocations; 2px surface gaps, direct % labels (plus an
 * optional short `sublabel`, e.g. the part's tickers), hover title. */
export default function AllocationDonut({ parts, colors, size = 240, centerLabel = "TOTAL" }) {
  const r = size * 0.46;
  const inner = size * 0.2;
  const c = size / 2;
  const total = parts.reduce((s, p) => s + p.value, 0);
  if (!(total > 0)) return null;
  let angle = -Math.PI / 2;
  const point = (a, radius) => [c + radius * Math.cos(a), c + radius * Math.sin(a)];
  return (
    <svg viewBox={`0 0 ${size} ${size}`} width={size} height={size} role="img" aria-label="Allocation of the total portfolio" style={{ maxWidth: "100%" }}>
      {parts.map((p, i) => {
        const sweep = (p.value / total) * Math.PI * 2;
        const start = angle;
        const end = angle + sweep;
        angle = end;
        const large = sweep > Math.PI ? 1 : 0;
        const [x1, y1] = point(start, r);
        const [x2, y2] = point(end, r);
        const [x3, y3] = point(end, inner);
        const [x4, y4] = point(start, inner);
        const d =
          parts.length === 1
            ? `M ${c} ${c - r} A ${r} ${r} 0 1 1 ${c - 0.01} ${c - r} L ${c - 0.01} ${c - inner} A ${inner} ${inner} 0 1 0 ${c} ${c - inner} Z`
            : `M ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} L ${x3} ${y3} A ${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
        const [lx, ly] = point(start + sweep / 2, (r + inner) / 2);
        const share = p.value / total;
        const big = size >= 300;
        return (
          <g key={p.key}>
            <path d={d} fill={colors[i % colors.length]} stroke="var(--color-bg-secondary)" strokeWidth="2">
              <title>{`${p.label}: ${fmtAlloc(p.value)}`}</title>
            </path>
            {share >= 0.07 && (
              <text x={lx} y={p.sublabel && share >= 0.15 ? ly - 8 : ly} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={big ? 20 : 13} fontWeight="700" pointerEvents="none">
                {fmtAlloc(p.value)}
              </text>
            )}
            {p.sublabel && share >= 0.15 && (
              <text x={lx} y={ly + (big ? 14 : 10)} textAnchor="middle" dominantBaseline="central" fill="#fff" fontSize={big ? 11 : 9} fontWeight="600" pointerEvents="none">
                {p.sublabel}
              </text>
            )}
          </g>
        );
      })}
      <text x={c} y={c - 10} textAnchor="middle" fill="var(--color-text-secondary)" fontSize={size >= 300 ? 12 : 11}>{centerLabel}</text>
      <text x={c} y={c + 12} textAnchor="middle" fill="var(--color-text-primary)" fontSize={size >= 300 ? 22 : 18} fontWeight="700">{fmtAlloc(total)}</text>
    </svg>
  );
}
