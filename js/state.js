let barsData = [];
const DAYS_FULL = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
let currentTab = 'specials';
let barsSearchQuery = '';
let previousScreenState = null;
let favorites = [];
let currentSpecialContext = null;
let isInitialDataLoading = true;
const activeFilters = {
  types: [],
  neighborhoods: []
};

let userIdentifier = localStorage.getItem('userIdentifier');
if (!userIdentifier) {
  userIdentifier = Math.random().toString(26).substring(2, 10);
  localStorage.setItem('userIdentifier', userIdentifier);
}
