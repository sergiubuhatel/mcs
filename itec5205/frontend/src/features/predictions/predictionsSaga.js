import { eventChannel } from "redux-saga";
import { call, delay, put, race, take, takeLatest } from "redux-saga/effects";
import { apiClient } from "../../api/client";
import { getSocket, joinRoom, leaveRoom } from "../../api/socket";
import {
  fetchExistingFailed,
  fetchExistingRequested,
  fetchExistingSucceeded,
  progressUpdated,
  trainFailed,
  trainRequested,
  trainStarted,
  trainSucceeded,
  trainTaskCreated,
} from "./predictionsSlice";

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
    yield delay(3000);
    const { data } = yield call(apiClient.get, `/api/predictions/status/${taskId}`);
    if (data.state === "SUCCESS") return { stage: "done", ...data.result };
    if (data.state === "FAILURE") throw new Error(data.error || "LSTM training failed");
  }
}

function* handleTrain(action) {
  let channel;
  try {
    yield put(trainStarted());
    const { data } = yield call(apiClient.post, "/api/predictions/train", action.payload);
    const taskId = data.task_id;
    yield put(trainTaskCreated(taskId));

    channel = createProgressChannel("prediction_progress", taskId);
    const { viaSocket, viaPoll } = yield race({
      viaSocket: call(consumeChannelUntilDone, channel),
      viaPoll: call(pollStatusUntilDone, taskId),
    });
    yield put(trainSucceeded(viaSocket || viaPoll));
  } catch (err) {
    yield put(trainFailed(err.response?.data?.error || err.message || String(err)));
  } finally {
    if (channel) channel.close();
  }
}

function* handleFetchExisting(action) {
  try {
    const { data } = yield call(apiClient.get, `/api/predictions/${action.payload}`);
    yield put(fetchExistingSucceeded(data));
  } catch (err) {
    yield put(fetchExistingFailed());
  }
}

export default function* predictionsSaga() {
  yield takeLatest(trainRequested.type, handleTrain);
  yield takeLatest(fetchExistingRequested.type, handleFetchExisting);
}
