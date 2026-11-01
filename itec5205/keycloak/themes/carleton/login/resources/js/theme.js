/* ITEC 5205: follow the app's dark/light choice on the Keycloak pages.
   The app saves it in localStorage "darkMode" (frontend/src/features/theme/
   themeSlice.js); Keycloak is served from the same origin under /auth, so the
   value is readable here. Dark is the default, as in the app. */
(function () {
  try {
    if (localStorage.getItem("darkMode") === "false") document.documentElement.classList.add("cu-light");
  } catch (e) { /* storage blocked: stay dark */ }
})();
