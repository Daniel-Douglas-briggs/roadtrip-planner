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

  document.addEventListener('DOMContentLoaded', function () {
    document.querySelectorAll('.theme-toggle-btn').forEach(function (btn) {
      btn.addEventListener('click', function () {
        setTheme(!isDark());
      });
    });
    syncButtons();
  });
})();
