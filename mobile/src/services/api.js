const API_BASE_URL = 'https://api.example.com';

async function apiRequest(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Request failed (${response.status})`);
  }

  return response.json();
}

export const barApi = {
  getHomeFeed: () => apiRequest('/home'),
  getBars: () => apiRequest('/bars'),
  getFavorites: (deviceId) =>
    apiRequest(`/favorites?deviceId=${encodeURIComponent(deviceId)}`),
};
