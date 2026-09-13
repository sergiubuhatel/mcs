import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  items: [],
  loading: false,
  error: null,
  creating: false,
};

const poolsSlice = createSlice({
  name: "pools",
  initialState,
  reducers: {
    fetchRequested() {},
    fetchStarted(state) {
      state.loading = true;
    },
    fetchSucceeded(state, action) {
      state.loading = false;
      state.items = action.payload;
    },
    fetchFailed(state, action) {
      state.loading = false;
      state.error = action.payload;
    },
    createRequested(state) {
      state.creating = true;
      state.error = null;
    },
    createSucceeded(state, action) {
      state.creating = false;
      state.items.unshift(action.payload);
    },
    createFailed(state, action) {
      state.creating = false;
      state.error = action.payload;
    },
    deleteRequested() {},
    deleteSucceeded(state, action) {
      state.items = state.items.filter((p) => p._key !== action.payload);
    },
  },
});

export const {
  fetchRequested,
  fetchStarted,
  fetchSucceeded,
  fetchFailed,
  createRequested,
  createSucceeded,
  createFailed,
  deleteRequested,
  deleteSucceeded,
} = poolsSlice.actions;

export default poolsSlice.reducer;
