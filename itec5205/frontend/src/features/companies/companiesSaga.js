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
    if (min !== "" && min !== undefined && min !== null) params[`${key}_min`] = min;
    if (max !== "" && max !== undefined && max !== null) params[`${key}_max`] = max;
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
