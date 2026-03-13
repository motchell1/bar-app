function getSpecialId(bar, special, dayLabel = '') {
  return special.special_id;
}

function isFavoriteSpecial(bar, special, dayLabel = '') {
  const specialId = getSpecialId(bar, special, dayLabel);
  return favorites.some((item) => item.id === specialId);
}

function toggleFavoriteSpecial(bar, special, dayLabel = 'Day unavailable') {
  const specialId = getSpecialId(bar, special, dayLabel);
  const existingIndex = favorites.findIndex((item) => item.id === specialId);

  if (existingIndex >= 0) {
    favorites.splice(existingIndex, 1);
    return false;
  }

  favorites.push({
    id: specialId,
    bar,
    special,
    dayLabel
  });

  return true;
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

function renderFavorites(items = favorites) {
  const favoritesScreen = document.getElementById('favorites-screen');
  const favoritesList = document.getElementById('favorites-list');
  if (!favoritesScreen || !favoritesList) return;

  favoritesList.innerHTML = '';

  if (items.length === 0) {
    const emptyState = document.createElement('div');
    emptyState.className = 'no-specials-line';
    emptyState.style.padding = '12px';
    emptyState.textContent = favorites.length === 0
      ? 'No favorites yet. Tap the star on a special to save it here.'
      : 'No favorites match your current filters.';
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

    const specialItem = buildSpecialItem(item.special);

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
