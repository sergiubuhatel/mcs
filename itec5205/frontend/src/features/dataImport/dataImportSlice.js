import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  taskId: null,
  status: "idle", // idle | starting | running | stopping | done | stopped | error
  progress: null, // { ticker, completed, total, succeeded, failed }
  result: null, // { stopped, remaining_tickers, years, interval, succeeded_count, failed_count, total, ... }
  error: null,
  startedAt: null, // ms epoch, set once a task id exists -- drives the elapsed/ETA display
};

const dataImportSlice = createSlice({
  name: "dataImport",
  initialState,
  reducers: {
    importRequested() {},
    importStarted(state) {
      state.status = "starting";
      state.error = null;
      state.result = null;
      state.progress = null;
    },
    importTaskCreated(state, action) {
      state.taskId = action.payload;
      state.status = "running";
      state.startedAt = Date.now();
    },
    progressUpdated(state, action) {
      state.progress = action.payload;
    },
    importSucceeded(state, action) {
      state.status = "done";
      state.result = action.payload;
    },
    importStopped(state, action) {
      state.status = "stopped";
      state.result = action.payload;
    },
    importFailed(state, action) {
      state.status = "error";
      state.error = action.payload;
    },
    stopRequested(state) {
      state.status = "stopping";
    },
    resumeRequested() {},
    reset(state) {
      state.taskId = null;
      state.status = "idle";
      state.progress = null;
      state.result = null;
      state.error = null;
      state.startedAt = null;
    },
  },
});

export const {
  importRequested,
  importStarted,
  importTaskCreated,
  progressUpdated,
  importSucceeded,
  importStopped,
  importFailed,
  stopRequested,
  resumeRequested,
  reset,
} = dataImportSlice.actions;

export default dataImportSlice.reducer;
