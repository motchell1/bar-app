const API_BASE_URL = 'https://api.example.com';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API error: ${response.status}`);
  }

  return response.json();
}

export function fetchHomeFeed() {
  return request('/home');
}

export function fetchBars() {
  return request('/bars');
}

export function fetchFavorites(deviceId) {
  return request(`/favorites?deviceId=${encodeURIComponent(deviceId)}`);
}
