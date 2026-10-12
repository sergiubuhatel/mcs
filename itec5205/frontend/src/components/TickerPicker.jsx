import { useEffect, useMemo, useRef, useState } from "react";
import { apiClient } from "../api/client";
import { CheckIcon } from "../layout/icons";

const MAX_SUGGESTIONS = 8;

// Every stored company (ticker + name), fetched once per page load.
let companiesPromise = null;
function loadCompanies() {
  if (!companiesPromise) {
    companiesPromise = apiClient
      .get("/api/companies", { params: { limit: 600, offset: 0, sort_by: "ticker", sort_dir: "asc" } })
      .then(({ data }) => data.results.map((r) => ({ ticker: r.ticker, name: r.name || "" })))
      .catch((err) => {
        companiesPromise = null; // retry next time
        throw err;
      });
  }
  return companiesPromise;
}

/** Pick tickers one at a time: type a ticker or company name, choose a
 * suggestion (or press Enter), and it's added as a chip (click it to remove
 * it) while the field clears for the next one. `options` limits the choice to those tickers
 * (e.g. a pool's companies). */
export default function TickerPicker({ value, onChange, options, disabled, placeholder = "Type a ticker or company name, then Enter" }) {
  const [companies, setCompanies] = useState([]);
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [message, setMessage] = useState(null);
  const boxRef = useRef(null);

  useEffect(() => {
    loadCompanies().then(setCompanies).catch(() => setMessage("Couldn't load the company list."));
  }, []);

  useEffect(() => {
    const close = (e) => boxRef.current && !boxRef.current.contains(e.target) && setOpen(false);
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const byTicker = useMemo(() => Object.fromEntries(companies.map((c) => [c.ticker, c])), [companies]);
  const allowed = useMemo(() => (options ? new Set(options) : null), [options]);
  const pool = useMemo(
    () => (options ? options.map((t) => byTicker[t] || { ticker: t, name: "" }) : companies),
    [options, companies, byTicker]
  );

  const q = query.trim().toUpperCase();
  const suggestions = useMemo(() => {
    const free = pool.filter((c) => !value.includes(c.ticker));
    if (!q) return options ? free.slice(0, MAX_SUGGESTIONS) : [];
    const starts = free.filter((c) => c.ticker.startsWith(q));
    const named = free.filter((c) => !c.ticker.startsWith(q) && c.name.toUpperCase().includes(q));
    return [...starts, ...named].slice(0, MAX_SUGGESTIONS);
  }, [pool, value, q, options]);

  const add = (ticker) => {
    if (!value.includes(ticker)) onChange([...value, ticker]);
    setQuery("");
    setMessage(null);
    setActive(0);
  };

  const remove = (ticker) => onChange(value.filter((t) => t !== ticker));

  // Enter with no suggestion picked: an exact ticker, or say why not.
  const submit = () => {
    if (!q) return;
    if (open && suggestions[active]) return add(suggestions[active].ticker);
    if (value.includes(q)) return setMessage(`${q} is already in the list.`);
    if (allowed && !allowed.has(q)) {
      return setMessage(byTicker[q] ? `${q} (${byTicker[q].name}) isn't in this pool.` : `No company in this pool matches "${query.trim()}".`);
    }
    if (!allowed && !byTicker[q]) return setMessage(`No S&P 500 company matches "${query.trim()}".`);
    add(q);
  };

  const onKeyDown = (e) => {
    if (e.key === "Enter") {
      e.preventDefault(); // don't submit the surrounding form
      submit();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
      setActive((i) => Math.min(i + 1, suggestions.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "Backspace" && !query && value.length) {
      remove(value[value.length - 1]);
    }
  };

  const noMatch = q && open && suggestions.length === 0;

  return (
    <div className="ticker-picker" ref={boxRef}>
      <div className={`ticker-picker-box${disabled ? " disabled" : ""}`}>
        {value.map((t) => (
          <button
            key={t}
            type="button"
            className="ticker-chip mandatory"
            onClick={() => remove(t)}
            disabled={disabled}
            title={`${t}${byTicker[t]?.name ? ` — ${byTicker[t].name}` : ""}: mandatory — click to remove`}
          >
            <CheckIcon />
            {t}
            {byTicker[t]?.name && <span className="chip-name">{byTicker[t].name}</span>}
          </button>
        ))}
        <input
          value={query}
          disabled={disabled}
          placeholder={value.length ? "Add another…" : placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
            setMessage(null);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
      </div>
      {open && !disabled && (suggestions.length > 0 || noMatch) && (
        <ul className="ticker-picker-list" role="listbox">
          {suggestions.map((c, i) => (
            <li
              key={c.ticker}
              role="option"
              aria-selected={i === active}
              className={i === active ? "active" : ""}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => {
                e.preventDefault(); // keep the input focused
                add(c.ticker);
              }}
            >
              <strong>{c.ticker}</strong>
              <span>{c.name}</span>
            </li>
          ))}
          {noMatch && (
            <li className="empty">
              {allowed ? `No company in this pool matches "${query.trim()}"` : `No S&P 500 company matches "${query.trim()}"`}
            </li>
          )}
        </ul>
      )}
      {message && <p className="error-text" style={{ margin: "4px 0 0" }}>{message}</p>}
    </div>
  );
}
