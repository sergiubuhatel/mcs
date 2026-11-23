import { createSlice } from "@reduxjs/toolkit";

function loadInitialDarkMode() {
  try {
    const stored = localStorage.getItem("darkMode");
    return stored === "true"; // light mode by default
  } catch {
    return false;
  }
}

const themeSlice = createSlice({
  name: "theme",
  initialState: { darkMode: loadInitialDarkMode() },
  reducers: {
    toggleDarkMode(state) {
      state.darkMode = !state.darkMode;
      try {
        localStorage.setItem("darkMode", String(state.darkMode));
      } catch {
        // ignore (private browsing, etc.)
      }
    },
  },
});

export const { toggleDarkMode } = themeSlice.actions;
export default themeSlice.reducer;
