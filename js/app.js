function setScreenLayout(isHome) {
  const toolbar = document.querySelector('.home-toolbar');
  const appContainer = document.querySelector('.app-container');

  if (toolbar) toolbar.style.display = isHome ? 'block' : 'none';
  if (appContainer) appContainer.classList.toggle('detail-mode', !isHome);
}

function showHome() {
  document.getElementById('detail-screen').style.display = 'none';
  document.getElementById('special-screen').style.display = 'none';
  const fallbackTab = previousScreenState?.type && previousScreenState.type !== 'detail' ? previousScreenState.type : currentTab;
  showTab(fallbackTab);
  setScreenLayout(true);
}

function showTab(tabName) {
  const homeScreen = document.getElementById('home-screen');
  const barsScreen = document.getElementById('bars-screen');
  const favoritesScreen = document.getElementById('favorites-screen');
  const previousTab = currentTab;

  currentTab = tabName;

  if (previousTab !== tabName) {
    resetFilters();
  }

  updateFilterSectionVisibility();

  if (homeScreen) homeScreen.style.display = tabName === 'specials' ? 'flex' : 'none';
  if (barsScreen) barsScreen.style.display = tabName === 'bars' ? 'flex' : 'none';
  if (favoritesScreen) favoritesScreen.style.display = tabName === 'favorites' ? 'flex' : 'none';

  renderCurrentTabData();

  document.querySelectorAll('.taskbar-tab').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
}

function getSelectedTypesFromFilters() {
  const typeRows = Array.from(document.querySelectorAll('#special-type-filters .filter-row'));
  return typeRows
    .filter((row) => row.querySelector('input[type="checkbox"]').checked)
    .map((row) => row.querySelector('input[type="checkbox"]').id.replace('Filter', '').toLowerCase());
}

function getSelectedNeighborhoodsFromFilters() {
  const neighborhoodRows = Array.from(document.querySelectorAll('#neighborhood-filters .filter-row'));
  return neighborhoodRows
    .filter((row) => row.querySelector('input[type="checkbox"]').checked)
    .map((row) => row.querySelector('input[type="checkbox"]').dataset.name);
}

function resetFilterInputs() {
  document.querySelectorAll('#side-menu .filter-row').forEach((row) => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox) return;
    checkbox.checked = false;
    row.classList.remove('selected');
  });
}

function resetFilters() {
  activeFilters.types = [];
  activeFilters.neighborhoods = [];
  activeFilters.favoritesOnly = false;
  resetFilterInputs();
}

function updateFilterSectionVisibility() {
  const typeSection = document.getElementById('special-type-filters');
  if (!typeSection) return;

  const showTypeFilters = currentTab !== 'bars';
  typeSection.style.display = showTypeFilters ? '' : 'none';
}

function getFilteredFavorites() {
  return getFavoriteSpecialEntries().filter((item) => {
    const specialType = item.special.special_type || item.special.type;
    const typePass = activeFilters.types.length === 0 || activeFilters.types.includes(specialType);
    const neighborhoodPass = activeFilters.neighborhoods.length === 0 || activeFilters.neighborhoods.includes(item.bar.neighborhood);
    const favoritesPass = !activeFilters.favoritesOnly || item.special.favorite === true || item.bar.favorite === true;
    return typePass && neighborhoodPass && favoritesPass;
  });
}

function renderCurrentTabData() {
  if (isInitialDataLoading) return;

  if (currentTab === 'specials') {
    renderBarsWeek();
    return;
  }

  if (currentTab === 'bars') {
    renderBarsList(barsData);
    return;
  }

  if (currentTab === 'favorites') {
    renderFavorites(getFilteredFavorites());
  }
}

function initTaskbar() {
  const tabs = document.querySelectorAll('.taskbar-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      document.getElementById('detail-screen').style.display = 'none';
      document.getElementById('special-screen').style.display = 'none';
      showTab(tabName);
      setScreenLayout(true);
    });
  });
}

function initBarsSearch() {
  const searchInput = document.getElementById('bars-search-input');
  if (!searchInput) return;

  searchInput.addEventListener('input', () => {
    barsSearchQuery = searchInput.value || '';
    renderBarsList(barsData);
  });
}

function initHomeScrollCapture() {
  document.addEventListener('wheel', (event) => {
    const homeScreen = document.getElementById('home-screen');
    const favoritesScreen = document.getElementById('favorites-screen');
    const detailScreen = document.getElementById('detail-screen');
    const specialScreen = document.getElementById('special-screen');

    if (!homeScreen || !favoritesScreen || !detailScreen || !specialScreen) return;
    if (detailScreen.style.display !== 'none' || specialScreen.style.display !== 'none') return;

    const activeScrollable = homeScreen.style.display !== 'none'
      ? homeScreen
      : (favoritesScreen.style.display !== 'none' ? favoritesScreen : null);

    if (!activeScrollable) return;

    const maxScroll = activeScrollable.scrollHeight - activeScrollable.clientHeight;
    if (maxScroll <= 0) return;

    const nextScrollTop = Math.max(0, Math.min(maxScroll, activeScrollable.scrollTop + event.deltaY));
    if (nextScrollTop === activeScrollable.scrollTop) return;

    activeScrollable.scrollTop = nextScrollTop;
    event.preventDefault();
  }, { passive: false });
}

function initSidebarFilters() {
  const hamburgerButton = document.querySelector('.hamburger-button');
  const sideMenu = document.getElementById('side-menu');
  const menuOverlay = document.getElementById('side-menu-overlay');
  const applyButton = document.getElementById('applyFiltersBtn');

  const typeRows = document.querySelectorAll('#special-type-filters .filter-row');
  typeRows.forEach((row) => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    checkbox.checked = false;
    row.classList.toggle('selected', checkbox.checked);
    row.addEventListener('click', () => {
      checkbox.checked = !checkbox.checked;
      row.classList.toggle('selected', checkbox.checked);
    });
  });

  hamburgerButton.addEventListener('click', () => {
    sideMenu.classList.add('open');
    menuOverlay.classList.add('active');
    lucide.createIcons();
  });
  menuOverlay.addEventListener('click', () => {
    sideMenu.classList.remove('open');
    menuOverlay.classList.remove('active');
  });

  applyButton.addEventListener('click', () => {
    activeFilters.types = currentTab === 'bars' ? [] : getSelectedTypesFromFilters();
    activeFilters.neighborhoods = getSelectedNeighborhoodsFromFilters();
    const favoritesCheckbox = document.getElementById('favoritesFilter');
    activeFilters.favoritesOnly = Boolean(favoritesCheckbox?.checked);
    renderCurrentTabData();
    sideMenu.classList.remove('open');
    menuOverlay.classList.remove('active');
  });
}

function generateNeighborhoodFilters() {
  const neighborhoodSection = document.getElementById('neighborhood-filters');
  const oldRows = neighborhoodSection.querySelectorAll('.filter-row');
  oldRows.forEach((row) => row.remove());

  const neighborhoods = [...new Set(barsData.map((bar) => bar.neighborhood).filter(Boolean))].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  neighborhoods.forEach((name) => {
    const row = document.createElement('div');
    row.className = 'filter-row';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.name = name;
    checkbox.id = `neigh-${name.replace(/\s+/g, '')}`;
    checkbox.checked = false;
    const label = document.createElement('label');
    label.setAttribute('for', checkbox.id);
    label.textContent = name;
    row.appendChild(checkbox);
    row.appendChild(label);
    row.addEventListener('click', () => {
      checkbox.checked = !checkbox.checked;
      row.classList.toggle('selected', checkbox.checked);
    });
    neighborhoodSection.appendChild(row);
  });
}

function hideInitialLoadingOverlay() {
  const loadingOverlay = document.getElementById('initial-loading-overlay');
  if (!loadingOverlay) return;

  requestAnimationFrame(() => {
    loadingOverlay.classList.add('hidden');
    setTimeout(() => {
      loadingOverlay.remove();
    }, 320);
  });
}

// ===== Initialize =====
initSidebarFilters();
initTaskbar();
initBarsSearch();
initHomeScrollCapture();
initSpecialReport();
initBarReport();
initSpecialFavoriteButton();
showTab(currentTab);
setScreenLayout(true);
loadBars();
