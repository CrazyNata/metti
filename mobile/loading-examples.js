(() => {
  document.querySelectorAll('.progress-track').forEach((track) => {
    track.setAttribute('role', 'progressbar');
    track.setAttribute('aria-label', 'Загрузка образа');
    track.setAttribute('aria-valuemin', '0');
    track.setAttribute('aria-valuemax', '100');
    track.setAttribute('aria-valuenow', '68');
  });
})();
