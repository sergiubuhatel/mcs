import { call, put, select, takeLatest } from "redux-saga/effects";
import { apiClient } from "../../api/client";
import {
  fetchFailed,
  fetchIndustriesRequested,
  fetchIndustriesSucceeded,
  fetchRequested,
  fetchSectorsRequested,
  fetchSectorsSucceeded,
  fetchStarted,
  fetchSucceeded,
} from "./companiesSlice";
import { rememberScreener } from "../settings/settings";

// Fields where the UI takes a plain percentage (e.g. 20 for 20%) but the
// stored/filtered value is the decimal fraction (0.20) yfinance returns --
// kept in sync with the `percent: true` entries in CompanyFilters.jsx.
const PERCENT_RANGE_FIELDS = new Set([
  "revenue_growth_yoy",
  "earnings_growth_yoy_q",
  "day_change",
  "stock_growth_1y",
  "volatility",
]);

// The screener search in API units, saved with a pool so the backend can
// re-check later whether each ticker still passes it (fundamentals star).
export function screenCriteria(filters) {
  const params = buildParams(filters);
  const ranges = {};
  for (const [key, value] of Object.entries(params)) {
    const m = key.match(/^(.*)_(min|max)$/);
    if (!m) continue;
    ranges[m[1]] = ranges[m[1]] || [null, null];
    ranges[m[1]][m[2] === "min" ? 0 : 1] = value;
  }
  return { index: filters.index || "", sector: filters.sector || "", industry: filters.industry || "", q: filters.q || "", ranges };
}

export function buildParams(filters) {
  const params = {
    index: filters.index || undefined,
    sector: filters.sector || undefined,
    industry: filters.industry || undefined,
    q: filters.q || undefined,
    sort_by: filters.sortBy,
    sort_dir: filters.sortDir,
    limit: filters.limit,
    offset: filters.offset,
  };
  for (const [key, [min, max]] of Object.entries(filters.ranges || {})) {
    const scale = PERCENT_RANGE_FIELDS.has(key) ? 100 : 1;
    if (min !== "" && min !== undefined && min !== null) params[`${key}_min`] = Number(min) / scale;
    if (max !== "" && max !== undefined && max !== null) params[`${key}_max`] = Number(max) / scale;
  }
  return params;
}

const SIGNAL_RANK = { Strong: 3, Mixed: 2, Weak: 1, Avoid: 0 };

function* handleFetch() {
  try {
    yield put(fetchStarted());
    const filters = yield select((state) => state.companies.filters);
    if (filters.sortBy === "signal" || filters.signal) {
      // The signal isn't a stored field the API can sort or filter on: fetch
      // every result in the requested order, then filter / sort and page here.
      const signals = yield select((state) => state.companies.signals);
      const bySignal = filters.sortBy === "signal";
      const params = { ...buildParams(filters), limit: 600, offset: 0 };
      if (bySignal) Object.assign(params, { sort_by: "market_cap", sort_dir: "desc" }); // tie-break
      const { data } = yield call(apiClient.get, "/api/companies", { params });
      let rows = filters.signal ? data.results.filter((r) => signals[r.ticker] === filters.signal) : data.results;
      if (bySignal) {
        const rank = (r) => SIGNAL_RANK[signals[r.ticker]] ?? -1;
        rows = rows
          .map((r, i) => [r, i])
          .sort(([a, i], [b, j]) => (filters.sortDir === "desc" ? rank(b) - rank(a) : rank(a) - rank(b)) || i - j)
          .map(([r]) => r);
      }
      yield put(fetchSucceeded({ ...data, total: rows.length, results: rows.slice(filters.offset, filters.offset + filters.limit) }));
      rememberScreener(filters);
      return;
    }
    const { data } = yield call(apiClient.get, "/api/companies", { params: buildParams(filters) });
    yield put(fetchSucceeded(data));
    rememberScreener(filters);
  } catch (err) {
    yield put(fetchFailed(err.message));
  }
}

function* handleFetchSectors() {
  try {
    const { data } = yield call(apiClient.get, "/api/companies/sectors");
    yield put(fetchSectorsSucceeded(data.sectors));
  } catch (err) {
    // non-fatal: leave the sector dropdown empty
  }
}

function* handleFetchIndustries() {
  try {
    const sector = yield select((state) => state.companies.filters.sector);
    const { data } = yield call(apiClient.get, "/api/companies/industries", {
      params: sector ? { sector } : {},
    });
    yield put(fetchIndustriesSucceeded(data.industries));
  } catch (err) {
    // non-fatal
  }
}

export default function* companiesSaga() {
  yield takeLatest(fetchRequested.type, handleFetch);
  yield takeLatest(fetchSectorsRequested.type, handleFetchSectors);
  yield takeLatest(fetchIndustriesRequested.type, handleFetchIndustries);
}
