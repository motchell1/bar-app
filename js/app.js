// ===== Utilities =====
function format12Hour(timeStr) {
  if (!timeStr) return '';
  const [hourStr, minuteStr] = timeStr.split(':');
  let hour = parseInt(hourStr, 10);
  const minute = parseInt(minuteStr, 10);
  const ampm = hour >= 12 ? 'PM' : 'AM';
  hour = hour % 12;
  if (hour === 0) hour = 12;
  return minute === 0 ? `${hour} ${ampm}` : `${hour}:${minuteStr} ${ampm}`;
}

function formatSpecialTime(startTime, endTime) {
  if (!startTime || !endTime) return '';
  const [sHourStr, sMinStr] = startTime.split(':');
  const [eHourStr, eMinStr] = endTime.split(':');
  let sHour = parseInt(sHourStr, 10);
  const sMin = sMinStr;
  let eHour = parseInt(eHourStr, 10);
  const eMin = eMinStr;
  const sAMPM = sHour >= 12 ? 'PM' : 'AM';
  const eAMPM = eHour >= 12 ? 'PM' : 'AM';
  sHour = sHour % 12 || 12;
  eHour = eHour % 12 || 12;
  const sStr = sMin === '00' ? `${sHour}` : `${sHour}:${sMin}`;
  const eStr = eMin === '00' ? `${eHour}` : `${eHour}:${eMin}`;
  return sAMPM === eAMPM ? `${sStr} – ${eStr} ${eAMPM}` : `${sStr} ${sAMPM} – ${eStr} ${eAMPM}`;
}

// ===== Global State =====
let barsData = [];
let selectedDayIndex = new Date().getDay();
const DAYS = ['SUN','MON','TUE','WED','THU','FRI','SAT'];

// ===== Render Home Screen =====
function renderBars(bars) {
  const container = document.getElementById('home-screen');
  container.innerHTML = '';

  // --- Toolbar ---
  const toolbar = document.createElement('div');
  toolbar.className = 'home-toolbar';

  const prevBtn = document.createElement('button');
  prevBtn.className = 'day-arrow';
  prevBtn.textContent = '←';

  const nextBtn = document.createElement('button');
  nextBtn.className = 'day-arrow';
  nextBtn.textContent = '→';

  const dayLabel = document.createElement('div');
  dayLabel.className = 'current-day';
  dayLabel.id = 'current-day-label';
  dayLabel.textContent = DAYS[selectedDayIndex];

  toolbar.appendChild(prevBtn);
  toolbar.appendChild(dayLabel);
  toolbar.appendChild(nextBtn);
  container.appendChild(toolbar);

  prevBtn.onclick = () => {
    selectedDayIndex = (selectedDayIndex + 6) % 7;
    renderBarsWithSelectedDay();
  };
  nextBtn.onclick = () => {
    selectedDayIndex = (selectedDayIndex + 1) % 7;
    renderBarsWithSelectedDay();
  };

  // --- Bars ---
  const today = DAYS[selectedDayIndex];
  bars.forEach(bar => {
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
    const todaySpecials = (bar.specials_by_day && bar.specials_by_day[today]) || [];
    todaySpecials.forEach(special => {
      const li = document.createElement('li');
      li.className = 'special-item';
      const badge = document.createElement('span');
      badge.className = 'time-badge';
      badge.textContent = special.all_day ? 'ALL DAY' : formatSpecialTime(special.start_time, special.end_time);
      const desc = document.createElement('span');
      desc.className = 'special-description';
      desc.textContent = special.description;
      li.appendChild(badge);
      li.appendChild(desc);
      specialsList.appendChild(li);
    });
    content.appendChild(specialsList);

    const hours = bar.hours_by_day ? bar.hours_by_day[today] : null;
    const hoursDiv = document.createElement('div');
    hoursDiv.className = 'open-hours';
    if (hours) {
      hoursDiv.textContent = hours.closed ? 'Closed Today' : `Open: ${format12Hour(hours.open_time)} – ${format12Hour(hours.close_time)}`;
    }
    content.appendChild(hoursDiv);

    card.appendChild(content);
    container.appendChild(card);
  });
}

// ===== Helper to re-render with selected day =====
function renderBarsWithSelectedDay() {
  document.getElementById('current-day-label').textContent = DAYS[selectedDayIndex];
  renderBars(barsData);
}

// ===== Detail Screen =====
function showDetail(bar) {
  document.getElementById('home-screen').style.display = 'none';
  document.getElementById('detail-screen').style.display = 'block';

  document.getElementById('detail-image').src = bar.image_url || '';
  document.getElementById('detail-name').textContent = bar.name.toUpperCase();

  const hoursEl = document.getElementById('detail-hours');
  hoursEl.innerHTML = '';

  const DAYS_FULL = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];
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

  // Collapsible specials by day
  const specialsContainer = document.getElementById('detail-specials');
  specialsContainer.innerHTML = '';

  DAYS_FULL.forEach(day => {
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
        badge.textContent = special.all_day ? 'ALL DAY' : formatSpecialTime(special.start_time, special.end_time);

        const desc = document.createElement('span');
        desc.className = 'special-description';
        desc.textContent = special.description;

        div.appendChild(badge);
        div.appendChild(desc);
        content.appendChild(div);
      });
    } else {
      const noSpecials = document.createElement('div');
      noSpecials.className = 'special-item';
      noSpecials.textContent = 'No specials today.';
      content.appendChild(noSpecials);
    }

    wrapper.appendChild(header);
    wrapper.appendChild(content);
    specialsContainer.appendChild(wrapper);

    requestAnimationFrame(() => {
      content.style.maxHeight = content.scrollHeight + "px";
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
function showHome() {
  document.getElementById('home-screen').style.display = 'flex';
  document.getElementById('detail-screen').style.display = 'none';
}

// ===== Load Bars =====
async function loadBars() {
  try {
    const response = await fetch('https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/getStartupData');
    const data = await response.json();
    barsData = typeof data.body === "string" ? JSON.parse(data.body) : data;
    renderBarsWithSelectedDay();
  } catch (err) {
    console.error('Failed to load bars:', err);
  }
}

loadBars();
