import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  taskId: null,
  status: "idle", // idle | starting | training | done | error
  progress: null,
  result: null, // { forecast, test_rmse, test_mae, ... }
  error: null,
};

const predictionsSlice = createSlice({
  name: "predictions",
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
    fetchExistingRequested() {},
    fetchExistingSucceeded(state, action) {
      state.result = action.payload;
      state.status = "done";
    },
    fetchExistingFailed(state) {
      // no stored prediction yet; leave state idle
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

export const {
  trainRequested,
  trainStarted,
  trainTaskCreated,
  progressUpdated,
  trainSucceeded,
  trainFailed,
  fetchExistingRequested,
  fetchExistingSucceeded,
  fetchExistingFailed,
  reset,
} = predictionsSlice.actions;

export default predictionsSlice.reducer;
