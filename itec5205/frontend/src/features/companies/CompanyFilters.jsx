import { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { clearFilters, fetchIndustriesRequested, fetchRequested, fetchSectorsRequested, setFilters } from "./companiesSlice";
import { SearchIcon } from "../../layout/icons";
import { FILTER_GROUPS, UNIT_LABELS, UNIT_MULTIPLIERS } from "./filterFields";

export default function CompanyFilters() {
  const dispatch = useDispatch();
  const { filters, sectors, industries } = useSelector((s) => s.companies);
  const [units, setUnits] = useState({ market_cap: "B", free_cash_flow: "B" });
  const [rawUnitValues, setRawUnitValues] = useState({ market_cap: ["", ""], free_cash_flow: ["", ""] });

  useEffect(() => {
    dispatch(fetchSectorsRequested());
    dispatch(fetchIndustriesRequested());
    dispatch(fetchRequested());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = (e) => {
    e.preventDefault();
    dispatch(setFilters({ offset: 0 }));
    dispatch(fetchRequested());
  };

  const clear = () => {
    dispatch(clearFilters());
    setUnits({ market_cap: "B", free_cash_flow: "B" });
    setRawUnitValues({ market_cap: ["", ""], free_cash_flow: ["", ""] });
    dispatch(fetchIndustriesRequested()); // sector is cleared -> all industries again
    dispatch(fetchRequested());
  };

  const onSectorChange = (e) => {
    dispatch(setFilters({ sector: e.target.value, industry: "" }));
    dispatch(fetchIndustriesRequested());
  };

  const onRangeChange = (key, side, value) => {
    const current = filters.ranges[key] || ["", ""];
    const next = side === "min" ? [value, current[1]] : [current[0], value];
    dispatch(setFilters({ ranges: { ...filters.ranges, [key]: next } }));
  };

  const dispatchUnitRange = (key, [rawMin, rawMax], unit) => {
    const mult = UNIT_MULTIPLIERS[key][unit];
    const convert = (v) => (v === "" ? "" : Number(v) * mult);
    dispatch(setFilters({ ranges: { ...filters.ranges, [key]: [convert(rawMin), convert(rawMax)] } }));
  };

  const onUnitRangeChange = (key, side, value) => {
    const current = rawUnitValues[key] || ["", ""];
    const next = side === "min" ? [value, current[1]] : [current[0], value];
    setRawUnitValues((r) => ({ ...r, [key]: next }));
    dispatchUnitRange(key, next, units[key]);
  };

  const onUnitChange = (key, unit) => {
    setUnits((u) => ({ ...u, [key]: unit }));
    dispatchUnitRange(key, rawUnitValues[key] || ["", ""], unit);
  };

  return (
    <form className="card" onSubmit={submit}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap", gap: 12, marginBottom: 16 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div className="icon-badge" style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6" }}>
            <SearchIcon width={18} height={18} />
          </div>
          <div>
            <h3 style={{ margin: 0 }}>Stock Screener</h3>
            <p className="muted" style={{ margin: 0 }}>Filter S&amp;P 500 companies using fundamental metrics</p>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className="btn secondary" type="button" onClick={clear}>Clear</button>
          <button className="btn" type="submit"><SearchIcon /> Search</button>
        </div>
      </div>

      <div className="filters-grid">
        <div>
          <label>Search Companies</label>
          <input value={filters.q} onChange={(e) => dispatch(setFilters({ q: e.target.value }))} placeholder="e.g. Apple or AAPL" />
        </div>
        <div>
          <label>Sector</label>
          <select value={filters.sector} onChange={onSectorChange}>
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label>Industry</label>
          <select value={filters.industry} onChange={(e) => dispatch(setFilters({ industry: e.target.value }))}>
            <option value="">All industries</option>
            {industries.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 12 }}>
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
                if (unit) {
                  const [rawMin, rawMax] = rawUnitValues[key] || ["", ""];
                  return (
                    <div key={key}>
                      <label>{label} (${UNIT_LABELS[units[key]]})</label>
                      <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
                        <input
                          placeholder="min"
                          value={rawMin}
                          onChange={(e) => onUnitRangeChange(key, "min", e.target.value)}
                          style={{ flex: "1 1 0", minWidth: 0 }}
                        />
                        <input
                          placeholder="max"
                          value={rawMax}
                          onChange={(e) => onUnitRangeChange(key, "max", e.target.value)}
                          style={{ flex: "1 1 0", minWidth: 0 }}
                        />
                        <select
                          value={units[key]}
                          onChange={(e) => onUnitChange(key, e.target.value)}
                          style={{ flex: "1 1 100%", minWidth: 0 }}
                        >
                          {Object.entries(UNIT_LABELS).map(([u, l]) => (
                            <option key={u} value={u}>{l}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  );
                }
                const [min, max] = filters.ranges[key] || ["", ""];
                const minPlaceholder = percent ? "min % (e.g. 10)" : "min";
                const maxPlaceholder = percent ? "max % (e.g. 25)" : "max";
                return (
                  <div key={key}>
                    <label>{label}</label>
                    <div style={{ display: "flex", gap: 4 }}>
                      <input placeholder={minPlaceholder} value={min} onChange={(e) => onRangeChange(key, "min", e.target.value)} />
                      <input placeholder={maxPlaceholder} value={max} onChange={(e) => onRangeChange(key, "max", e.target.value)} />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </form>
  );
}
