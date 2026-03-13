function renderBarsWeek(bars) {
  const container = document.getElementById('home-bars');
  if (!container) return;

  container.style.opacity = 0;

  const renderContent = () => {
    container.innerHTML = '';

    for (let offset = 0; offset < 7; offset++) {
      const date = new Date();
      date.setDate(date.getDate() + offset);
      const dayIndex = date.getDay();
      const dayKey = DAYS_FULL[dayIndex].slice(0, 3).toUpperCase();
      const dayName = DAYS_FULL[dayIndex];
      const label = offset === 0 ? `${dayName} (Today)` : dayName;
      const isToday = offset === 0;
      const barsWithSpecials = bars.filter((bar) => (bar.specials_by_day[dayKey] || []).length > 0);

      const dayHeader = document.createElement('div');
      dayHeader.className = 'day-header-week';
      dayHeader.textContent = label;
      container.appendChild(dayHeader);
      if (barsWithSpecials.length === 0) {
        const noSpecialsLine = document.createElement('div');
        noSpecialsLine.className = 'no-specials-line';
        noSpecialsLine.textContent = 'No specials available for today.';
        noSpecialsLine.style.padding = '12px';
        noSpecialsLine.style.fontStyle = 'italic';
        container.appendChild(noSpecialsLine);
        continue;
      }

      const sortedBars = sortBarsBySpecials(barsWithSpecials, dayKey, isToday);

      let dividerInserted = false;
      const todayDivider = document.createElement('div');
      todayDivider.className = 'today-divider';
      todayDivider.textContent = 'Current + Upcoming Specials';

      sortedBars.forEach((bar) => {
        const card = document.createElement('div');
        card.className = 'bar-card';
        card.onclick = () => showDetail(bar, currentTab);

        if (bar.image_url && bar.image_url !== 'null') {
          const img = document.createElement('img');
          img.className = 'card-image';
          img.src = bar.image_url;
          img.alt = bar.name;
          card.appendChild(img);
        }

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
        const daySpecials = bar.specials_by_day[dayKey];

        daySpecials.forEach((special) => {
          const li = buildSpecialItem(special, {
            isToday,
            clickable: true,
            onClick: (event) => {
              event.stopPropagation();
              showSpecialDetail(bar, special, { previousScreen: currentTab, dayLabel: label });
            }
          });
          specialsList.appendChild(li);
        });

        content.appendChild(specialsList);

        const hours = bar.hours_by_day ? bar.hours_by_day[dayKey] : null;
        const hoursDiv = document.createElement('div');
        hoursDiv.className = 'open-hours';
        if (hours) {
          if (offset === 0) {
            const status = getOpenStatus(hours);
            hoursDiv.innerHTML = '';
            const labelSpan = document.createElement('span');
            labelSpan.textContent = status.label;
            labelSpan.classList.add(status.status);
            hoursDiv.appendChild(labelSpan);
            const textNode = document.createTextNode(
              status.status === 'open'
                ? ` - Closes ${format12Hour(status.time)}`
                : ` - Opens ${format12Hour(status.time)}`
            );
            hoursDiv.appendChild(textNode);
          } else {
            hoursDiv.textContent = `Hours: ${format12Hour(hours.open_time)} – ${format12Hour(hours.close_time)}`;
          }
        } else {
          hoursDiv.textContent = 'Hours unavailable';
          hoursDiv.classList.add('future');
        }

        content.appendChild(hoursDiv);
        card.appendChild(content);
        container.appendChild(card);

        if (isToday && !dividerInserted) {
          const currentDaySpecials = bar.specials_by_day[dayKey] || [];
          const hasExpiredTimedSpecial = currentDaySpecials.some((s) => !s.all_day && isSpecialPast(s, true));
          const hasAllDaySpecial = currentDaySpecials.some((s) => s.all_day);
          if (hasExpiredTimedSpecial && !hasAllDaySpecial) {
            container.appendChild(todayDivider);
            dividerInserted = true;
          }
        }
      });
    }

    requestAnimationFrame(() => {
      container.style.opacity = 1;
      lucide.createIcons();
    });
  };

  renderContent();
}

function getSortedFilteredBars(bars) {
  const query = barsSearchQuery.trim().toLowerCase();
  const selectedNeighborhoods = activeFilters.neighborhoods;

  return bars
    .filter((bar) => {
      const neighborhoodPass = selectedNeighborhoods.length === 0 || selectedNeighborhoods.includes(bar.neighborhood);
      if (!neighborhoodPass) return false;
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
    card.className = 'bars-list-card';
    card.onclick = () => showDetail(bar, currentTab);

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
