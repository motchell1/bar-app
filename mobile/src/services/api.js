const API_BASE_URL = 'https://example.com/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {})
    },
    ...options
  });

  if (!response.ok) {
    throw new Error(`API request failed with status ${response.status}`);
  }

  return response.json();
}

export const api = {
  getHomeSpecials: () => request('/specials'),
  getBars: () => request('/bars'),
  getFavorites: () => request('/favorites'),
  getMapPoints: () => request('/map-points')
};
