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
  return { sector: filters.sector || "", industry: filters.industry || "", q: filters.q || "", ranges };
}

function buildParams(filters) {
  const params = {
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

function* handleFetch() {
  try {
    yield put(fetchStarted());
    const filters = yield select((state) => state.companies.filters);
    const { data } = yield call(apiClient.get, "/api/companies", { params: buildParams(filters) });
    yield put(fetchSucceeded(data));
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
