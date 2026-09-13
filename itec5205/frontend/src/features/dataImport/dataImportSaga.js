import { eventChannel } from "redux-saga";
import { call, delay, put, race, take, takeLatest } from "redux-saga/effects";
import { apiClient } from "../../api/client";
import { getSocket, joinRoom, leaveRoom } from "../../api/socket";
import {
  importFailed,
  importRequested,
  importStarted,
  importSucceeded,
  importTaskCreated,
  progressUpdated,
} from "./dataImportSlice";

function createProgressChannel(eventName, room) {
  const socket = getSocket();
  joinRoom(room);
  return eventChannel((emit) => {
    const handler = (data) => emit(data);
    socket.on(eventName, handler);
    return () => {
      socket.off(eventName, handler);
      leaveRoom(room);
    };
  });
}

function* consumeChannelUntilDone(channel) {
  while (true) {
    const event = yield take(channel);
    yield put(progressUpdated(event));
    if (event.stage === "done") return event;
  }
}

function* pollStatusUntilDone(taskId) {
  while (true) {
    yield delay(5000);
    const { data } = yield call(apiClient.get, `/api/data/import/status/${taskId}`);
    if (data.state === "SUCCESS") return { stage: "done", ...data.result };
    if (data.state === "FAILURE") throw new Error(data.error || "Import failed");
  }
}

function* handleImport(action) {
  let channel;
  try {
    yield put(importStarted());
    const { data } = yield call(apiClient.post, "/api/data/import", action.payload || {});
    const taskId = data.task_id;
    yield put(importTaskCreated(taskId));

    channel = createProgressChannel("import_progress", taskId);
    const { viaSocket, viaPoll } = yield race({
      viaSocket: call(consumeChannelUntilDone, channel),
      viaPoll: call(pollStatusUntilDone, taskId),
    });
    yield put(importSucceeded(viaSocket || viaPoll));
  } catch (err) {
    yield put(importFailed(err.response?.data?.error || err.message || String(err)));
  } finally {
    if (channel) channel.close();
  }
}

export default function* dataImportSaga() {
  yield takeLatest(importRequested.type, handleImport);
}
