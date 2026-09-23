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
} from "./poolsSlice";

function* handleFetch() {
  try {
    yield put(fetchStarted());
    const { data } = yield call(apiClient.get, "/api/pools");
    yield put(fetchSucceeded(data.pools));
  } catch (err) {
    yield put(fetchFailed(err.message));
  }
}

function* handleCreate(action) {
  try {
    const { data } = yield call(apiClient.post, "/api/pools", action.payload);
    yield put(createSucceeded(data));
    toast.success("Pool saved");
  } catch (err) {
    yield put(createFailed(err.response?.data?.error || err.message));
  }
}

function* handleDelete(action) {
  try {
    yield call(apiClient.delete, `/api/pools/${action.payload}`);
    yield put(deleteSucceeded(action.payload));
  } catch (err) {
    // ignore; list stays as-is
  }
}

function* handleUpdate(action) {
  try {
    const { id, ...changes } = action.payload;
    const { data } = yield call(apiClient.put, `/api/pools/${id}`, changes);
    yield put(updateSucceeded(data));
    toast.success("Pool saved");
  } catch (err) {
    yield put(updateFailed(err.response?.data?.error || err.message));
  }
}

export default function* poolsSaga() {
  yield takeLatest(fetchRequested.type, handleFetch);
  yield takeLatest(createRequested.type, handleCreate);
  yield takeLatest(deleteRequested.type, handleDelete);
  yield takeLatest(updateRequested.type, handleUpdate);
}
