import { call, put, takeLatest } from "redux-saga/effects";
import { toast } from "react-toastify";
import { apiClient } from "../../api/client";
import {
  createFailed,
  createRequested,
  createSucceeded,
  deleteRequested,
  deleteSucceeded,
  fetchFailed,
  fetchRequested,
  fetchStarted,
  fetchSucceeded,
  updateFailed,
  updateRequested,
  updateSucceeded,
} from "./portfoliosSlice";

const withLive = (p) =>
  p.live
    ? { ...p, annual_return: p.live.change_1y, expected_volatility: p.live.volatility_1y, sharpe_ratio: p.live.sharpe_1y, at_build: { annual_return: p.annual_return, expected_volatility: p.expected_volatility, sharpe_ratio: p.sharpe_ratio } }
    : p;

function* handleFetch() {
  try {
    yield put(fetchStarted());
    // metrics=1: each portfolio's past-year return / volatility / Sharpe as of
    // today's data (the portfolio page's numbers), instead of the build-time ones.
    const { data } = yield call(apiClient.get, "/api/portfolios", { params: { metrics: 1 } });
    yield put(fetchSucceeded(data.portfolios.map(withLive)));
  } catch (err) {
    yield put(fetchFailed(err.message));
  }
}

function* handleCreate(action) {
  try {
    const { data } = yield call(apiClient.post, "/api/portfolios", action.payload);
    yield put(createSucceeded(data));
    toast.success("Portfolio saved");
  } catch (err) {
    yield put(createFailed(err.response?.data?.error || err.message));
  }
}

function* handleDelete(action) {
  try {
    yield call(apiClient.delete, `/api/portfolios/${action.payload}`);
    yield put(deleteSucceeded(action.payload));
  } catch (err) {
    // ignore
  }
}

function* handleUpdate(action) {
  try {
    const { id, ...changes } = action.payload;
    const { data } = yield call(apiClient.put, `/api/portfolios/${id}`, changes);
    yield put(updateSucceeded(data));
    toast.success("Portfolio saved");
  } catch (err) {
    yield put(updateFailed(err.response?.data?.error || err.message));
  }
}

export default function* portfoliosSaga() {
  yield takeLatest(fetchRequested.type, handleFetch);
  yield takeLatest(createRequested.type, handleCreate);
  yield takeLatest(deleteRequested.type, handleDelete);
  yield takeLatest(updateRequested.type, handleUpdate);
}
