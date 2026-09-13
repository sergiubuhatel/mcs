import { eventChannel } from "redux-saga";
import { call, delay, put, race, take, takeLatest } from "redux-saga/effects";
import { apiClient } from "../../api/client";
import { getSocket, joinRoom, leaveRoom } from "../../api/socket";
import { progressUpdated, trainFailed, trainRequested, trainStarted, trainSucceeded, trainTaskCreated } from "./rlSlice";

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
    yield delay(2000);
    const { data } = yield call(apiClient.get, `/api/rl/status/${taskId}`);
    if (data.state === "PROGRESS" && data.progress) yield put(progressUpdated(data.progress));
    if (data.state === "SUCCESS") return { stage: "done", ...data.result };
    if (data.state === "FAILURE") throw new Error(data.error || "RL training failed");
  }
}

function* handleTrain(action) {
  let channel;
  try {
    yield put(trainStarted());
    const { data } = yield call(apiClient.post, "/api/rl/train", action.payload);
    const taskId = data.task_id;
    yield put(trainTaskCreated(taskId));

    channel = createProgressChannel("rl_progress", taskId);
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

export default function* rlSaga() {
  yield takeLatest(trainRequested.type, handleTrain);
}
