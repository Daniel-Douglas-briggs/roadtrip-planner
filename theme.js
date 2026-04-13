// ── Theme toggle (light / dark mode) ─────────────────────────────────────────
// Applied immediately (before DOMContentLoaded) so the page never flashes
// the wrong theme on load.

(function () {
  var saved = localStorage.getItem('noorish-theme');
  if (saved === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }

  function isDark() {
    return document.documentElement.getAttribute('data-theme') === 'dark';
  }

  function setTheme(dark) {
    if (dark) {
      document.documentElement.setAttribute('data-theme', 'dark');
      localStorage.setItem('noorish-theme', 'dark');
    } else {
      document.documentElement.removeAttribute('data-theme');
      localStorage.setItem('noorish-theme', 'light');
    }
    syncButtons();
  }

  function syncButtons() {
    var dark = isDark();
    document.querySelectorAll('.theme-toggle-btn').forEach(function (btn) {
      btn.classList.toggle('theme-toggle-btn--on', dark);
      btn.setAttribute('aria-pressed', String(dark));
    });
  }

  // ── Nav tab position tracking ──────────────────────────────────────────────
  // The nav floats transparently over the page. In dark mode, tabs that sit
  // over the dark sidebar need to switch to parchment so they're readable.
  // We measure each tab's position and add .is-over-sidebar when it overlaps.

  var SIDEBAR_WIDTH = 360; // must match .sidebar { width } in style.css

  function updateNavOverlap() {
    document.querySelectorAll('.nav-tab').forEach(function (tab) {
      var rect = tab.getBoundingClientRect();
      var tabMidpoint = rect.left + rect.width / 2;
      tab.classList.toggle('is-over-sidebar', tabMidpoint < SIDEBAR_WIDTH);
    });
  }

  window.addEventListener('resize', updateNavOverlap);

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.theme-toggle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setTheme(!isDark());
      });
    });
    syncButtons();
    updateNavOverlap();
  });
})();
