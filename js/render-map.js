const MAP_DAY_KEYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

let barsMap = null;
let barsMapMarkers = [];
let googleMapsLoaderPromise = null;
let mapSelectedBarSheetState = {
  barId: null,
  pointerId: null,
  startY: 0,
  currentOffset: 0
};
let mapDismissListenersBound = false;
let mapSheetDismissTimer = null;
const MAP_MARKER_BLUE = '#007bff';

function createBlueMapPinElement() {
  const PinElement = google.maps.marker?.PinElement;
  if (!PinElement) return null;

  const pin = new PinElement({
    background: MAP_MARKER_BLUE,
    borderColor: MAP_MARKER_BLUE,
    glyphColor: '#ffffff'
  });

  return pin.element;
}

function bindAdvancedMarkerClick(marker, onClick) {
  if (!marker || typeof onClick !== 'function') return;

  if (typeof marker.addListener === 'function') {
    marker.addListener('click', onClick);
  }

  if (typeof marker.addEventListener === 'function') {
    marker.addEventListener('gmp-click', onClick);
  }
}

function getMapSelectedDayKey() {
  if (mapSelectedDayKey && MAP_DAY_KEYS.includes(mapSelectedDayKey)) {
    return mapSelectedDayKey;
  }
  return startupPayload?.general_data?.current_day || MAP_DAY_KEYS[new Date().getDay()];
}

function getMapDayLabel(dayKey) {
  const index = MAP_DAY_KEYS.indexOf(dayKey);
  const dayName = DAYS_FULL[index] || dayKey;
  if (dayKey === (startupPayload?.general_data?.current_day || '')) {
    return `${dayName} (Today)`;
  }
  return dayName;
}

function shiftMapDay(offset) {
  const current = getMapSelectedDayKey();
  const currentIndex = MAP_DAY_KEYS.indexOf(current);
  if (currentIndex < 0) return;
  const nextIndex = (currentIndex + offset + 7) % 7;
  mapSelectedDayKey = MAP_DAY_KEYS[nextIndex];
  renderMapTab();
}

function initMapDayController() {
  const prevButton = document.getElementById('map-day-prev');
  const nextButton = document.getElementById('map-day-next');
  if (!prevButton || !nextButton) return;

  prevButton.addEventListener('click', () => shiftMapDay(-1));
  nextButton.addEventListener('click', () => shiftMapDay(1));
}

function loadGoogleMapsApi() {
  if (window.google?.maps) {
    return Promise.resolve();
  }

  if (googleMapsLoaderPromise) {
    return googleMapsLoaderPromise;
  }

  const apiKey = startupPayload?.general_data?.google_api_key;
  if (!apiKey) {
    return Promise.reject(new Error('Google Maps API key is missing from startup payload.'));
  }

  googleMapsLoaderPromise = new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&libraries=marker`;
    script.async = true;
    script.defer = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load Google Maps JavaScript API.'));
    document.head.appendChild(script);
  });

  return googleMapsLoaderPromise;
}

function clearMapMarkers() {
  barsMapMarkers.forEach((marker) => {
    marker.map = null;
  });
  barsMapMarkers = [];
}

function dismissMapSelectedBarSheet() {
  const sheet = document.getElementById('map-selected-card-sheet');
  const content = document.getElementById('map-selected-card-content');
  if (!sheet || !content) return;
  sheet.style.display = 'none';
  sheet.style.transform = '';
  sheet.classList.remove('map-sheet-dragging');
  sheet.classList.remove('map-sheet-enter');
  sheet.classList.remove('map-sheet-dismissing');
  content.innerHTML = '';
  mapSelectedBarSheetState.barId = null;
  mapSelectedBarSheetState.pointerId = null;
  mapSelectedBarSheetState.startY = 0;
  mapSelectedBarSheetState.currentOffset = 0;
  if (mapSheetDismissTimer) {
    clearTimeout(mapSheetDismissTimer);
    mapSheetDismissTimer = null;
  }
}

function dismissMapSelectedBarSheetAnimated() {
  const sheet = document.getElementById('map-selected-card-sheet');
  if (!sheet || sheet.style.display === 'none' || !mapSelectedBarSheetState.barId) {
    dismissMapSelectedBarSheet();
    return;
  }

  sheet.classList.remove('map-sheet-enter');
  sheet.classList.add('map-sheet-dismissing');
  sheet.style.transform = 'translateY(calc(100% + 24px))';

  if (mapSheetDismissTimer) clearTimeout(mapSheetDismissTimer);
  mapSheetDismissTimer = setTimeout(() => {
    mapSheetDismissTimer = null;
    dismissMapSelectedBarSheet();
  }, 230);
}

function bindMapSheetDragToDismiss(sheet) {
  if (!sheet || sheet.dataset.bound === 'true') return;

  const pointerDown = (event) => {
    mapSelectedBarSheetState.pointerId = event.pointerId;
    mapSelectedBarSheetState.startY = event.clientY;
    mapSelectedBarSheetState.currentOffset = 0;
    sheet.classList.add('map-sheet-dragging');
    sheet.setPointerCapture(event.pointerId);
  };

  const pointerMove = (event) => {
    if (event.pointerId !== mapSelectedBarSheetState.pointerId) return;
    const deltaY = Math.max(0, event.clientY - mapSelectedBarSheetState.startY);
    mapSelectedBarSheetState.currentOffset = deltaY;
    sheet.style.transform = `translateY(${deltaY}px)`;
  };

  const pointerUp = (event) => {
    if (event.pointerId !== mapSelectedBarSheetState.pointerId) return;
    sheet.classList.remove('map-sheet-dragging');
    sheet.classList.remove('map-sheet-enter');
    const shouldDismiss = mapSelectedBarSheetState.currentOffset > 80;
    if (shouldDismiss) {
      dismissMapSelectedBarSheetAnimated();
    } else {
      sheet.style.transform = '';
    }
    mapSelectedBarSheetState.pointerId = null;
    mapSelectedBarSheetState.startY = 0;
    mapSelectedBarSheetState.currentOffset = 0;
  };

  sheet.addEventListener('pointerdown', pointerDown);
  sheet.addEventListener('pointermove', pointerMove);
  sheet.addEventListener('pointerup', pointerUp);
  sheet.addEventListener('pointercancel', pointerUp);
  sheet.dataset.bound = 'true';
}

function showMapSelectedBarSheet(bar, specialIds, dayKey, dayLabel) {
  const sheet = document.getElementById('map-selected-card-sheet');
  const content = document.getElementById('map-selected-card-content');
  if (!sheet || !content) return;

  content.innerHTML = '';
  const card = document.createElement('div');
  card.className = 'bar-card tap-pressable';
  card.onclick = () => animateTapAndNavigate(card, () => showDetail(bar, currentTab));

  if (bar.image_url && bar.image_url !== 'null') {
    const image = document.createElement('img');
    image.className = 'card-image';
    image.src = bar.image_url;
    image.alt = bar.name;
    card.appendChild(image);
  }

  const cardContent = buildHomeBarSpecials(bar, specialIds, dayKey, dayLabel);
  if (!cardContent) {
    dismissMapSelectedBarSheet();
    return;
  }

  card.appendChild(cardContent);
  content.appendChild(card);
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
  }
  bindMapSheetDragToDismiss(sheet);
  sheet.style.display = '';
  sheet.style.transform = '';
  sheet.classList.remove('map-sheet-enter');
  sheet.classList.remove('map-sheet-dismissing');
  // restart animation for repeated marker taps
  void sheet.offsetWidth;
  sheet.classList.add('map-sheet-enter');
  mapSelectedBarSheetState.barId = String(bar.bar_id);
}


function bindMapInteractionDismiss() {
  if (!barsMap || mapDismissListenersBound) return;

  const dismissIfOpen = () => {
    if (!mapSelectedBarSheetState.barId) return;
    dismissMapSelectedBarSheetAnimated();
  };

  barsMap.addListener('click', dismissIfOpen);
  barsMap.addListener('dragstart', dismissIfOpen);
  barsMap.addListener('zoom_changed', dismissIfOpen);
  mapDismissListenersBound = true;
}

function renderMapTab() {
  const mapContainer = document.getElementById('bars-map');
  const dayLabelNode = document.getElementById('map-day-label');
  const emptyState = document.getElementById('map-empty-state');

  if (!mapContainer || !dayLabelNode || !emptyState) return;

  const selectedDayKey = getMapSelectedDayKey();
  dayLabelNode.textContent = getMapDayLabel(selectedDayKey);

  const barsForDay = startupPayload?.specials_by_day?.[selectedDayKey] || [];
  const filteredBarsForDay = barsForDay.filter((entry) => {
    const bar = startupPayload?.bars?.[String(entry.bar_id)];
    if (!bar) return false;

    if (activeFilters.neighborhoods.length > 0 && !activeFilters.neighborhoods.includes(bar.neighborhood)) {
      return false;
    }

    if (activeFilters.types.length === 0) {
      return true;
    }

    const specialIds = Array.isArray(entry.specials) ? entry.specials : [];
    return specialIds.some((specialId) => {
      const special = startupPayload?.specials?.[String(specialId)];
      const specialType = special?.special_type || special?.type;
      return specialMatchesTypeFilters(specialType, activeFilters.types);
    });
  });

  dismissMapSelectedBarSheet();

  const barsWithCoordinates = filteredBarsForDay
    .map((entry) => {
      const bar = startupPayload?.bars?.[String(entry.bar_id)];
      if (!bar) return null;
      if (!Number.isFinite(Number(bar.latitude)) || !Number.isFinite(Number(bar.longitude))) return null;
      return {
        bar_id: Number(entry.bar_id),
        name: bar.name,
        neighborhood: bar.neighborhood,
        image_url: bar.image_url,
        currently_open: bar.currently_open,
        is_open_now: bar.is_open_now,
        latitude: Number(bar.latitude),
        longitude: Number(bar.longitude),
        specialIds: Array.isArray(entry.specials) ? entry.specials.map((specialId) => String(specialId)) : []
      };
    })
    .filter(Boolean);

  loadGoogleMapsApi()
    .then(() => {
      if (!barsMap) {
        const mapId = startupPayload?.general_data?.google_map_id || 'DEMO_MAP_ID';
        barsMap = new google.maps.Map(mapContainer, {
          center: { lat: 40.438723047481425, lng: -79.99697911133545 },
          zoom: 4,
          mapId,
          clickableIcons: false,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false
        });
      }

      bindMapInteractionDismiss();

      clearMapMarkers();

      if (barsWithCoordinates.length === 0) {
        emptyState.style.display = '';
        emptyState.textContent = filteredBarsForDay.length === 0
          ? 'No bars match your current day and filters.'
          : 'No bars with specials and map coordinates for this day.';
        return;
      }

      emptyState.style.display = 'none';

      const bounds = new google.maps.LatLngBounds();
      const AdvancedMarkerElement = google.maps.marker?.AdvancedMarkerElement;
      barsWithCoordinates.forEach((bar) => {
        if (!AdvancedMarkerElement) return;

        const marker = new AdvancedMarkerElement({
          position: { lat: bar.latitude, lng: bar.longitude },
          map: barsMap,
          title: bar.name,
          gmpClickable: true,
          content: createBlueMapPinElement()
        });

        bindAdvancedMarkerClick(marker, () => {
          const dayLabel = getMapDayLabel(selectedDayKey);
          showMapSelectedBarSheet(bar, bar.specialIds, selectedDayKey, dayLabel);
        });

        barsMapMarkers.push(marker);
        bounds.extend(marker.position);
      });

      if (barsMapMarkers.length === 0) {
        emptyState.style.display = '';
        emptyState.textContent = 'Advanced markers are unavailable. Please try again later.';
        return;
      }

      barsMap.fitBounds(bounds);
      if (barsWithCoordinates.length === 1) {
        barsMap.setZoom(14);
      }
    })
    .catch((err) => {
      emptyState.style.display = '';
      emptyState.textContent = err.message || 'Unable to render map.';
    });
}
