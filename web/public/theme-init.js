// Runs before the page paints so the chosen theme never flashes. External file: the server's CSP does not allow inline scripts.
(function () {
  try {
    var pref = (JSON.parse(localStorage.getItem('spendx.settings.v1') || '{}') || {}).theme;
    var dark = pref === 'auto' ? !window.matchMedia || window.matchMedia('(prefers-color-scheme: dark)').matches : pref !== 'light';
    document.documentElement.dataset.theme = dark ? 'dark' : 'light';
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
  } catch (e) { document.documentElement.dataset.theme = 'dark'; }
})();
