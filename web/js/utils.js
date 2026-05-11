function format12Hour(timeStr) {
  if (!timeStr || timeStr === 'null') return '';
  const [hourStr, minuteStr] = timeStr.split(':');
  let hour = parseInt(hourStr, 10);

  if (hour === 24) hour = 0;

  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minuteStr} ${ampm}`;
}

function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [h, m] = timeStr.split(':').map(Number);
  if (h === 0 && m === 0) return 24 * 60;
  return h * 60 + m;
}

function isSpecialPast(special, isToday) {
  if (!isToday) return false;
  if (special.all_day) return false;

  const now = new Date();
  const currentMinutes = now.getHours() * 60 + now.getMinutes();

  let endMinutes = timeToMinutes(special.end_time);
  if (special.end_time === '00:00') endMinutes = 24 * 60;

  return endMinutes < currentMinutes;
}

function isSpecialActive(special) {
  if (special.all_day) return true;

  const now = new Date();

  const [startHour, startMinute] = special.start_time.split(':').map(Number);
  const [endHour, endMinute] = special.end_time.split(':').map(Number);

  const start = new Date();
  start.setHours(startHour, startMinute, 0, 0);

  const end = new Date();
  end.setHours(endHour, endMinute, 0, 0);

  return now >= start && now <= end;
}

function groupSpecialsForUI(specials) {
  const groups = new Map();

  specials.forEach((special) => {
    if (!special) return;
    const specialType = special.special_type || special.type || '';
    const key = [
      specialType,
      special.all_day ? 'all-day' : 'timed',
      special.start_time || '',
      special.end_time || ''
    ].join('|');

    if (!groups.has(key)) {
      groups.set(key, []);
    }
    groups.get(key).push(special);
  });

  return Array.from(groups.values()).map((group) => {
    const baseSpecial = { ...group[0] };
    const uniqueDescriptions = Array.from(
      new Set(
        group
          .map((special) => (special.description || '').trim())
          .filter(Boolean)
      )
    );

    baseSpecial.description = uniqueDescriptions.join(' • ');
    baseSpecial.grouped_special_ids = group
      .map((special) => special.special_id || null)
      .filter(Boolean);
    baseSpecial.group_size = group.length;

    const hasLive = group.some((special) => special.current_status === 'live' || special.current_status === 'active');
    const hasUpcoming = group.some((special) => special.current_status === 'upcoming');
    const hasPast = group.some((special) => special.current_status === 'past');

    if (hasLive) baseSpecial.current_status = 'live';
    else if (hasUpcoming) baseSpecial.current_status = 'upcoming';
    else if (hasPast) baseSpecial.current_status = 'past';

    return baseSpecial;
  });
}

function normalizeSpecialType(type) {
  return String(type || '').trim().toLowerCase();
}

function specialMatchesTypeFilters(specialType, selectedTypes = []) {
  if (!Array.isArray(selectedTypes) || selectedTypes.length === 0) return true;

  const normalizedSpecialType = normalizeSpecialType(specialType);
  const normalizedSelectedTypes = selectedTypes.map((type) => normalizeSpecialType(type));

  if (normalizedSpecialType === 'combo') {
    return normalizedSelectedTypes.includes('combo')
      || normalizedSelectedTypes.includes('food')
      || normalizedSelectedTypes.includes('drink');
  }

  return normalizedSelectedTypes.includes(normalizedSpecialType);
}

function buildSpecialItem(special, { isToday = false, clickable = false, onClick = null, neutralTimeBadgeStyle = false } = {}) {
  const item = document.createElement('div');
  item.className = 'special-item';

  const timeBadge = document.createElement('span');
  timeBadge.className = 'time-badge';
  if (special.all_day) {
    timeBadge.textContent = 'ALL DAY';
  } else {
    const startFormatted = format12Hour(special.start_time);
    const endFormatted = format12Hour(special.end_time);
    timeBadge.innerHTML = `${startFormatted}<br>${endFormatted}`;
  }

  const currentStatus = special.current_status || null;
  if (!neutralTimeBadgeStyle && currentStatus === 'past') {
    timeBadge.classList.add('past');
  } else if (!neutralTimeBadgeStyle && !special.all_day && isToday && isSpecialPast(special, true)) {
    timeBadge.classList.add('past');
  }

  if (!neutralTimeBadgeStyle && (currentStatus === 'active' || currentStatus === 'live')) {
    item.classList.add('live');
  } else if (!neutralTimeBadgeStyle && isToday && isSpecialActive(special)) {
    item.classList.add('live');
  }

  const specialType = normalizeSpecialType(special.special_type || special.type || '');
  const typeIcon = document.createElement('span');
  typeIcon.className = `type-icon ${specialType}`;

  const icons = specialType === 'combo'
    ? ['utensils', 'beer']
    : (specialType === 'food' ? ['utensils'] : (specialType === 'drink' ? ['beer'] : []));

  icons.forEach((iconName) => {
    const icon = document.createElement('span');
    icon.className = 'type-icon-glyph';
    icon.setAttribute('data-lucide', iconName);
    typeIcon.appendChild(icon);
  });

  const desc = document.createElement('span');
  desc.className = 'special-description';
  desc.textContent = special.description;

  item.appendChild(timeBadge);
  item.appendChild(desc);
  item.appendChild(typeIcon);

  if (!neutralTimeBadgeStyle && (currentStatus === 'active' || currentStatus === 'live' || (isToday && isSpecialActive(special)))) {
    const dot = document.createElement('span');
    dot.className = 'active-dot';
    item.appendChild(dot);
  }

  if (clickable && typeof onClick === 'function') {
    item.classList.add('clickable-special', 'tap-pressable');
    item.onclick = (event) => {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      animateTapAndNavigate(item, () => onClick(event));
    };
  }

  return item;
}

function userPrefersReducedMotion() {
  return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function animateTapAndNavigate(element, navigate) {
  if (typeof navigate !== 'function') return;
  if (!element || userPrefersReducedMotion()) {
    navigate();
    return;
  }

  element.classList.add('tap-press-active');
  setTimeout(() => {
    element.classList.remove('tap-press-active');
    navigate();
  }, 120);
}

function animateScreenIn(screenId) {
  const targetScreen = document.getElementById(screenId);
  if (!targetScreen || userPrefersReducedMotion()) return;

  targetScreen.classList.remove('screen-animate-in');
  requestAnimationFrame(() => {
    targetScreen.classList.add('screen-animate-in');
    setTimeout(() => {
      targetScreen.classList.remove('screen-animate-in');
    }, 220);
  });
}
