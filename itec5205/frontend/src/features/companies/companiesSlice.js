import { createSlice } from "@reduxjs/toolkit";

const initialState = {
  filters: {
    sector: "",
    industry: "",
    q: "",
    ranges: {}, // { roe: [min, max], trailing_pe: [min, max], ... }
    sortBy: "market_cap",
    sortDir: "desc",
    limit: 50,
    offset: 0,
  },
  results: [],
  total: 0,
  sectors: [],
  industries: [],
  selected: {}, // ticker -> true, for building a candidate pool
  loading: false,
  error: null,
};

const companiesSlice = createSlice({
  name: "companies",
  initialState,
  reducers: {
    setFilters(state, action) {
      state.filters = { ...state.filters, ...action.payload };
    },
    fetchRequested() {
      // handled by saga; reducer just needs to exist as an action creator
    },
    fetchStarted(state) {
      state.loading = true;
      state.error = null;
    },
    fetchSucceeded(state, action) {
      state.loading = false;
      state.results = action.payload.results;
      state.total = action.payload.total;
    },
    fetchFailed(state, action) {
      state.loading = false;
      state.error = action.payload;
    },
    fetchSectorsRequested() {},
    fetchSectorsSucceeded(state, action) {
      state.sectors = action.payload;
    },
    fetchIndustriesRequested() {},
    fetchIndustriesSucceeded(state, action) {
      state.industries = action.payload;
    },
    toggleSelected(state, action) {
      const ticker = action.payload;
      if (state.selected[ticker]) delete state.selected[ticker];
      else state.selected[ticker] = true;
    },
    clearSelected(state) {
      state.selected = {};
    },
  },
});

export const {
  setFilters,
  fetchRequested,
  fetchStarted,
  fetchSucceeded,
  fetchFailed,
  fetchSectorsRequested,
  fetchSectorsSucceeded,
  fetchIndustriesRequested,
  fetchIndustriesSucceeded,
  toggleSelected,
  clearSelected,
} = companiesSlice.actions;

export default companiesSlice.reducer;
