import { WEIGHT_RANGE_BASES, WEIGHT_RANGE_HELP, weightRangeHint } from "./criteriaConfig";

/** Max weight range: a number plus what it's measured against (% of the
 * smallest / largest holding, or percentage points), with a worked example
 * of the typed value under it. */
export default function WeightRangeField({ value, basis, onChange, onBasisChange, disabled }) {
  const b = WEIGHT_RANGE_BASES[basis] ? basis : "smallest";
  return (
    <div>
      <label title={WEIGHT_RANGE_HELP}>Max weight range</label>
      <div style={{ display: "flex", gap: 6 }}>
        <input
          type="number"
          min="0"
          max={WEIGHT_RANGE_BASES[b].max}
          step="1"
          placeholder={`no limit (e.g. ${WEIGHT_RANGE_BASES[b].example})`}
          title={WEIGHT_RANGE_HELP}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          disabled={disabled}
          style={{ minWidth: 0, flex: 1 }}
        />
        <select
          value={b}
          onChange={(e) => onBasisChange(e.target.value)}
          disabled={disabled}
          title="What the range is measured against"
          style={{ width: "auto" }}
        >
          {Object.entries(WEIGHT_RANGE_BASES).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
      </div>
      <span className="muted field-hint">{weightRangeHint(value, b)}</span>
    </div>
  );
}
