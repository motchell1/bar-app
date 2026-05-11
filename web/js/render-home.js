const SPECIALS_SCROLL_OFFSET_PX = 10;

function buildHomeBarSpecials(bar, specialIds, dayKey, dayLabel) {
  const specialsLookup = startupPayload?.specials || {};
  const content = document.createElement('div');
  content.className = 'card-content';

  const heading = document.createElement('div');
  heading.className = 'bar-heading';

  const name = document.createElement('div');
  name.className = 'bar-name';
  name.textContent = bar.name;

  const neighborhood = document.createElement('div');
  neighborhood.className = 'bar-neighborhood';
  neighborhood.textContent = bar.neighborhood;

  heading.appendChild(name);
  heading.appendChild(neighborhood);
  content.appendChild(heading);

  const specialsList = document.createElement('ul');
  specialsList.className = 'specials-list';

  let renderedSpecials = 0;
  let hasActiveOrUpcoming = false;

  const isToday = dayKey === startupPayload?.general_data?.current_day;

  const specialsForDisplay = specialIds
    .map((specialId) => ({
      special_id: String(specialId),
      ...specialsLookup[specialId]
    }))
    .filter((special) => Boolean(special && special.description));

  const groupedSpecials = groupSpecialsForUI(specialsForDisplay);
  const isBarFavorite = startupPayload?.bars?.[String(bar.bar_id)]?.favorite === true;

  groupedSpecials.forEach((special) => {
    const specialType = special.special_type || special.type;
    const typePass = specialMatchesTypeFilters(specialType, activeFilters.types);
    const favoritesPass = !activeFilters.favoritesOnly || special.favorite === true || isBarFavorite;
    if (!typePass || !favoritesPass) return;

    const li = buildSpecialItem(special, {
      isToday,
      clickable: true,
      onClick: (event) => {
        event.stopPropagation();
        showSpecialDetail(bar, special, { previousScreen: currentTab, dayLabel });
      }
    });
    specialsList.appendChild(li);
    renderedSpecials += 1;

    const status = String(special.current_status || '').toLowerCase();
    if (status === 'active' || status === 'live' || status === 'upcoming') {
      hasActiveOrUpcoming = true;
    }
  });

  if (renderedSpecials === 0) return null;

  content.appendChild(specialsList);

  const hoursDiv = document.createElement('div');
  hoursDiv.className = 'open-hours';
  const displayText = startupPayload?.open_hours?.[bar.bar_id]?.[dayKey]?.display_text;
  const isCurrentlyOpen = bar.currently_open ?? bar.is_open_now;

  if (displayText) {
    if (isToday && isCurrentlyOpen) {
      const closeTime = startupPayload?.open_hours?.[bar.bar_id]?.[dayKey]?.close_time;
      const closeTimeText = format12Hour(closeTime);
      const statusSpan = document.createElement('span');
      statusSpan.className = 'open';
      statusSpan.textContent = 'Open';
      hoursDiv.appendChild(statusSpan);
      const openSuffix = document.createElement('span');
      openSuffix.textContent = closeTimeText ? ` • Closes ${closeTimeText}` : 'Open now';
      hoursDiv.appendChild(openSuffix);
    } else if (isToday) {
      const openTime = startupPayload?.open_hours?.[bar.bar_id]?.[dayKey]?.open_time;
      const openTimeText = format12Hour(openTime);
      const statusSpan = document.createElement('span');
      statusSpan.className = 'closed';
      statusSpan.textContent = 'Closed';
      hoursDiv.appendChild(statusSpan);
      const closeSuffix = document.createElement('span');
      closeSuffix.textContent = openTimeText ? ` • Opens ${openTimeText}` : 'Closed';
      hoursDiv.appendChild(closeSuffix);
    } else {
      hoursDiv.textContent = `Hours: ${displayText}`;
    }
  } else {
    hoursDiv.textContent = 'Hours unavailable';
  }

  if (!displayText) {
    hoursDiv.classList.add('future');
  }

  content.appendChild(hoursDiv);
  return { content, hasActiveOrUpcoming };
}

function renderBarsWeek() {
  const container = document.getElementById('home-bars');
  if (!container) return;

  container.style.opacity = 0;
  container.innerHTML = '';

  const currentDay = startupPayload?.general_data?.current_day;
  const configuredStartIndex = DAYS_FULL.findIndex((day) => day.slice(0, 3).toUpperCase() === currentDay);
  const startIndex = configuredStartIndex >= 0 ? configuredStartIndex : new Date().getDay();
  const orderedDays = Array.from({ length: 7 }, (_, offset) => {
    const dayName = DAYS_FULL[(startIndex + offset + 7) % 7];
    return {
      dayKey: dayName.slice(0, 3).toUpperCase(),
      dayLabel: offset === 0 ? `${dayName} (Today)` : dayName
    };
  });


  let scrollTargetCard = null;

  orderedDays.forEach(({ dayKey, dayLabel }, dayIndex) => {
    const barsForDay = startupPayload?.specials_by_day?.[dayKey] || [];

    const dayHeader = document.createElement('div');
    dayHeader.className = 'day-header-week';
    dayHeader.textContent = dayLabel;
    container.appendChild(dayHeader);

    let renderedCardCountForDay = 0;
    const renderedCardsForDay = [];

    barsForDay.forEach((entry) => {
      const barId = String(entry.bar_id);
      const barInfo = startupPayload?.bars?.[barId];
      if (!barInfo) return;

      if (activeFilters.neighborhoods.length > 0 && !activeFilters.neighborhoods.includes(barInfo.neighborhood)) return;
      if (activeFilters.favoritesOnly) {
        const hasFavoriteSpecial = (entry.specials || []).some((specialId) => startupPayload?.specials?.[String(specialId)]?.favorite === true);
        if (!hasFavoriteSpecial && barInfo.favorite !== true) return;
      }

      const bar = {
        bar_id: Number(barId),
        name: barInfo.name,
        neighborhood: barInfo.neighborhood,
        image_url: barInfo.image_url,
        currently_open: barInfo.currently_open,
        is_open_now: barInfo.is_open_now,
        has_special_this_week: barInfo.has_special_this_week
      };

      const card = document.createElement('div');
      card.className = 'bar-card tap-pressable';
      card.onclick = () => animateTapAndNavigate(card, () => showDetail(bar, currentTab));

      if (bar.image_url && bar.image_url !== 'null') {
        const img = document.createElement('img');
        img.className = 'card-image';
        img.src = bar.image_url;
        img.alt = bar.name;
        card.appendChild(img);
      }

      const homeSpecials = buildHomeBarSpecials(bar, entry.specials || [], dayKey, dayLabel);
      if (!homeSpecials) return;

      card.appendChild(homeSpecials.content);
      renderedCardsForDay.push({
        card,
        hasActiveOrUpcoming: homeSpecials.hasActiveOrUpcoming
      });
      renderedCardCountForDay += 1;
    });

    if (renderedCardsForDay.length > 0) {
      if (dayIndex === 0) {
        const withoutActiveOrUpcoming = renderedCardsForDay.filter((entry) => !entry.hasActiveOrUpcoming);
        const withActiveOrUpcoming = renderedCardsForDay.filter((entry) => entry.hasActiveOrUpcoming);

        withoutActiveOrUpcoming.forEach((entry) => container.appendChild(entry.card));

        const hasBarCardsAboveDivider = container.querySelector('.bar-card') !== null;
        if (hasBarCardsAboveDivider && withoutActiveOrUpcoming.length > 0 && withActiveOrUpcoming.length > 0) {
          const divider = document.createElement('div');
          divider.className = 'active-upcoming-divider';
          container.appendChild(divider);
          scrollTargetCard = withActiveOrUpcoming[0].card;
        }

        withActiveOrUpcoming.forEach((entry) => container.appendChild(entry.card));
      } else {
        renderedCardsForDay.forEach((entry) => container.appendChild(entry.card));
      }
    }

    if (renderedCardCountForDay === 0) {
      const noSpecialsLine = document.createElement('div');
      noSpecialsLine.className = 'no-specials-line';
      noSpecialsLine.textContent = barsForDay.length === 0
        ? 'No specials available.'
        : 'No specials match your current filters.';
      noSpecialsLine.style.padding = '12px';
      noSpecialsLine.style.fontStyle = 'italic';
      container.appendChild(noSpecialsLine);
    }
  });

  requestAnimationFrame(() => {
    const homeScreen = document.getElementById('home-screen');
    if (homeScreen) {
      if (scrollTargetCard) {
        const cardRect = typeof scrollTargetCard.getBoundingClientRect === 'function'
          ? scrollTargetCard.getBoundingClientRect()
          : null;
        const homeRect = typeof homeScreen.getBoundingClientRect === 'function'
          ? homeScreen.getBoundingClientRect()
          : null;
        const currentScrollTop = Number(homeScreen.scrollTop || 0);
        const fallbackTop = Number(scrollTargetCard.offsetTop || 0);
        const top = cardRect && homeRect
          ? (cardRect.top - homeRect.top + currentScrollTop)
          : fallbackTop;
        homeScreen.scrollTop = Math.max(0, top - SPECIALS_SCROLL_OFFSET_PX);
      } else {
        homeScreen.scrollTop = 0;
      }
    }

    container.style.opacity = 1;
    lucide.createIcons();
  });
}

function getSortedFilteredBars(bars) {
  const query = barsSearchQuery.trim().toLowerCase();
  const selectedNeighborhoods = activeFilters.neighborhoods;

  return bars
    .filter((bar) => {
      const neighborhoodPass = selectedNeighborhoods.length === 0 || selectedNeighborhoods.includes(bar.neighborhood);
      if (!neighborhoodPass) return false;
      if (activeFilters.favoritesOnly && bar.favorite !== true) return false;
      if (!query) return true;
      const name = (bar.name || '').toLowerCase();
      return name.includes(query);
    });
}

function renderBarsList(bars) {
  const list = document.getElementById('bars-list');
  if (!list) return;

  list.innerHTML = '';

  const sortedBars = getSortedFilteredBars(bars);

  sortedBars.forEach((bar) => {
    const card = document.createElement('div');
    card.className = 'bars-list-card tap-pressable';
    card.onclick = () => animateTapAndNavigate(card, () => showDetail(bar, currentTab));

    const img = document.createElement('img');
    img.className = 'bars-list-thumb';
    img.src = (bar.image_url && bar.image_url !== 'null')
      ? bar.image_url
      : 'https://placehold.co/144x144?text=Bar';
    img.alt = bar.name;

    const content = document.createElement('div');
    content.className = 'bars-list-content';

    const name = document.createElement('div');
    name.className = 'bars-list-name';
    name.textContent = bar.name || '';

    const neighborhood = document.createElement('div');
    neighborhood.className = 'bars-list-neighborhood';
    neighborhood.textContent = bar.neighborhood || '';

    content.appendChild(name);
    content.appendChild(neighborhood);

    const chevron = document.createElement('span');
    chevron.className = 'bars-list-chevron';
    chevron.setAttribute('data-lucide', 'chevron-right');

    card.appendChild(img);
    card.appendChild(content);
    card.appendChild(chevron);
    list.appendChild(card);
  });

  lucide.createIcons();
}
