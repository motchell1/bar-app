const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://example.com/api';

async function getJson<T>(path: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`);

  if (!response.ok) {
    throw new Error(`API request failed: ${response.status}`);
  }

  return (await response.json()) as T;
}

export type BarSummary = {
  id: string;
  name: string;
  neighborhood: string;
};

export async function fetchBars() {
  return getJson<BarSummary[]>('/bars');
}
