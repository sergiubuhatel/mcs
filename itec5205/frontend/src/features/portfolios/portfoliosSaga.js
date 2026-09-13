import { call, put, takeLatest } from "redux-saga/effects";
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
} from "./portfoliosSlice";

function* handleFetch() {
  try {
    yield put(fetchStarted());
    const { data } = yield call(apiClient.get, "/api/portfolios");
    yield put(fetchSucceeded(data.portfolios));
  } catch (err) {
    yield put(fetchFailed(err.message));
  }
}

function* handleCreate(action) {
  try {
    const { data } = yield call(apiClient.post, "/api/portfolios", action.payload);
    yield put(createSucceeded(data));
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

export default function* portfoliosSaga() {
  yield takeLatest(fetchRequested.type, handleFetch);
  yield takeLatest(createRequested.type, handleCreate);
  yield takeLatest(deleteRequested.type, handleDelete);
}
