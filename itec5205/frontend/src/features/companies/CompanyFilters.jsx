import { useState, useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { clearFilters, fetchIndustriesRequested, fetchRequested, fetchSectorsRequested, setFilters } from "./companiesSlice";
import BackButton from "../../layout/BackButton";
import { CloseIcon, EraserIcon, SearchIcon, SlidersIcon } from "../../layout/icons";
import FilterTabs from "./FilterTabs";
import { INDEXES, UNIT_LABELS, UNIT_MULTIPLIERS, activeFilters } from "./filterFields";
import { getSettings } from "../settings/settings";

const EMPTY_UNIT_VALUES = { market_cap: ["", ""], free_cash_flow: ["", ""] };
const defaultUnits = () => ({ market_cap: getSettings().screening.market_cap_unit, free_cash_flow: getSettings().screening.fcf_unit });

export default function CompanyFilters() {
  const dispatch = useDispatch();
  const { filters, sectors, industries } = useSelector((s) => s.companies);
  const [units, setUnits] = useState(() => ({ ...defaultUnits(), ...(filters.units || {}) }));
  // Typed values in the picked unit, rebuilt from the stored-unit ranges
  // (e.g. a start criteria from the settings, or coming back to the page).
  const [rawUnitValues, setRawUnitValues] = useState(() =>
    Object.fromEntries(
      Object.keys(EMPTY_UNIT_VALUES).map((key) => {
        const unit = { ...defaultUnits(), ...(filters.units || {}) }[key];
        const toRaw = (v) => (v === "" || v == null ? "" : Number(v) / UNIT_MULTIPLIERS[key][unit]);
        const [min, max] = filters.ranges[key] || ["", ""];
        return [key, [toRaw(min), toRaw(max)]];
      })
    )
  );

  useEffect(() => {
    dispatch(fetchSectorsRequested());
    dispatch(fetchIndustriesRequested());
    dispatch(fetchRequested());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const apply = () => {
    dispatch(setFilters({ offset: 0 }));
    dispatch(fetchRequested());
  };

  const submit = (e) => {
    e.preventDefault();
    apply();
  };

  const clear = () => {
    dispatch(clearFilters());
    setUnits(defaultUnits());
    setRawUnitValues(EMPTY_UNIT_VALUES);
    dispatch(fetchIndustriesRequested()); // sector is cleared -> all industries again
    dispatch(fetchRequested());
  };

  // Removing a chip clears that one field and re-runs the search.
  const removeFilter = (field) => {
    if (field === "q") dispatch(setFilters({ q: "" }));
    else if (field === "index") dispatch(setFilters({ index: "" }));
    else if (field === "sector") {
      dispatch(setFilters({ sector: "", industry: "" }));
      dispatch(fetchIndustriesRequested());
    } else if (field === "industry") dispatch(setFilters({ industry: "" }));
    else {
      const { [field]: _removed, ...rest } = filters.ranges;
      dispatch(setFilters({ ranges: rest }));
      if (field in EMPTY_UNIT_VALUES) setRawUnitValues((r) => ({ ...r, [field]: ["", ""] }));
    }
    apply();
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

  const active = activeFilters(filters);

  return (
    <form className="card" onSubmit={submit}>
      <div className="card-header" style={{ flexWrap: "wrap" }}>
        <div className="icon-badge" style={{ background: "rgba(59,130,246,0.15)", color: "#3b82f6", width: 48, height: 48, borderRadius: 12 }}>
          <SlidersIcon width={24} height={24} />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <h2 style={{ margin: 0, fontSize: "1.3rem" }}>Stock Screener</h2>
          <p className="muted" style={{ margin: 0 }}>Filter S&amp;P 500 and Russell 3000 companies using fundamental metrics</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <button className="btn secondary" type="button" onClick={clear} title="Clear every search field and signal filter"><EraserIcon /> Clear All</button>
          <button className="btn" type="submit"><SearchIcon /> Apply Filters</button>
          <BackButton />
        </div>
      </div>

      <div className="screener-search-row">
        <div>
          <label htmlFor="screener-q">Search</label>
          <label className="search-box" htmlFor="screener-q">
            <SearchIcon width={15} height={15} />
            <input id="screener-q" value={filters.q} onChange={(e) => dispatch(setFilters({ q: e.target.value }))} placeholder="Search companies (e.g. Apple or AAPL)" />
          </label>
        </div>
        <div>
          <label htmlFor="screener-index">Index</label>
          <select id="screener-index" value={filters.index || ""} onChange={(e) => dispatch(setFilters({ index: e.target.value }))}>
            <option value="">All imported companies</option>
            {INDEXES.map((i) => (
              <option key={i.value} value={i.value}>{i.label}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="screener-sector">Sector</label>
          <select id="screener-sector" value={filters.sector} onChange={onSectorChange}>
            <option value="">All sectors</option>
            {sectors.map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="screener-industry">Industry</label>
          <select id="screener-industry" value={filters.industry} onChange={(e) => dispatch(setFilters({ industry: e.target.value }))}>
            <option value="">All industries</option>
            {industries.map((i) => (
              <option key={i} value={i}>{i}</option>
            ))}
          </select>
        </div>
      </div>

      <FilterTabs
        filters={filters}
        renderInputs={({ key, label, percent, unit }) => {
          if (unit) {
            const [rawMin, rawMax] = rawUnitValues[key] || ["", ""];
            return (
              <>
                <input placeholder="min" value={rawMin} onChange={(e) => onUnitRangeChange(key, "min", e.target.value)} />
                <input placeholder="max" value={rawMax} onChange={(e) => onUnitRangeChange(key, "max", e.target.value)} />
                <select className="ft-unit" value={units[key]} onChange={(e) => onUnitChange(key, e.target.value)} title="Unit for min / max" aria-label={`${label} unit`}>
                  {Object.entries(UNIT_LABELS).map(([u, l]) => (
                    <option key={u} value={u} title={l}>{u}</option>
                  ))}
                </select>
              </>
            );
          }
          const [min, max] = filters.ranges[key] || ["", ""];
          return (
            <>
              <input placeholder={percent ? "min %" : "min"} value={min} onChange={(e) => onRangeChange(key, "min", e.target.value)} />
              <input placeholder={percent ? "max %" : "max"} value={max} onChange={(e) => onRangeChange(key, "max", e.target.value)} />
            </>
          );
        }}
      />

      <div className="active-filters">
        <strong>Active filters ({active.length})</strong>
        {active.length === 0 && <span className="muted">None — all S&amp;P 500 companies</span>}
        {active.map((f) => (
          <span key={f.id} className="filter-chip">
            {f.label}
            <button type="button" onClick={() => removeFilter(f.field)} title="Remove this filter" aria-label={`Remove ${f.label}`}>
              <CloseIcon width={12} height={12} />
            </button>
          </span>
        ))}
        {active.length > 0 && (
          <button type="button" className="link-btn clear-all" onClick={clear}>Clear all</button>
        )}
      </div>
    </form>
  );
}
