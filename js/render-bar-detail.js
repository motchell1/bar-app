function getDayKeyFromName(dayName) {
  return normalizeDayKey(dayName);
}

function getOrderedDaysForDetail(todayKey) {
  const todayIndex = DAYS_FULL.findIndex((day) => day.slice(0, 3).toUpperCase() === todayKey);
  if (todayIndex < 0) return DAYS_FULL.slice();
  return DAYS_FULL.slice(todayIndex).concat(DAYS_FULL.slice(0, todayIndex));
}

function getBarFromPayload(barOrId) {
  const barId = String(typeof barOrId === 'object' ? barOrId?.bar_id : barOrId);
  const barData = startupPayload?.bars?.[barId];
  if (!barData) return null;

  return {
    bar_id: Number(barId),
    ...barData
  };
}

function showDetail(barOrId, previousScreen = currentTab) {
  const selectedBar = getBarFromPayload(barOrId) || (typeof barOrId === 'object' ? barOrId : null);
  if (!selectedBar) return;

  previousScreenState = { type: previousScreen };
  document.getElementById('home-screen').style.display = 'none';
  document.getElementById('bars-screen').style.display = 'none';
  document.getElementById('favorites-screen').style.display = 'none';
  document.getElementById('special-screen').style.display = 'none';
  document.getElementById('detail-screen').style.display = 'block';
  setScreenLayout(false);

  document.getElementById('detail-image').src = selectedBar.image_url || '';
  document.getElementById('detail-name').textContent = (selectedBar.name || '').toUpperCase();

  const todayKey = normalizeDayKey(startupPayload?.general_data?.current_day);
  const orderedDays = getOrderedDaysForDetail(todayKey);
  const openHoursForBar = startupPayload?.open_hours?.[String(selectedBar.bar_id)] || {};

  const hoursEl = document.getElementById('detail-hours');
  hoursEl.innerHTML = '';

  orderedDays.forEach((day) => {
    const dayKey = getDayKeyFromName(day);
    const hours = openHoursForBar[dayKey] || null;

    const row = document.createElement('tr');
    if (dayKey === todayKey) row.classList.add('today');

    const dayCell = document.createElement('td');
    dayCell.textContent = day;

    const hoursCell = document.createElement('td');
    hoursCell.textContent = hours?.display_text || '';

    row.appendChild(dayCell);
    row.appendChild(hoursCell);
    hoursEl.appendChild(row);
  });

  const specialsContainer = document.getElementById('detail-specials');
  specialsContainer.innerHTML = '';

  orderedDays.forEach((day) => {
    const dayKey = getDayKeyFromName(day);
    const dayEntries = startupPayload?.specials_by_day?.[dayKey] || [];
    const barEntry = dayEntries.find((entry) => String(entry.bar_id) === String(selectedBar.bar_id));
    const specialIds = barEntry?.specials || [];

    const wrapper = document.createElement('div');
    wrapper.className = 'day-group';

    const header = document.createElement('div');
    header.className = 'day-header';
    if (dayKey === todayKey) header.classList.add('today');

    const label = document.createElement('span');
    label.textContent = dayKey === todayKey ? `${day} (Today)` : day;

    const arrow = document.createElement('span');
    arrow.className = 'arrow rotate';
    arrow.textContent = '▶';

    header.appendChild(label);
    header.appendChild(arrow);

    const content = document.createElement('div');
    content.className = 'day-content expanded';

    if (specialIds.length > 0) {
      specialIds.forEach((specialId) => {
        const specialData = startupPayload?.specials?.[String(specialId)];
        if (!specialData) return;

        const special = {
          special_id: String(specialId),
          ...specialData
        };

        const div = buildSpecialItem(special, {
          neutralTimeBadgeStyle: true,
          clickable: true,
          onClick: () => showSpecialDetail(selectedBar, special, {
            previousScreen: 'detail',
            returnTo: previousScreenState?.type || currentTab,
            dayLabel: dayKey === todayKey ? `${day} (Today)` : day
          })
        });
        content.appendChild(div);
      });
    }

    if (content.children.length === 0) {
      const noSpecials = document.createElement('div');
      noSpecials.className = 'special-item no-specials-item';

      const desc = document.createElement('span');
      desc.className = 'special-description';
      desc.textContent = 'No specials today.';

      noSpecials.appendChild(desc);
      content.appendChild(noSpecials);
    }

    wrapper.appendChild(header);
    wrapper.appendChild(content);
    specialsContainer.appendChild(wrapper);

    requestAnimationFrame(() => {
      content.style.maxHeight = `${content.scrollHeight}px`;
      lucide.createIcons();
    });

    header.onclick = () => {
      const isOpen = content.style.maxHeight && content.style.maxHeight !== '0px';
      if (isOpen) {
        content.style.maxHeight = '0px';
        content.classList.remove('expanded');
        arrow.classList.remove('rotate');
      } else {
        content.style.maxHeight = `${content.scrollHeight}px`;
        content.classList.add('expanded');
        arrow.classList.add('rotate');
      }
    };
  });
}
