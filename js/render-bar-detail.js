function showDetail(bar, previousScreen = currentTab) {
  previousScreenState = { type: previousScreen };
  document.getElementById('home-screen').style.display = 'none';
  document.getElementById('bars-screen').style.display = 'none';
  document.getElementById('favorites-screen').style.display = 'none';
  document.getElementById('special-screen').style.display = 'none';
  document.getElementById('detail-screen').style.display = 'block';
  setScreenLayout(false);

  document.getElementById('detail-image').src = bar.image_url || '';
  document.getElementById('detail-name').textContent = bar.name.toUpperCase();

  const hoursEl = document.getElementById('detail-hours');
  hoursEl.innerHTML = '';

  const todayIndex = new Date().getDay();
  const DAYS_ORDERED = DAYS_FULL.slice(todayIndex).concat(DAYS_FULL.slice(0, todayIndex));

  DAYS_ORDERED.forEach((day) => {
    const h = bar.hours_by_day ? bar.hours_by_day[day.slice(0, 3).toUpperCase()] : null;
    const row = document.createElement('tr');
    if (day === DAYS_FULL[todayIndex]) row.classList.add('today');
    const dayCell = document.createElement('td');
    dayCell.textContent = day;
    const hoursCell = document.createElement('td');
    hoursCell.textContent = h ? (h.closed ? 'Closed' : `${format12Hour(h.open_time)} – ${format12Hour(h.close_time)}`) : '';
    row.appendChild(dayCell);
    row.appendChild(hoursCell);
    hoursEl.appendChild(row);
  });

  const specialsContainer = document.getElementById('detail-specials');
  specialsContainer.innerHTML = '';
  DAYS_ORDERED.forEach((day) => {
    const key = day.slice(0, 3).toUpperCase();
    const specials = (bar.specials_by_day && bar.specials_by_day[key]) || [];

    const wrapper = document.createElement('div');
    wrapper.className = 'day-group';

    const header = document.createElement('div');
    header.className = 'day-header';
    if (day === DAYS_FULL[todayIndex]) header.classList.add('today');

    const label = document.createElement('span');
    label.textContent = day === DAYS_FULL[todayIndex] ? `${day} (Today)` : day;

    const arrow = document.createElement('span');
    arrow.className = 'arrow rotate';
    arrow.textContent = '▶';

    header.appendChild(label);
    header.appendChild(arrow);

    const content = document.createElement('div');
    content.className = 'day-content expanded';

    if (specials.length > 0) {
      specials.forEach((special) => {
        const div = buildSpecialItem(special, {
          clickable: true,
          onClick: () => showSpecialDetail(bar, special, { previousScreen: 'detail', returnTo: previousScreenState?.type || currentTab, dayLabel: day === DAYS_FULL[todayIndex] ? `${day} (Today)` : day })
        });
        content.appendChild(div);
      });
    } else {
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
