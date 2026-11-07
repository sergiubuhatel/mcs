/* ITEC 5205: follow the app's dark/light choice on the Keycloak pages.
   The app saves it in localStorage "darkMode" (frontend/src/features/theme/
   themeSlice.js); Keycloak is served from the same origin under /auth, so the
   value is readable here. Dark is the default, as in the app. */
(function () {
  try {
    if (localStorage.getItem("darkMode") === "false") document.documentElement.classList.add("cu-light");
  } catch (e) { /* storage blocked: stay dark */ }
})();

/* No browser suggestions (history dropdown, saved-login autofill) on the
   sign-in / register / reset fields. Chrome ignores autocomplete="off" on
   login fields, so the fields also start read-only (autofill skips them) and
   become editable on the first focus / touch. */
(function () {
  function quiet() {
    var fields = document.querySelectorAll(
      'input[type="text"], input[type="email"], input[type="password"], input:not([type])'
    );
    document.querySelectorAll("form").forEach(function (f) { f.setAttribute("autocomplete", "off"); });
    fields.forEach(function (el) {
      el.setAttribute("autocomplete", "off"); // "new-password" would offer a generated password
      el.setAttribute("autocorrect", "off");
      el.setAttribute("autocapitalize", "off");
      el.setAttribute("spellcheck", "false");
      if (el.hasAttribute("readonly")) return; // really read-only: leave it
      el.setAttribute("readonly", "");
      var unlock = function () { el.removeAttribute("readonly"); };
      el.addEventListener("focus", unlock, { once: true });
      el.addEventListener("pointerdown", unlock, { once: true });
      if (document.activeElement === el) unlock(); // autofocused username
    });
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", quiet);
  else quiet();
})();
