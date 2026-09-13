import { useEffect } from "react";
import { useDispatch, useSelector } from "react-redux";
import { fetchIndustriesRequested, fetchRequested, fetchSectorsRequested, setFilters } from "./companiesSlice";
import { SearchIcon } from "../../layout/icons";

const RANGE_FIELDS = [
  { key: "market_cap", label: "Market Cap ($)" },
  { key: "trailing_pe", label: "Trailing P/E" },
  { key: "roe", label: "ROE" },
  { key: "roa", label: "ROA" },
  { key: "debt_to_equity", label: "Debt/Equity" },
  { key: "current_ratio", label: "Current Ratio" },
  { key: "gross_margin", label: "Gross Margin" },
  { key: "net_margin", label: "Net Margin" },
  { key: "dividend_yield", label: "Dividend Yield" },
];

export default function CompanyFilters() {
  const dispatch = useDispatch();
  const { filters, sectors, industries } = useSelector((s) => s.companies);

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

  const onSectorChange = (e) => {
    dispatch(setFilters({ sector: e.target.value, industry: "" }));
    dispatch(fetchIndustriesRequested());
  };

  const onRangeChange = (key, side, value) => {
    const current = filters.ranges[key] || ["", ""];
    const next = side === "min" ? [value, current[1]] : [current[0], value];
    dispatch(setFilters({ ranges: { ...filters.ranges, [key]: next } }));
  };

  return (
    <form className="card" onSubmit={submit}>
      <h3>Screen companies</h3>
      <div className="filters-grid">
        <div>
          <label>Search name / ticker</label>
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

      <div className="filters-grid">
        {RANGE_FIELDS.map(({ key, label }) => {
          const [min, max] = filters.ranges[key] || ["", ""];
          return (
            <div key={key}>
              <label>{label}</label>
              <div style={{ display: "flex", gap: 4 }}>
                <input placeholder="min" value={min} onChange={(e) => onRangeChange(key, "min", e.target.value)} />
                <input placeholder="max" value={max} onChange={(e) => onRangeChange(key, "max", e.target.value)} />
              </div>
            </div>
          );
        })}
      </div>

      <button className="btn" type="submit"><SearchIcon /> Search</button>
    </form>
  );
}
