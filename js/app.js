function setScreenLayout(isHome) {
  const toolbar = document.querySelector('.home-toolbar');
  const appContainer = document.querySelector('.app-container');
  const bottomTaskbar = document.querySelector('.bottom-taskbar');

  if (toolbar) toolbar.style.display = isHome ? 'block' : 'none';
  if (bottomTaskbar) bottomTaskbar.style.display = 'flex';
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
  const mapScreen = document.getElementById('map-screen');
  currentTab = tabName;
  loadStoredFiltersForTab(tabName);

  updateFilterSectionVisibility();

  if (homeScreen) homeScreen.style.display = tabName === 'specials' ? 'flex' : 'none';
  if (barsScreen) barsScreen.style.display = tabName === 'bars' ? 'flex' : 'none';
  if (favoritesScreen) favoritesScreen.style.display = tabName === 'favorites' ? 'flex' : 'none';
  if (mapScreen) mapScreen.style.display = tabName === 'map' ? 'flex' : 'none';

  if (tabName !== 'map' && typeof dismissMapSelectedBarSheet === 'function') {
    dismissMapSelectedBarSheet();
  }

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
  const neighborhoodSelect = document.getElementById('neighborhoodFilterSelect');
  if (!neighborhoodSelect) return [];
  const selectedNeighborhood = neighborhoodSelect.value;
  return selectedNeighborhood ? [selectedNeighborhood] : [];
}

function resetFilterInputs() {
  document.querySelectorAll('#side-menu .filter-row').forEach((row) => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox) return;
    checkbox.checked = false;
    row.classList.remove('selected');
  });

  const neighborhoodSelect = document.getElementById('neighborhoodFilterSelect');
  if (neighborhoodSelect) {
    neighborhoodSelect.value = '';
  }
}

function getFiltersStorageKey() {
  const normalizedDeviceId = String(deviceId || '').trim();
  if (!normalizedDeviceId) return null;
  return `filters:${normalizedDeviceId}`;
}

function readStoredFiltersByTab() {
  const storageKey = getFiltersStorageKey();
  if (!storageKey) return {};

  try {
    const raw = localStorage.getItem(storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed;
  } catch (err) {
    console.error('Failed to parse stored filters:', err);
    return {};
  }
}

function sanitizeFiltersForTab(filters, tabName) {
  const rawTypes = Array.isArray(filters?.types) ? filters.types : [];
  const rawNeighborhoods = Array.isArray(filters?.neighborhoods) ? filters.neighborhoods : [];
  const isBarsTab = tabName === 'bars';

  return {
    types: isBarsTab ? [] : rawTypes.map((type) => String(type)).filter(Boolean),
    neighborhoods: rawNeighborhoods.map((name) => String(name)).filter(Boolean),
    favoritesOnly: Boolean(filters?.favoritesOnly) && isBarsTab
  };
}

function syncFilterInputsFromActiveFilters() {
  const typeRows = document.querySelectorAll('#special-type-filters .filter-row');
  typeRows.forEach((row) => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox) return;
    const typeName = checkbox.id.replace('Filter', '').toLowerCase();
    checkbox.checked = activeFilters.types.includes(typeName);
    row.classList.toggle('selected', checkbox.checked);
  });

  const favoritesCheckbox = document.getElementById('favoritesFilter');
  if (favoritesCheckbox) {
    favoritesCheckbox.checked = Boolean(activeFilters.favoritesOnly);
    const favoritesRow = favoritesCheckbox.closest('.filter-row');
    if (favoritesRow) {
      favoritesRow.classList.toggle('selected', favoritesCheckbox.checked);
    }
  }

  const neighborhoodSelect = document.getElementById('neighborhoodFilterSelect');
  if (neighborhoodSelect) {
    const [selectedNeighborhood] = activeFilters.neighborhoods;
    neighborhoodSelect.value = selectedNeighborhood || '';
  }
}

function loadStoredFiltersForTab(tabName = currentTab) {
  const storedByTab = readStoredFiltersByTab();
  const fallbackFilters = { types: [], neighborhoods: [], favoritesOnly: false };
  const nextFilters = sanitizeFiltersForTab(storedByTab[tabName] || fallbackFilters, tabName);

  activeFilters.types = nextFilters.types;
  activeFilters.neighborhoods = nextFilters.neighborhoods;
  activeFilters.favoritesOnly = nextFilters.favoritesOnly;
  syncFilterInputsFromActiveFilters();
}

function persistFiltersForCurrentTab() {
  const storageKey = getFiltersStorageKey();
  if (!storageKey) return;

  const storedByTab = readStoredFiltersByTab();
  storedByTab[currentTab] = sanitizeFiltersForTab(activeFilters, currentTab);
  localStorage.setItem(storageKey, JSON.stringify(storedByTab));
}

function updateFilterSectionVisibility() {
  const typeSection = document.getElementById('special-type-filters');
  const favoritesSection = document.getElementById('favorites-filters');
  if (!typeSection || !favoritesSection) return;

  const showTypeFilters = currentTab !== 'bars';
  const showFavoritesFilter = currentTab === 'bars';
  typeSection.style.display = showTypeFilters ? '' : 'none';
  favoritesSection.style.display = showFavoritesFilter ? '' : 'none';
}

function getFilteredFavorites() {
  return getFavoriteSpecialEntries().filter((item) => {
    const specialType = item.special.special_type || item.special.type;
    const typePass = specialMatchesTypeFilters(specialType, activeFilters.types);
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
    return;
  }

  if (currentTab === 'map') {
    if (typeof renderMapTab === 'function') {
      renderMapTab();
    }
  }
}

function initTaskbar() {
  const tabs = document.querySelectorAll('.taskbar-tab');
  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      const isRepeatSpecialsTap = tabName === 'specials' && currentTab === 'specials';
      document.getElementById('detail-screen').style.display = 'none';
      document.getElementById('special-screen').style.display = 'none';
      showTab(tabName);
      setScreenLayout(true);
      if (isRepeatSpecialsTap) {
        smoothScrollHomeToTop();
      }
    });
  });
}

function smoothScrollHomeToTop() {
  const homeScreen = document.getElementById('home-screen');
  if (!homeScreen) return;
  if (currentTab !== 'specials') return;
  homeScreen.scrollTo({
    top: 0,
    behavior: 'smooth'
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

function initAdminTitleTapEntry() {
  const appTitle = document.querySelector('.app-title');
  const tapThreshold = 5;
  const tapResetMs = 1200;
  let tapCount = 0;
  let tapTimer = null;

  if (!appTitle) return;

  const handleTitleTap = () => {
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
  };

  appTitle.addEventListener('pointerup', handleTitleTap);
}

function initToolbarSingleTapScroll() {
  const toolbar = document.querySelector('.home-toolbar');
  if (!toolbar) return;

  toolbar.addEventListener('click', (event) => {
    const clickTarget = event.target;
    if (!(clickTarget instanceof Element)) return;
    if (clickTarget.closest('button, a, input, select, textarea, label')) return;
    smoothScrollHomeToTop();
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


function initZoomLock() {
  let lastTouchEnd = 0;

  document.addEventListener('gesturestart', (event) => {
    event.preventDefault();
  }, { passive: false });

  document.addEventListener('touchmove', (event) => {
    if (event.touches.length > 1) {
      event.preventDefault();
    }
  }, { passive: false });

  document.addEventListener('touchend', (event) => {
    const now = Date.now();
    if (now - lastTouchEnd <= 300) {
      event.preventDefault();
    }
    lastTouchEnd = now;
  }, { passive: false });
}

function initSidebarFilters() {
  const hamburgerButton = document.querySelector('.hamburger-button');
  const sideMenu = document.getElementById('side-menu');
  const menuOverlay = document.getElementById('side-menu-overlay');
  const applyButton = document.getElementById('applyFiltersBtn');

  const bindFilterRowToggle = (row) => {
    if (!row || row.dataset.bound === 'true') return;
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox) return;
    row.classList.toggle('selected', checkbox.checked);
    row.addEventListener('click', () => {
      checkbox.checked = !checkbox.checked;
      row.classList.toggle('selected', checkbox.checked);
    });
    row.dataset.bound = 'true';
  };

  const typeRows = document.querySelectorAll('#special-type-filters .filter-row');
  typeRows.forEach(bindFilterRowToggle);
  bindFilterRowToggle(document.querySelector('#favorites-filters .filter-row'));

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
    activeFilters.favoritesOnly = currentTab === 'bars' && Boolean(favoritesCheckbox?.checked);
    persistFiltersForCurrentTab();
    renderCurrentTabData();
    sideMenu.classList.remove('open');
    menuOverlay.classList.remove('active');
  });
}

function generateNeighborhoodFilters() {
  const neighborhoodSelect = document.getElementById('neighborhoodFilterSelect');
  if (!neighborhoodSelect) return;
  neighborhoodSelect.innerHTML = '';

  const allNeighborhoodsOption = document.createElement('option');
  allNeighborhoodsOption.value = '';
  allNeighborhoodsOption.textContent = 'All neighborhoods';
  neighborhoodSelect.appendChild(allNeighborhoodsOption);

  const neighborhoods = [...new Set(barsData.map((bar) => bar.neighborhood).filter(Boolean))].sort((a, b) =>
    a.toLowerCase().localeCompare(b.toLowerCase())
  );

  neighborhoods.forEach((name) => {
    const option = document.createElement('option');
    option.value = name;
    option.textContent = name;
    neighborhoodSelect.appendChild(option);
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
initAdminTitleTapEntry();
initToolbarSingleTapScroll();
initHomeScrollCapture();
initZoomLock();
if (typeof initMapDayController === 'function') {
  initMapDayController();
}
initSpecialReport();
initBarReport();
initSpecialFavoriteButton();

showTab(currentTab);
setScreenLayout(true);
loadBars();
