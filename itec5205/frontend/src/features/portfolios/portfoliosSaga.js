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
