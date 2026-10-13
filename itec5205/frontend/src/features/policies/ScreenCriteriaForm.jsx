import { useEffect, useState } from "react";
import { useSelector } from "react-redux";
import { apiClient } from "../../api/client";
import { buildParams } from "../companies/companiesSaga";
import { FILTER_GROUPS, INDEXES, UNIT_LABELS, UNIT_MULTIPLIERS } from "../companies/filterFields";

// `filters` has the screener's shape (see companiesSlice): percent fields as
// typed (20 = 20%), unit fields (market cap, FCF) in stored units, plus
// `units` -- the Million/Billion/Trillion picked for each unit field.
export default function ScreenCriteriaForm({ filters, onChange }) {
  const screenerFilters = useSelector((s) => s.companies.filters);
  const [sectors, setSectors] = useState([]);
  const [industries, setIndustries] = useState([]);
  const [matches, setMatches] = useState(null);
  const units = { market_cap: "B", free_cash_flow: "B", ...(filters.units || {}) };

  useEffect(() => {
    apiClient.get("/api/companies/sectors").then((r) => setSectors(r.data.sectors));
  }, []);

  useEffect(() => {
    apiClient
      .get("/api/companies/industries", { params: { sector: filters.sector || undefined } })
      .then((r) => setIndustries(r.data.industries));
  }, [filters.sector]);

  // Live "matches N companies" preview.
  useEffect(() => {
    const id = setTimeout(() => {
      apiClient
        .get("/api/companies", { params: { ...buildParams(filters), limit: 1, offset: 0 } })
        .then((r) => setMatches(r.data.total))
        .catch(() => setMatches(null));
    }, 400);
    return () => clearTimeout(id);
  }, [filters]);

  const set = (patch) => onChange({ ...filters, ...patch });
  const setRange = (key, side, value) => {
    const [min, max] = filters.ranges?.[key] || ["", ""];
    set({ ranges: { ...filters.ranges, [key]: side === "min" ? [value, max] : [min, value] } });
  };
  // Unit fields: typed in the picked unit, kept in stored units.
  const rawUnit = (key, stored) => (stored === "" || stored == null ? "" : Number(stored) / UNIT_MULTIPLIERS[key][units[key]]);
  const setUnitRange = (key, side, typed) => setRange(key, side, typed === "" ? "" : Number(typed) * UNIT_MULTIPLIERS[key][units[key]]);
  const setUnit = (key, unit) => set({ units: { ...units, [key]: unit } });

  const copyFromScreener = () =>
    set({ index: screenerFilters.index || "", sector: screenerFilters.sector, industry: screenerFilters.industry, q: screenerFilters.q, ranges: { ...screenerFilters.ranges } });

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, marginBottom: 10 }}>
        <span className="muted">
          {matches == null ? "Counting matches..." : <>Matches <strong>{matches}</strong> companies today</>}
        </span>
        <button type="button" className="btn secondary" onClick={copyFromScreener} title="Use the search currently filled in on the Stock Screener">
          Copy current Stock Screener search
        </button>
      </div>
      <div className="filters-grid">
        <div>
          <label>Search Companies</label>
          <input value={filters.q || ""} onChange={(e) => set({ q: e.target.value })} placeholder="e.g. Apple or AAPL" />
        </div>
        <div>
          <label>Index</label>
          <select value={filters.index || ""} onChange={(e) => set({ index: e.target.value })}>
            <option value="">All imported companies</option>
            {INDEXES.map((i) => <option key={i.value} value={i.value}>{i.label}</option>)}
          </select>
        </div>
        <div>
          <label>Sector</label>
          <select value={filters.sector || ""} onChange={(e) => set({ sector: e.target.value, industry: "" })}>
            <option value="">All sectors</option>
            {sectors.map((s) => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
        <div>
          <label>Industry</label>
          <select value={filters.industry || ""} onChange={(e) => set({ industry: e.target.value })}>
            <option value="">All industries</option>
            {industries.map((i) => <option key={i} value={i}>{i}</option>)}
          </select>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12 }}>
        {FILTER_GROUPS.map(({ title, icon: Icon, color, fields }) => (
          <div key={title} className="filter-group">
            <h4 style={{ color: "var(--color-text-primary)" }}>
              <span className="icon-badge" style={{ width: 26, height: 26, background: `${color}26`, color }}>
                <Icon width={14} height={14} />
              </span>
              {title}
            </h4>
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {fields.map(({ key, label, percent, unit }) => {
                const [min, max] = filters.ranges?.[key] || ["", ""];
                return (
                  <div key={key} className="filters-grid" style={{ margin: 0, gridTemplateColumns: "1fr" }}>
                    <label style={{ margin: 0 }}>{unit ? `${label} ($${UNIT_LABELS[units[key]]})` : label}</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input
                        placeholder={percent ? "min %" : "min"}
                        value={unit ? rawUnit(key, min) : min}
                        onChange={(e) => (unit ? setUnitRange(key, "min", e.target.value) : setRange(key, "min", e.target.value))}
                        style={{ flex: "1 1 0", minWidth: 0 }}
                      />
                      <input
                        placeholder={percent ? "max %" : "max"}
                        value={unit ? rawUnit(key, max) : max}
                        onChange={(e) => (unit ? setUnitRange(key, "max", e.target.value) : setRange(key, "max", e.target.value))}
                        style={{ flex: "1 1 0", minWidth: 0 }}
                      />
                      {unit && (
                        <select value={units[key]} onChange={(e) => setUnit(key, e.target.value)} style={{ flex: "0 0 auto", width: "auto" }}>
                          {Object.entries(UNIT_LABELS).map(([u, l]) => <option key={u} value={u}>{l}</option>)}
                        </select>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
