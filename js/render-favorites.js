function getSpecialId(bar, special, dayLabel = '') {
  if (special?.special_id !== undefined && special?.special_id !== null) return String(special.special_id);
  if (typeof resolveSpecialId === 'function') {
    return resolveSpecialId(special, bar);
  }
  void dayLabel;
  return null;
}

function isFavoriteSpecial(bar, special, dayLabel = '') {
  const specialId = getSpecialId(bar, special, dayLabel);
  if (!specialId) return false;
  return startupPayload?.specials?.[String(specialId)]?.favorite === true;
}

function toggleFavoriteSpecial(bar, special, dayLabel = 'Day unavailable') {
  const specialId = getSpecialId(bar, special, dayLabel);
  if (!specialId || !startupPayload?.specials?.[String(specialId)]) return false;

  const specialRecord = startupPayload.specials[String(specialId)];
  const nowFavorited = !specialRecord.favorite;
  specialRecord.favorite = nowFavorited;

  void persistFavoriteChangeInBackground(specialId, nowFavorited);

  return nowFavorited;
}

function getFavoriteSpecialEntries() {
  const specialsLookup = startupPayload?.specials || {};
  const barsLookup = startupPayload?.bars || {};
  const openHoursLookup = startupPayload?.open_hours || {};

  return Object.entries(specialsLookup)
    .filter(([, special]) => special.favorite === true)
    .map(([specialId, special]) => {
      const barId = String(special.bar_id);
      const barData = barsLookup[barId];
      if (!barData) return null;

      const dayLabel = DAYS_FULL.find((day) => day.slice(0, 3).toUpperCase() === special.day) || 'Day unavailable';

      return {
        id: String(specialId),
        special: { special_id: String(specialId), ...special },
        bar: { bar_id: Number(barId), ...barData },
        openHours: openHoursLookup[barId] || {},
        dayLabel
      };
    })
    .filter(Boolean);
}

function updateSpecialFavoriteButton(isFavorited) {
  const button = document.querySelector('.special-favorite-button');
  if (!button) return;

  button.classList.toggle('active', isFavorited);
  button.setAttribute('aria-pressed', isFavorited ? 'true' : 'false');
}

function createFavoriteButton(bar, special, dayLabel, { onUnfavorite } = {}) {
  const favoriteButton = document.createElement('button');
  favoriteButton.className = 'special-favorite-button';
  favoriteButton.type = 'button';
  favoriteButton.setAttribute('aria-label', 'Favorite special');
  favoriteButton.innerHTML = '<span data-lucide="star"></span>';

  const syncFavoriteState = () => {
    const favoriteState = isFavoriteSpecial(bar, special, dayLabel);
    favoriteButton.classList.toggle('active', favoriteState);
    favoriteButton.setAttribute('aria-pressed', favoriteState ? 'true' : 'false');
  };

  favoriteButton.addEventListener('click', (event) => {
    event.stopPropagation();
    const nowFavorited = toggleFavoriteSpecial(bar, special, dayLabel);
    favoriteButton.classList.toggle('active', nowFavorited);
    favoriteButton.setAttribute('aria-pressed', nowFavorited ? 'true' : 'false');

    let shouldRenderFavoritesImmediately = true;
    if (!nowFavorited && typeof onUnfavorite === 'function') {
      shouldRenderFavoritesImmediately = false;
      onUnfavorite(() => {
        renderCurrentTabData();
      });
    }

    if (currentTab === 'favorites' && shouldRenderFavoritesImmediately) {
      renderCurrentTabData();
    }

    if (currentSpecialContext && getSpecialId(currentSpecialContext.bar, currentSpecialContext.special, currentSpecialContext.dayLabel) === getSpecialId(bar, special, dayLabel)) {
      updateSpecialFavoriteButton(nowFavorited);
    }

    lucide.createIcons();
  });

  syncFavoriteState();
  return favoriteButton;
}

function renderFavorites(items = getFavoriteSpecialEntries()) {
  const favoritesScreen = document.getElementById('favorites-screen');
  const favoritesList = document.getElementById('favorites-list');
  if (!favoritesScreen || !favoritesList) return;

  favoritesList.innerHTML = '';

  const hasAnyFavorites = getFavoriteSpecialEntries().length > 0;

  if (items.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'no-specials-line';
    emptyState.style.padding = '12px';
    emptyState.textContent = hasAnyFavorites
      ? 'No favorites match your current filters.'
      : 'No favorites yet. Tap the star on a special to save it here.';
    favoritesList.appendChild(emptyState);
    return;
  }

  items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'bar-card';
    card.onclick = () => showSpecialDetail(item.bar, item.special, { previousScreen: 'favorites', dayLabel: item.dayLabel });

    const content = document.createElement('div');
    content.className = 'card-content';

    const name = document.createElement('div');
    name.className = 'bar-name';
    name.textContent = item.bar.name;

    const headerRow = document.createElement('div');
    headerRow.className = 'special-card-header-row';

    const favoriteButton = createFavoriteButton(item.bar, item.special, item.dayLabel, {
      onUnfavorite: (onDone) => {
        card.style.pointerEvents = 'none';
        const cardHeight = card.offsetHeight;
        card.style.height = `${cardHeight}px`;
        card.style.overflow = 'hidden';

        requestAnimationFrame(() => {
          card.classList.add('is-removing');
        });

        setTimeout(() => {
          card.classList.add('is-collapsing');
        }, 220);

        setTimeout(() => {
          if (typeof onDone === 'function') onDone();
        }, 700);
      }
    });

    const dayBadge = document.createElement('div');
    dayBadge.className = 'special-day-badge';
    dayBadge.textContent = item.dayLabel || 'Day unavailable';

    const specialItem = buildSpecialItem(item.special, { neutralTimeBadgeStyle: true });

    headerRow.appendChild(name);
    headerRow.appendChild(favoriteButton);

    content.appendChild(headerRow);
    content.appendChild(dayBadge);
    content.appendChild(specialItem);

    card.appendChild(content);
    favoritesList.appendChild(card);
  });

  lucide.createIcons();
}

function initSpecialFavoriteButton() {
  // Favorite buttons are rendered per-card so no static toolbar listener is required.
}
