import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  taskId: null,
  status: "idle", // idle | starting | training | done | error
  progress: null, // { completed, total }
  result: null, // { holdings, metrics, portfolio_id, run_id }
  error: null,
};

const rlSlice = createSlice({
  name: "rl",
  initialState,
  reducers: {
    trainRequested() {},
    trainStarted(state) {
      state.status = "starting";
      state.error = null;
      state.result = null;
      state.progress = null;
    },
    trainTaskCreated(state, action) {
      state.taskId = action.payload;
      state.status = "training";
    },
    progressUpdated(state, action) {
      state.progress = action.payload;
    },
    trainSucceeded(state, action) {
      state.status = "done";
      state.result = action.payload;
    },
    trainFailed(state, action) {
      state.status = "error";
      state.error = action.payload;
    },
    reset(state) {
      state.taskId = null;
      state.status = "idle";
      state.progress = null;
      state.result = null;
      state.error = null;
    },
  },
});

export const { trainRequested, trainStarted, trainTaskCreated, progressUpdated, trainSucceeded, trainFailed, reset } =
  rlSlice.actions;

export default rlSlice.reducer;
