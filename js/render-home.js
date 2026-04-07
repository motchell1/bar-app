function buildHomeBarSpecials(bar, specialIds, dayKey, dayLabel) {
  const specialsLookup = startupPayload?.specials || {};
  const content = document.createElement('div');
  content.className = 'card-content';

  const name = document.createElement('div');
  name.className = 'bar-name';
  name.textContent = bar.name;

  const neighborhood = document.createElement('div');
  neighborhood.className = 'bar-neighborhood';
  neighborhood.textContent = bar.neighborhood;

  content.appendChild(name);
  content.appendChild(neighborhood);

  const specialsList = document.createElement('ul');
  specialsList.className = 'specials-list';

  let renderedSpecials = 0;

  const isToday = dayKey === startupPayload?.general_data?.current_day;

  const specialsForDisplay = specialIds
    .map((specialId) => ({
      special_id: String(specialId),
      ...specialsLookup[specialId]
    }))
    .filter((special) => Boolean(special && special.description));

  const groupedSpecials = groupSpecialsForUI(specialsForDisplay);

  groupedSpecials.forEach((special) => {
    const specialType = special.special_type || special.type;
    const typePass = activeFilters.types.length === 0 || activeFilters.types.includes(specialType);
    if (!typePass) return;

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
  return content;
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


  orderedDays.forEach(({ dayKey, dayLabel }) => {
    const barsForDay = startupPayload?.specials_by_day?.[dayKey] || [];

    const dayHeader = document.createElement('div');
    dayHeader.className = 'day-header-week';
    dayHeader.textContent = dayLabel;
    container.appendChild(dayHeader);

    let renderedCardCountForDay = 0;

    barsForDay.forEach((entry) => {
      const barId = String(entry.bar_id);
      const barInfo = startupPayload?.bars?.[barId];
      if (!barInfo) return;

      if (activeFilters.neighborhoods.length > 0 && !activeFilters.neighborhoods.includes(barInfo.neighborhood)) return;

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

      const homeContent = buildHomeBarSpecials(bar, entry.specials || [], dayKey, dayLabel);
      if (!homeContent) return;

      card.appendChild(homeContent);
      container.appendChild(card);
      renderedCardCountForDay += 1;
    });

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
    })
    .sort((a, b) => {
      const neighborhoodCompare = (a.neighborhood || '').localeCompare(b.neighborhood || '', undefined, { sensitivity: 'base' });
      if (neighborhoodCompare !== 0) return neighborhoodCompare;
      return (a.name || '').localeCompare(b.name || '', undefined, { sensitivity: 'base' });
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
