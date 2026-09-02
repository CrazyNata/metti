(() => {
  const splash = document.querySelector('#loading-splash');
  if (!splash) return;
  const setNativeSystemBars = (loading) => {
    try { window.MettiAndroid?.setLoadingSystemBars(loading); } catch (_) {}
  };
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
      setNativeSystemBars(false);
    }, 300);
  };
  window.addEventListener('load', () => window.setTimeout(finish, 1150), { once: true });
  window.setTimeout(finish, 2600);
})();
