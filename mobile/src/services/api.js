const API_BASE_URL = 'https://api.example.com';

async function request(path, options = {}) {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    ...options,
  });

  if (!response.ok) {
    throw new Error(`Request failed with status ${response.status}`);
  }

  return response.json();
}

export const api = {
  getSpecials: () => request('/specials'),
  getBars: () => request('/bars'),
  getFavorites: () => request('/favorites'),
};
