(function attachAdminScreen(global) {
  const ADMIN_PATH = '/admin';
  const TAP_THRESHOLD = 5;
  const TAP_RESET_MS = 1200;

  function isAdminPath() {
    return window.location.pathname === ADMIN_PATH;
  }

  function hideConsumerScreens() {
    const consumerScreenIds = [
      'home-screen',
      'bars-screen',
      'favorites-screen',
      'map-screen',
      'detail-screen',
      'special-screen'
    ];

    consumerScreenIds.forEach((id) => {
      const screen = document.getElementById(id);
      if (screen) screen.style.display = 'none';
    });

    const sideMenu = document.getElementById('side-menu');
    const menuOverlay = document.getElementById('side-menu-overlay');
    if (sideMenu) sideMenu.classList.remove('open');
    if (menuOverlay) menuOverlay.classList.remove('active');
  }

  function showAdminChrome() {
    const adminToolbar = document.getElementById('admin-toolbar');
    const mainToolbar = document.querySelector('.home-toolbar');
    const bottomTaskbar = document.querySelector('.bottom-taskbar');
    const appContainer = document.querySelector('.app-container');

    if (adminToolbar) adminToolbar.style.display = 'block';
    if (mainToolbar) mainToolbar.style.display = 'none';
    if (bottomTaskbar) bottomTaskbar.style.display = 'none';
    if (appContainer) appContainer.classList.add('detail-mode');
  }

  function hideAdminChrome() {
    const adminToolbar = document.getElementById('admin-toolbar');
    if (adminToolbar) adminToolbar.style.display = 'none';
  }

  function renderAdminScreen() {
    const adminScreen = document.getElementById('admin-screen');
    hideConsumerScreens();
    if (adminScreen) adminScreen.style.display = 'flex';
    showAdminChrome();
  }

  function hideAdminScreen() {
    const adminScreen = document.getElementById('admin-screen');
    if (adminScreen) adminScreen.style.display = 'none';
    hideAdminChrome();
  }

  function showAdmin() {
    window.history.pushState({}, '', ADMIN_PATH);
    renderAdminScreen();
  }

  function showHomeFromAdmin() {
    hideAdminScreen();
    window.history.pushState({}, '', '/');
    showTab(currentTab || 'specials');
    setScreenLayout(true);
  }

  function syncChrome(isHome) {
    if (isAdminPath()) {
      showAdminChrome();
      return true;
    }

    hideAdminChrome();
    return false;
  }

  function init() {
    const appTitle = document.querySelector('.app-title');
    const adminHomeButton = document.getElementById('admin-home-button');
    let tapCount = 0;
    let tapTimer = null;

    if (appTitle) {
      appTitle.addEventListener('click', () => {
        tapCount += 1;
        if (tapTimer) clearTimeout(tapTimer);
        tapTimer = setTimeout(() => {
          tapCount = 0;
        }, TAP_RESET_MS);

        if (tapCount >= TAP_THRESHOLD) {
          tapCount = 0;
          if (tapTimer) clearTimeout(tapTimer);
          showAdmin();
        }
      });
    }

    if (adminHomeButton) {
      adminHomeButton.addEventListener('click', showHomeFromAdmin);
    }

    window.addEventListener('popstate', () => {
      if (isAdminPath()) {
        renderAdminScreen();
        return;
      }

      hideAdminScreen();
      showTab(currentTab || 'specials');
      setScreenLayout(true);
    });
  }

  global.AdminScreen = {
    init,
    isAdminPath,
    renderAdminScreen,
    hideAdminScreen,
    syncChrome
  };
}(window));
