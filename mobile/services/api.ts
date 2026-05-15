import { API_BASE_URL, SPECIAL_REPORT_API_URL, STARTUP_API_URL } from './config';
import Constants from 'expo-constants';

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
    favorite?: boolean;
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

export async function submitSpecialReport(payload: {
  bar_id: number | string | null;
  special_id: number | string | null;
  reason: string;
  comment?: string | null;
  user_identifier?: string | null;
}) {
  const response = await fetch(SPECIAL_REPORT_API_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: JSON.stringify({
      report_type: 'special',
      bar_id: payload.bar_id,
      special_id: payload.special_id,
      reason: payload.reason,
      comment: payload.comment ?? null,
      user_identifier: payload.user_identifier ?? null,
    }),
  });
  return response;
}


let startupPayloadCache: StartupPayload | null = null;
let startupPayloadPromise: Promise<StartupPayload | null> | null = null;
let startupPayloadCacheDeviceId: string | undefined;
let userIdentifierCache: string | null = null;

export async function getUserIdentifier(): Promise<string> {
  if (userIdentifierCache) return userIdentifierCache;
  const runtimeSessionId = Constants.sessionId ? String(Constants.sessionId) : '';
  userIdentifierCache = runtimeSessionId || `mobile-${Math.random().toString(36).slice(2, 14)}`;
  return userIdentifierCache;
}

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
