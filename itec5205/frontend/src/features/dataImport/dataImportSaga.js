import { eventChannel } from "redux-saga";
import { call, delay, put, race, take, takeLatest } from "redux-saga/effects";
import { apiClient } from "../../api/client";
import { getSocket, joinRoom, leaveRoom } from "../../api/socket";
import {
  importFailed,
  importRequested,
  importStarted,
  importStopped,
  importSucceeded,
  importTaskCreated,
  progressUpdated,
  resumeRequested,
  stopRequested,
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
    if (event.stage === "done" || event.stage === "stopped") return event;
    yield put(progressUpdated(event));
  }
}

function* pollStatusUntilDone(taskId) {
  while (true) {
    yield delay(2000);
    const { data } = yield call(apiClient.get, `/api/data/import/status/${taskId}`);
    if (data.state === "PROGRESS" && data.progress) yield put(progressUpdated(data.progress));
    if (data.state === "SUCCESS") return { stage: data.result?.stopped ? "stopped" : "done", ...data.result };
    if (data.state === "FAILURE") throw new Error(data.error || "Import failed");
  }
}

// Shared by a fresh import and a resumed one: waits for the task to finish
// (or be cooperatively stopped) and dispatches the matching terminal action.
function* trackTask(taskId) {
  let channel;
  try {
    channel = createProgressChannel("import_progress", taskId);
    const { viaSocket, viaPoll } = yield race({
      viaSocket: call(consumeChannelUntilDone, channel),
      viaPoll: call(pollStatusUntilDone, taskId),
    });
    const final = viaSocket || viaPoll;
    if (final.stage === "stopped") yield put(importStopped(final));
    else yield put(importSucceeded(final));
  } catch (err) {
    yield put(importFailed(err.response?.data?.error || err.message || String(err)));
  } finally {
    if (channel) channel.close();
  }
}

function* handleImport(action) {
  try {
    yield put(importStarted());
    const { data } = yield call(apiClient.post, "/api/data/import", action.payload || {});
    const taskId = data.task_id;

    if (!taskId) {
      // Nothing to do (e.g. "only missing" found everything already imported).
      yield put(importSucceeded({ stage: "done", total: 0, succeeded_count: 0, failed_count: 0, message: data.message }));
      return;
    }

    yield put(importTaskCreated(taskId));
    yield call(trackTask, taskId);
  } catch (err) {
    yield put(importFailed(err.response?.data?.error || err.message || String(err)));
  }
}

function* handleStop(action) {
  const taskId = action.payload;
  if (!taskId) return;
  try {
    yield call(apiClient.post, `/api/data/import/stop/${taskId}`);
  } catch (err) {
    // The next progress/poll tick will surface the real state either way.
  }
}

function* handleResume(action) {
  const taskId = action.payload;
  try {
    yield put(importStarted());
    const { data } = yield call(apiClient.post, `/api/data/import/resume/${taskId}`);
    yield put(importTaskCreated(data.task_id));
    yield call(trackTask, data.task_id);
  } catch (err) {
    yield put(importFailed(err.response?.data?.error || err.message || String(err)));
  }
}

export default function* dataImportSaga() {
  yield takeLatest(importRequested.type, handleImport);
  yield takeLatest(stopRequested.type, handleStop);
  yield takeLatest(resumeRequested.type, handleResume);
}
