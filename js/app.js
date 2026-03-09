// ===== Utilities =====
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



// ===== Render Home Screen for next 7 days =====
function renderBarsWeek(bars) {
 const container = document.getElementById('home-bars');
 container.style.opacity = 0;
 container.addEventListener('transitionend', function handler() {
   container.removeEventListener('transitionend', handler);
   container.innerHTML = '';
   
   const now = new Date();
   const todayIndex = now.getDay();
   
   for (let offset = 0; offset < 7; offset++) {
     const date = new Date();
     date.setDate(date.getDate() + offset);
     const dayIndex = date.getDay();
     const dayKey = DAYS_FULL[dayIndex].slice(0,3).toUpperCase();
     const formatted = date.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
     const label = offset === 0 ? `Today – ${formatted}` : `${DAYS_FULL[dayIndex]} – ${formatted}`;
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
	   card.onclick = () => showDetail(bar);
       
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
         const li = document.createElement('li');
         li.className = 'special-item';
		 
         // Time badge
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
         if (isToday && isSpecialActive(special)) li.classList.add('live');
		 
         // Type icon
         const typeIcon = document.createElement('span');
         typeIcon.className = `type-icon ${special.type || ''}`;
         if (special.type === 'food') typeIcon.setAttribute("data-lucide", "utensils");
         else if (special.type === 'drink') typeIcon.setAttribute("data-lucide", "beer");
		 
         const desc = document.createElement('span');
         desc.className = 'special-description';
         desc.textContent = special.description;
		 
         li.appendChild(timeBadge);
         li.appendChild(desc);
         li.appendChild(typeIcon);
		 
         if (isToday && isSpecialActive(special)) {
           const dot = document.createElement('span');
           dot.className = 'active-dot';
           li.appendChild(dot);
         }
		 
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
 });
}

// ===== Detail Screen =====
function showDetail(bar) {
  document.getElementById('home-screen').style.display = 'none';
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
  		const div = document.createElement('div');
		div.className = 'special-item';

		const badge = document.createElement('span');
		badge.className = 'time-badge';
		if (special.all_day) {
			  badge.textContent = 'ALL DAY';
		} else {
			const startFormatted = format12Hour(special.start_time);
			const endFormatted = format12Hour(special.end_time);
			badge.innerHTML = `${startFormatted}<br>${endFormatted}`;
		}
		
		const icon = document.createElement('span');
		icon.className = 'type-icon';
		if (special.type === 'food') icon.setAttribute("data-lucide", "utensils");
		else if (special.type === 'drink') icon.setAttribute("data-lucide", "beer");


		const desc = document.createElement('span');
		desc.className = 'special-description';
		desc.textContent = special.description;

		// Append badge and description first
		div.appendChild(badge);
		div.appendChild(desc);
		div.appendChild(icon)

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

// ===== Navigation =====
function setScreenLayout(isHome) {
  const toolbar = document.querySelector('.home-toolbar');
  const appContainer = document.querySelector('.app-container');

  if (toolbar) toolbar.style.display = isHome ? 'block' : 'none';
  if (appContainer) appContainer.classList.toggle('detail-mode', !isHome);
}

function showHome() {
  document.getElementById('home-screen').style.display = 'flex';
  document.getElementById('detail-screen').style.display = 'none';
  setScreenLayout(true);
}

function initHomeScrollCapture() {
  document.addEventListener('wheel', (event) => {
    const homeScreen = document.getElementById('home-screen');
    const detailScreen = document.getElementById('detail-screen');
    const appContainer = document.querySelector('.app-container');

    if (!homeScreen || !detailScreen || !appContainer) return;
    if (homeScreen.style.display === 'none' || detailScreen.style.display !== 'none') return;

    if (appContainer.contains(event.target)) return;

    const maxScroll = homeScreen.scrollHeight - homeScreen.clientHeight;
    if (maxScroll <= 0) return;

    const nextScrollTop = Math.max(0, Math.min(maxScroll, homeScreen.scrollTop + event.deltaY));
    if (nextScrollTop === homeScreen.scrollTop) return;

    homeScreen.scrollTop = nextScrollTop;
    event.preventDefault();
  }, { passive: false });
}

function initHomeScrollCapture() {
  document.addEventListener('wheel', (event) => {
    const homeScreen = document.getElementById('home-screen');
    const detailScreen = document.getElementById('detail-screen');
    const appContainer = document.querySelector('.app-container');

    if (!homeScreen || !detailScreen || !appContainer) return;
    if (homeScreen.style.display === 'none' || detailScreen.style.display !== 'none') return;

    if (appContainer.contains(event.target)) return;

    const maxScroll = homeScreen.scrollHeight - homeScreen.clientHeight;
    if (maxScroll <= 0) return;

    const nextScrollTop = Math.max(0, Math.min(maxScroll, homeScreen.scrollTop + event.deltaY));
    if (nextScrollTop === homeScreen.scrollTop) return;

    homeScreen.scrollTop = nextScrollTop;
    event.preventDefault();
  }, { passive: false });
}


// ===== Sidebar and Filters Initialization =====
function initSidebarFilters() {
 const hamburgerButton = document.querySelector('.hamburger-button');
 const sideMenu = document.getElementById('side-menu');
 const menuOverlay = document.getElementById('side-menu-overlay');
 const applyButton = document.getElementById('applyFiltersBtn');

 // ===== Special Type Rows =====
 const typeRows = document.querySelectorAll('.filter-section:nth-child(1) .filter-row');
 typeRows.forEach(row => {
   const checkbox = row.querySelector('input[type="checkbox"]');
   checkbox.checked = false;
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
   const selectedTypes = Array.from(typeRows)
     .filter(r => r.querySelector('input[type="checkbox"]').checked)
     .map(r => r.querySelector('input[type="checkbox"]').id.replace('Filter', '').toLowerCase());

   const neighborhoodRows = Array.from(document.getElementById('neighborhood-filters').querySelectorAll('.filter-row'));
   const selectedNeighborhoods = neighborhoodRows
     .filter(r => r.querySelector('input[type="checkbox"]').checked)
     .map(r => r.querySelector('input[type="checkbox"]').dataset.name);

   const filteredBars = barsData.map(bar => {
     const specials_by_day = Object.fromEntries(
       Object.entries(bar.specials_by_day).map(([day, specials]) => [
         day,
         specials.filter(s => {
           const typePass = selectedTypes.length === 0 || selectedTypes.includes(s.type);
           const neighPass = selectedNeighborhoods.length === 0 || selectedNeighborhoods.includes(bar.neighborhood);
           return typePass && neighPass;
         })
       ])
     );
     return { ...bar, specials_by_day };
   });

   renderBarsWeek(filteredBars);
   sideMenu.classList.remove('open');
   menuOverlay.classList.remove('active');
 });
}

function generateNeighborhoodFilters() {
 const neighborhoodSection = document.getElementById('neighborhood-filters');
 neighborhoodSection.querySelectorAll('.filter-row').forEach(row => row.remove());

 const neighborhoods = [...new Set(barsData.map(bar => bar.neighborhood).filter(Boolean))]
   .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

 neighborhoods.forEach(name => {
   const row = document.createElement('div');
   row.className = 'filter-row';

   const checkbox = document.createElement('input');
   checkbox.type = 'checkbox';
   checkbox.dataset.name = name;
   checkbox.id = `neigh-${name.replace(/\s+/g, '')}`;
   checkbox.checked = false;

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

// ===== Load Bars =====
async function loadBars() {
 try {
   const response = await fetch('https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/getStartupData');
   const data = await response.json();
   const parsed = typeof data.body === "string" ? JSON.parse(data.body) : data;
   barsData = parsed.bars || [];
   renderBarsWeek(barsData);
   // Generate neighborhoods AFTER barsData is loaded
   generateNeighborhoodFilters();
 } catch (err) {
   console.error('Failed to load bars:', err);
 }
}
// ===== Initialize =====
initSidebarFilters();
initHomeScrollCapture();
setScreenLayout(true);
loadBars();
