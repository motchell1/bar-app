// ===== Utilities =====
function format12Hour(timeStr) {
  if (!timeStr || timeStr === 'null') return '';
  const [hourStr, minuteStr] = timeStr.split(':');
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);

  if (hour === 24) hour = 0;

  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return `${hour}:${minuteStr} ${ampm}`;
}

function formatSpecialTime(startTime, endTime) {
  if (!startTime || !endTime) return '';

  const formatSingle = (timeStr) => {
    if (!timeStr) return '';
    const [hourStr, minStr] = timeStr.split(':');
    let hour = parseInt(hourStr, 10);
    const minute = parseInt(minStr, 10);

    let ampm = hour >= 12 ? 'PM' : 'AM';
    if (hour === 0) ampm = 'AM'; // midnight
    hour = hour % 12;
    if (hour === 0) hour = 12;

    return `${hour}:${minStr} ${ampm}`;
  };

  const sStr = formatSingle(startTime);
  const eStr = formatSingle(endTime);

  // Determine AM/PM for display
  const sHour = parseInt(startTime.split(':')[0], 10);
  const eHour = parseInt(endTime.split(':')[0], 10);
  const sAMPM = sHour === 0 ? 'AM' : sHour >= 12 ? 'PM' : 'AM';
  const eAMPM = eHour === 0 ? 'AM' : eHour >= 12 ? 'PM' : 'AM';

  if (!sStr || !eStr) return ''; // fallback

  return `${sStr} – ${eStr}`;
}

// Check if a special is currently ongoing
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

// determine if bar is currently open/Closed
function getOpenStatus(hours) {
 if (!hours || hours.closed) {
   return { status: 'closed', label: 'Closed', color: 'red' };
 }
 const now = new Date();
 const currentMinutes = now.getHours() * 60 + now.getMinutes();
 const openMinutes = timeToMinutes(hours.open_time);
 const closeMinutes = timeToMinutes(hours.close_time);
 if (currentMinutes >= openMinutes && currentMinutes <= closeMinutes) {
   return { status: 'open', label: 'Open', color: 'green', time: hours.close_time };
 } else {
   return { status: 'closed', label: 'Closed', color: 'red', time: hours.open_time };
 }
}

// ===== Home Screen State =====
let barsData = [];
const DAYS_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
let currentTab = 'specials';
let barsSearchQuery = '';
let previousScreenState = null;
let favorites = [];
let currentSpecialContext = null;
const STARTUP_API_URL = 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/getStartupData';
const SPECIAL_REPORT_API_URL = 'https://3kz7x6tvvi.execute-api.us-east-2.amazonaws.com/default/insertUserReport';
const activeFilters = {
  types: [],
  neighborhoods: []
};

// ===== Helpers =====

// Convert time string "HH:MM" to minutes since midnight
function timeToMinutes(timeStr) {
  if (!timeStr) return 0; // treat missing time as 0 minutes (start of day)
  const [h, m] = timeStr.split(':').map(Number);
  // Treat "00:00" as 24:00 for comparison
  if (h === 0 && m === 0) return 24 * 60;
  return h * 60 + m;
}

// Determine if a special has already passed
function isSpecialPast(special, isToday) {
 if (!isToday) return false;
 if (special.all_day) return false;
 
 const now = new Date();
 const currentMinutes = now.getHours() * 60 + now.getMinutes();
 
 let endMinutes = timeToMinutes(special.end_time);
 if (special.end_time === '00:00') endMinutes = 24 * 60;
 
 return endMinutes < currentMinutes;
}

// Sort bars for a day
function sortBarsBySpecials(bars, dayKey, isToday) {
 const nowMinutes = new Date().getHours() * 60 + new Date().getMinutes();
 return bars.slice().sort((a, b) => {
   const specialsA = a.specials_by_day[dayKey] || [];
   const specialsB = b.specials_by_day[dayKey] || [];
   const getPriority = (specials) => {
     if (specials.length === 0) return { priority: 4, sortTime: 0 };
     const allDay = specials.filter(s => s.all_day);
     const timed = specials.filter(s => !s.all_day);
     if (isToday) {
       const past = timed.filter(s => isSpecialPast(s, true));
       const upcoming = timed.filter(s => !isSpecialPast(s, true));
       if (past.length > 0) return { priority: 1, sortTime: Math.min(...past.map(s => timeToMinutes(s.start_time))) };
       if (upcoming.length > 0) return { priority: 2, sortTime: Math.min(...upcoming.map(s => timeToMinutes(s.start_time))) };
       if (allDay.length > 0) return { priority: 3, sortTime: 0 };
     } else {
       if (timed.length > 0) return { priority: 2, sortTime: Math.min(...timed.map(s => timeToMinutes(s.start_time))) };
       if (allDay.length > 0) return { priority: 3, sortTime: 0 };
     }
     return { priority: 4, sortTime: 0 };
   };
   const aData = getPriority(specialsA);
   const bData = getPriority(specialsB);
   if (aData.priority !== bData.priority) return aData.priority - bData.priority;
   return aData.sortTime - bData.sortTime;
 });
}




function buildSpecialItem(special, { isToday = false, clickable = false, onClick = null } = {}) {
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

  if (!special.all_day && isToday && isSpecialPast(special, true)) {
    timeBadge.classList.add('past');
  }

  if (isToday && isSpecialActive(special)) item.classList.add('live');

  const typeIcon = document.createElement('span');
  typeIcon.className = `type-icon ${special.type || ''}`;
  if (special.type === 'food') typeIcon.setAttribute('data-lucide', 'utensils');
  else if (special.type === 'drink') typeIcon.setAttribute('data-lucide', 'beer');

  const desc = document.createElement('span');
  desc.className = 'special-description';
  desc.textContent = special.description;

  item.appendChild(timeBadge);
  item.appendChild(desc);
  item.appendChild(typeIcon);

  if (isToday && isSpecialActive(special)) {
    const dot = document.createElement('span');
    dot.className = 'active-dot';
    item.appendChild(dot);
  }

  if (clickable && typeof onClick === 'function') {
    item.classList.add('clickable-special');
    item.onclick = onClick;
  }

  return item;
}

// ===== Render Home Screen for next 7 days =====
function renderBarsWeek(bars) {
 const container = document.getElementById('home-bars');
 if (!container) return;

 container.style.opacity = 0;

 const renderContent = () => {
   container.innerHTML = '';
   
   const now = new Date();
   const todayIndex = now.getDay();
   
   for (let offset = 0; offset < 7; offset++) {
     const date = new Date();
     date.setDate(date.getDate() + offset);
     const dayIndex = date.getDay();
     const dayKey = DAYS_FULL[dayIndex].slice(0,3).toUpperCase();
     const dayName = DAYS_FULL[dayIndex];
     const label = offset === 0 ? `${dayName} (Today)` : dayName;
     const isToday = offset === 0;
     const barsWithSpecials = bars.filter(bar => (bar.specials_by_day[dayKey] || []).length > 0);
     
	 // Day header
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
     
	 // Sort bars
     const sortedBars = sortBarsBySpecials(barsWithSpecials, dayKey, isToday);
     
	 // Optional today divider
     let dividerInserted = false;
	 const todayDivider = document.createElement('div');
	 todayDivider.className = 'today-divider'
	 todayDivider.textContent = 'Current + Upcoming Specials';
	 
     sortedBars.forEach(bar => {
       const card = document.createElement('div');
       card.className = 'bar-card';
	   card.onclick = () => showDetail(bar, currentTab);
       
	   if (bar.image_url && bar.image_url !== "null") {
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
			   
       daySpecials.forEach(special => {
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
	   
       // Hours
       const hours = bar.hours_by_day ? bar.hours_by_day[dayKey] : null;
       const hoursDiv = document.createElement('div');
       hoursDiv.className = 'open-hours';
       if (hours) {
         if (offset === 0) { // TODAY
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
	   
	   // Today divider
       if (isToday && !dividerInserted) {
		   const daySpecials = bar.specials_by_day[dayKey] || [];
		   const hasExpiredTimedSpecial = daySpecials.some(s => !s.all_day && isSpecialPast(s, true));
		   const hasAllDaySpecial = daySpecials.some(s => s.all_day);
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

 // Always render immediately. Relying on transitionend can defer painting until
 // unrelated pointer movement in some browsers after navigating back.
 renderContent();
}

// Bars list logic: filter by bar name query, then sort by neighborhood and bar name.
function getSortedFilteredBars(bars) {
  const query = barsSearchQuery.trim().toLowerCase();
  const selectedNeighborhoods = activeFilters.neighborhoods;

  return bars
    .filter(bar => {
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

  // Keep rendering deterministic so the list stays stable as users search.
  const sortedBars = getSortedFilteredBars(bars);

  sortedBars.forEach(bar => {
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

// ===== Detail Screen =====
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

  DAYS_ORDERED.forEach(day => {
    const h = bar.hours_by_day ? bar.hours_by_day[day.slice(0,3).toUpperCase()] : null;
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
  DAYS_ORDERED.forEach(day => {
    const key = day.slice(0,3).toUpperCase();
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
      specials.forEach(special => {
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
      content.style.maxHeight = content.scrollHeight + "px";
	  lucide.createIcons();
    });

    header.onclick = () => {
      const isOpen = content.style.maxHeight && content.style.maxHeight !== "0px";
      if (isOpen) {
        content.style.maxHeight = "0px";
        content.classList.remove('expanded');
        arrow.classList.remove('rotate');
      } else {
        content.style.maxHeight = content.scrollHeight + "px";
        content.classList.add('expanded');
        arrow.classList.add('rotate');
      }
    };
  });
}


function getSpecialId(bar, special, dayLabel = '') {
  const barId = bar.id || bar.name || '';
  const parts = [
    barId,
    special.day || dayLabel || '',
    special.start_time || '',
    special.end_time || '',
    special.description || '',
    special.type || '',
    special.all_day ? 'all_day' : 'timed'
  ];
  return parts.join('|');
}

function isFavoriteSpecial(bar, special, dayLabel = '') {
  const specialId = getSpecialId(bar, special, dayLabel);
  return favorites.some(item => item.id === specialId);
}

function toggleFavoriteSpecial(bar, special, dayLabel = 'Day unavailable') {
  const specialId = getSpecialId(bar, special, dayLabel);
  const existingIndex = favorites.findIndex(item => item.id === specialId);

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

  items.forEach(item => {
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

function showSpecialDetail(bar, special, { previousScreen = 'specials', returnTo = 'specials', dayLabel = '' } = {}) {
  previousScreenState = { type: previousScreen, bar, returnTo };

  document.getElementById('home-screen').style.display = 'none';
  document.getElementById('bars-screen').style.display = 'none';
  document.getElementById('favorites-screen').style.display = 'none';
  document.getElementById('detail-screen').style.display = 'none';
  document.getElementById('special-screen').style.display = 'block';
  setScreenLayout(false);

  const barImage = document.getElementById('special-bar-image');
  barImage.src = (bar.image_url && bar.image_url !== 'null') ? bar.image_url : 'https://placehold.co/640x360?text=Bar';

  const specialCard = document.getElementById('special-card');
  specialCard.innerHTML = '';

  const specialHeader = document.createElement('div');
  specialHeader.className = 'special-card-header-row';

  const barName = document.createElement('div');
  barName.className = 'special-bar-name';
  barName.textContent = bar.name;

  const cardFavoriteButton = createFavoriteButton(bar, special, dayLabel || 'Day unavailable');

  specialHeader.appendChild(barName);
  specialHeader.appendChild(cardFavoriteButton);

  const specialMeta = document.createElement('div');
  specialMeta.className = 'special-meta';

  const specialDay = document.createElement('span');
  specialDay.className = 'special-day-badge';
  specialDay.textContent = dayLabel || 'Day unavailable';
  specialMeta.appendChild(specialDay);

  currentSpecialContext = { bar, special, dayLabel: dayLabel || 'Day unavailable' };

  const specialRow = buildSpecialItem(special);

  specialCard.appendChild(specialHeader);
  specialCard.appendChild(specialMeta);
  specialCard.appendChild(specialRow);

  resetSpecialReportForm();
  updateSpecialFavoriteButton(isFavoriteSpecial(bar, special, dayLabel || 'Day unavailable'));
  lucide.createIcons();
}

function showPreviousScreen() {
  const previousType = previousScreenState?.type || 'specials';

  if (previousType === 'detail') {
    showDetail(previousScreenState.bar, previousScreenState.returnTo || 'specials');
    return;
  }

  document.getElementById('special-screen').style.display = 'none';
  document.getElementById('detail-screen').style.display = 'none';
  showTab(previousType);
  setScreenLayout(true);
}


function resetSpecialReportForm() {
  const form = document.getElementById('special-report-form');
  const reasonSelect = document.getElementById('special-report-reason');
  const commentInput = document.getElementById('special-report-comment');
  if (!form || !reasonSelect) return;

  form.style.display = 'none';
  reasonSelect.value = '';
  if (commentInput) commentInput.value = '';
}

function initSpecialReport() {
  const toggleButton = document.getElementById('special-report-toggle');
  const reportForm = document.getElementById('special-report-form');

  if (!toggleButton || !reportForm) return;

  toggleButton.addEventListener('click', () => {
    const isOpen = reportForm.style.display !== 'none';
    reportForm.style.display = isOpen ? 'none' : 'flex';
  });
}

async function submitSpecialReport(event) {
  event.preventDefault();

  const reasonSelect = document.getElementById('special-report-reason');
  const commentInput = document.getElementById('special-report-comment');
  if (!reasonSelect || !reasonSelect.value || !currentSpecialContext) return;

  const specialId = getSpecialId(
    currentSpecialContext.bar,
    currentSpecialContext.special,
    currentSpecialContext.dayLabel || ''
  );

  const commentText = commentInput?.value.trim() || '';
  const payload = {
    special_id: specialId,
    reason: reasonSelect.value,
    comment: commentText === '' ? null : commentText
  };

  try {
    await fetch(SPECIAL_REPORT_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });
  } catch (err) {
    console.error('Failed to submit special report:', err);
  }

  resetSpecialReportForm();
}

// ===== Navigation =====
function setScreenLayout(isHome) {
  const toolbar = document.querySelector('.home-toolbar');
  const appContainer = document.querySelector('.app-container');

  if (toolbar) toolbar.style.display = isHome ? 'block' : 'none';
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
  const previousTab = currentTab;

  currentTab = tabName;

  if (previousTab !== tabName) {
    resetFilters();
  }

  updateFilterSectionVisibility();

  if (homeScreen) homeScreen.style.display = tabName === 'specials' ? 'flex' : 'none';
  if (barsScreen) barsScreen.style.display = tabName === 'bars' ? 'flex' : 'none';
  if (favoritesScreen) favoritesScreen.style.display = tabName === 'favorites' ? 'flex' : 'none';

  renderCurrentTabData();

  document.querySelectorAll('.taskbar-tab').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tab === tabName);
  });
}

function getSelectedTypesFromFilters() {
  const typeRows = Array.from(document.querySelectorAll('#special-type-filters .filter-row'));
  return typeRows
    .filter(row => row.querySelector('input[type="checkbox"]').checked)
    .map(row => row.querySelector('input[type="checkbox"]').id.replace('Filter', '').toLowerCase());
}

function getSelectedNeighborhoodsFromFilters() {
  const neighborhoodRows = Array.from(document.querySelectorAll('#neighborhood-filters .filter-row'));
  return neighborhoodRows
    .filter(row => row.querySelector('input[type="checkbox"]').checked)
    .map(row => row.querySelector('input[type="checkbox"]').dataset.name);
}

function resetFilterInputs() {
  document.querySelectorAll('#side-menu .filter-row').forEach(row => {
    const checkbox = row.querySelector('input[type="checkbox"]');
    if (!checkbox) return;
    checkbox.checked = false;
    row.classList.remove('selected');
  });
}

function resetFilters() {
  activeFilters.types = [];
  activeFilters.neighborhoods = [];
  resetFilterInputs();
}

function updateFilterSectionVisibility() {
  const typeSection = document.getElementById('special-type-filters');
  if (!typeSection) return;

  const showTypeFilters = currentTab !== 'bars';
  typeSection.style.display = showTypeFilters ? '' : 'none';
}

function getFilteredBarsForSpecials() {
  return barsData.map(bar => {
    const specials_by_day = Object.fromEntries(
      Object.entries(bar.specials_by_day).map(([day, specials]) => [
        day,
        specials.filter(special => {
          const typePass = activeFilters.types.length === 0 || activeFilters.types.includes(special.type);
          const neighborhoodPass = activeFilters.neighborhoods.length === 0 || activeFilters.neighborhoods.includes(bar.neighborhood);
          return typePass && neighborhoodPass;
        })
      ])
    );

    return { ...bar, specials_by_day };
  });
}

function getFilteredFavorites() {
  return favorites.filter(item => {
    const typePass = activeFilters.types.length === 0 || activeFilters.types.includes(item.special.type);
    const neighborhoodPass = activeFilters.neighborhoods.length === 0 || activeFilters.neighborhoods.includes(item.bar.neighborhood);
    return typePass && neighborhoodPass;
  });
}

function renderCurrentTabData() {
  if (currentTab === 'specials') {
    renderBarsWeek(getFilteredBarsForSpecials());
    return;
  }

  if (currentTab === 'bars') {
    renderBarsList(barsData);
    return;
  }

  if (currentTab === 'favorites') {
    renderFavorites(getFilteredFavorites());
  }
}

function initTaskbar() {
  const tabs = document.querySelectorAll('.taskbar-tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      const tabName = tab.dataset.tab;
      document.getElementById('detail-screen').style.display = 'none';
      document.getElementById('special-screen').style.display = 'none';
      showTab(tabName);
      setScreenLayout(true);
    });
  });
}

// Bars search is intentionally scoped to bar names; neighborhood filtering is handled by filters.
function initBarsSearch() {
  const searchInput = document.getElementById('bars-search-input');
  if (!searchInput) return;

  searchInput.addEventListener('input', () => {
    barsSearchQuery = searchInput.value || '';
    renderBarsList(barsData);
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

// ===== Sidebar and Filters Initialization =====
// ===== Initialize Sidebar Filters =====
function initSidebarFilters() {
 const hamburgerButton = document.querySelector('.hamburger-button');
 const sideMenu = document.getElementById('side-menu');
 const menuOverlay = document.getElementById('side-menu-overlay');
 const applyButton = document.getElementById('applyFiltersBtn');
 // ===== Special Type Rows =====
 const typeRows = document.querySelectorAll('#special-type-filters .filter-row');
 typeRows.forEach(row => {
   const checkbox = row.querySelector('input[type="checkbox"]');
   checkbox.checked = false; // default = show all
   row.classList.toggle('selected', checkbox.checked);
   row.addEventListener('click', () => {
     checkbox.checked = !checkbox.checked;
     row.classList.toggle('selected', checkbox.checked);
   });
 });
 // ===== Open / Close Side Menu =====
 hamburgerButton.addEventListener('click', () => {
   sideMenu.classList.add('open');
   menuOverlay.classList.add('active');
   lucide.createIcons();
 });
 menuOverlay.addEventListener('click', () => {
   sideMenu.classList.remove('open');
   menuOverlay.classList.remove('active');
 });
 // ===== Apply Filters Button =====
 applyButton.addEventListener('click', () => {
   activeFilters.types = currentTab === 'bars' ? [] : getSelectedTypesFromFilters();
   activeFilters.neighborhoods = getSelectedNeighborhoodsFromFilters();
   renderCurrentTabData();
   sideMenu.classList.remove('open');
   menuOverlay.classList.remove('active');
 });
}
// ===== Generate Dynamic Neighborhood Filters =====
function generateNeighborhoodFilters() {
 const neighborhoodSection = document.getElementById('neighborhood-filters');
 // Keep the section title; remove only old rows
 const oldRows = neighborhoodSection.querySelectorAll('.filter-row');
 oldRows.forEach(row => row.remove());
 // Unique neighborhoods from barsData
 const neighborhoods = [...new Set(barsData.map(bar => bar.neighborhood).filter(Boolean))].sort((a, b) => 
	a.toLowerCase().localeCompare(b.toLowerCase())
 );
 neighborhoods.forEach(name => {
   const row = document.createElement('div');
   row.className = 'filter-row';
   const checkbox = document.createElement('input');
   checkbox.type = 'checkbox';
   checkbox.dataset.name = name; // store actual neighborhood
checkbox.id = `neigh-${name.replace(/\s+/g, '')}`;
   checkbox.checked = false; // default = show all
   const label = document.createElement('label');
   label.setAttribute('for', checkbox.id);
   label.textContent = name;
   row.appendChild(checkbox);
   row.appendChild(label);
   row.addEventListener('click', () => {
     checkbox.checked = !checkbox.checked;
     row.classList.toggle('selected', checkbox.checked);
   });
   neighborhoodSection.appendChild(row);
 });
}
// ===== Load Bars and Initialize Filters =====
async function loadBars() {
 try {
   const response = await fetch(STARTUP_API_URL);
   const data = await response.json();
   const parsed = typeof data.body === "string" ? JSON.parse(data.body) : data;
   barsData = parsed.bars || [];
   renderCurrentTabData();
   // Generate neighborhoods AFTER barsData is loaded
   generateNeighborhoodFilters();
 } catch (err) {
   console.error('Failed to load bars:', err);
 }
}
// ===== Initialize =====
initSidebarFilters();
initTaskbar();
initBarsSearch();
initHomeScrollCapture();
initSpecialReport();
initSpecialFavoriteButton();
showTab(currentTab);
setScreenLayout(true);
loadBars();
