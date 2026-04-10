(function initAdminEntry() {
  const appTitle = document.querySelector('.app-title');
  const tapThreshold = 5;
  const tapResetMs = 1200;
  let tapCount = 0;
  let tapTimer = null;

  if (!appTitle) return;

  appTitle.addEventListener('click', () => {
    tapCount += 1;
    if (tapTimer) clearTimeout(tapTimer);
    tapTimer = setTimeout(() => {
      tapCount = 0;
    }, tapResetMs);

    if (tapCount >= tapThreshold) {
      tapCount = 0;
      if (tapTimer) clearTimeout(tapTimer);
      window.location.assign('/admin');
    }
  });
}());
