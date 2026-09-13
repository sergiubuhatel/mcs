import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  taskId: null,
  status: "idle", // idle | starting | running | done | error
  progress: null, // { ticker, completed, total, succeeded, failed }
  result: null,
  error: null,
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
    },
    progressUpdated(state, action) {
      state.progress = action.payload;
    },
    importSucceeded(state, action) {
      state.status = "done";
      state.result = action.payload;
    },
    importFailed(state, action) {
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

export const {
  importRequested,
  importStarted,
  importTaskCreated,
  progressUpdated,
  importSucceeded,
  importFailed,
  reset,
} = dataImportSlice.actions;

export default dataImportSlice.reducer;
