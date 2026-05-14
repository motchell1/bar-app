import { API_BASE_URL, STARTUP_API_URL } from './config';

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

export type StartupPayload = {
  general_data?: { current_day?: string };
  bars?: Record<string, {
    bar_id?: number;
    name: string;
    neighborhood: string;
    image_url?: string | null;
    is_open_now?: boolean;
    currently_open?: boolean;
    favorite?: boolean;
  }>;
  specials?: Record<string, {
    bar_id: number;
    day: string;
    description: string;
    special_type?: string;
    type?: string;
    all_day?: boolean;
    start_time?: string | null;
    end_time?: string | null;
    current_status?: string;
  }>;
  specials_by_day?: Record<string, Array<{ bar_id: number; specials: number[] }>>;
  open_hours?: Record<string, Record<string, {
    display_text?: string;
    open_time?: string | null;
    close_time?: string | null;
  }>>;
};

export async function fetchBars() {
  return getJson<BarSummary[]>('/bars');
}


let startupPayloadCache: StartupPayload | null = null;
let startupPayloadPromise: Promise<StartupPayload | null> | null = null;
let startupPayloadCacheDeviceId: string | undefined;

function buildStartupUrl(deviceId?: string) {
  const base = API_BASE_URL.endsWith('/') ? API_BASE_URL : `${API_BASE_URL}/`;
  const url = new URL(STARTUP_API_URL, base);
  if (deviceId) {
    url.searchParams.set('device_id', deviceId);
  }
  return url.toString();
}

export async function fetchStartupPayload(deviceId?: string, options?: { forceRefresh?: boolean }): Promise<StartupPayload | null> {
  const normalizedDeviceId = deviceId ? String(deviceId) : undefined;

  if (options?.forceRefresh !== true) {
    if (startupPayloadCache && startupPayloadCacheDeviceId === normalizedDeviceId) {
      return startupPayloadCache;
    }
    if (startupPayloadPromise && startupPayloadCacheDeviceId === normalizedDeviceId) {
      return startupPayloadPromise;
    }
  }

  startupPayloadCacheDeviceId = normalizedDeviceId;
  startupPayloadPromise = (async () => {
    const response = await fetch(buildStartupUrl(deviceId));
    if (!response.ok) {
      throw new Error(`Startup request failed: ${response.status}`);
    }

    const data = await response.json();
    const parsed = typeof data?.body === 'string' ? JSON.parse(data.body) : data;
    startupPayloadCache = parsed?.startup_payload ?? null;
    return startupPayloadCache;
  })();

  try {
    return await startupPayloadPromise;
  } finally {
    startupPayloadPromise = null;
  }
}
