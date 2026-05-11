const API_BASE_URL = 'https://example.com/api';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    const message = `API request failed (${response.status})`;
    throw new Error(message);
  }

  return response.json();
}

export function fetchStartupData() {
  return request('/startup');
}

export function fetchBars(params = {}) {
  const query = new URLSearchParams(params).toString();
  const suffix = query ? `?${query}` : '';
  return request(`/bars${suffix}`);
}

export function toggleFavoriteBar(payload) {
  return request('/favorites/toggle', {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}
