import Constants from 'expo-constants';

export const API_BASE_URL = process.env.EXPO_PUBLIC_API_URL ?? 'https://example.com/api';

export const STARTUP_API_URL = process.env.EXPO_PUBLIC_STARTUP_API_URL
  ?? 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/getStartupData';

export const SPECIAL_REPORT_API_URL = process.env.EXPO_PUBLIC_SPECIAL_REPORT_API_URL
  ?? 'https://qz5rs9i9ya.execute-api.us-east-2.amazonaws.com/default/insertUserReport';

const googleMapsMobileApiKey = Constants.expoConfig?.extra?.GOOGLE_MAPS_MOBILE_API_KEY;

if (!googleMapsMobileApiKey) {
  throw new Error('Missing required environment variable: GOOGLE_MAPS_MOBILE_API_KEY');
}

export const GOOGLE_MAPS_MOBILE_API_KEY = googleMapsMobileApiKey;
