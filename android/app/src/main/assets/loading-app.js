(() => {
  const splash = document.querySelector('#loading-splash');
  if (!splash) return;
  const nativeApp = Boolean(window.MettiAndroid);
  if (nativeApp) splash.classList.add('native-loading');
  const themeColor = document.querySelector('meta[name="theme-color"]');
  const setLoadingTheme = (loading) => {
    themeColor?.setAttribute('content', loading ? '#17150f' : '#f7e9e8');
  };
  const setNativeSystemBars = (loading) => {
    try { window.MettiAndroid?.setLoadingSystemBars(loading); } catch (_) {}
  };
  setLoadingTheme(true);
  setNativeSystemBars(true);
  const preview = new URLSearchParams(window.location.search).get('loading-preview') === '1';
  if (preview) return;
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    splash.classList.add('is-hiding');
    window.setTimeout(() => {
      splash.hidden = true;
      setLoadingTheme(false);
      setNativeSystemBars(false);
    }, 300);
  };
  window.addEventListener('load', () => window.setTimeout(finish, 1150), { once: true });
  window.setTimeout(finish, 2600);
})();
