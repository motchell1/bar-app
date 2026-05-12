const API_BASE_URL = process.env.EXPO_PUBLIC_API_BASE_URL || '';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return response.json();
}

export const api = {
  getSpecials: () => request('/.netlify/functions/specials'),
  getBars: () => request('/.netlify/functions/bars'),
  getFavorites: () => request('/.netlify/functions/favorites'),
};
