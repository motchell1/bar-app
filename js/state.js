let barsData = [];
let startupPayload = null;
let barDetailsById = {};
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let currentTab = 'specials';
let barsSearchQuery = '';
let previousScreenState = null;
let currentSpecialContext = null;
let currentBarContext = null;
let isInitialDataLoading = true;
let mapSelectedDayKey = null;
const activeFilters = {
  types: [],
  neighborhoods: [],
  favoritesOnly: false
};

let userIdentifier = localStorage.getItem('userIdentifier');
if (!userIdentifier) {
  userIdentifier = Math.random().toString(26).substring(2, 10);
  localStorage.setItem('userIdentifier', userIdentifier);
}

let deviceId = localStorage.getItem('deviceId');
if (!deviceId) {
  deviceId = Math.random().toString(26).substring(2, 14);
  localStorage.setItem('deviceId', deviceId);
}
