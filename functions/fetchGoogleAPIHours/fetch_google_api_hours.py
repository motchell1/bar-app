import os
import json
import requests

GOOGLE_API_KEY = os.environ['GOOGLE_API_KEY']

DAY_MAP = {
    0: 'SUN',
    1: 'MON',
    2: 'TUE',
    3: 'WED',
    4: 'THU',
    5: 'FRI',
    6: 'SAT'
}

ALL_DAYS = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT']

# Google Places API helper
def fetch_place_open_hours(place_id):
    url = f'https://maps.googleapis.com/maps/api/place/details/json?place_id={place_id}&fields=opening_hours,business_status&key={GOOGLE_API_KEY}'
    response = requests.get(url, timeout=5)
    if response.status_code != 200:
        print(f"Error fetching place {place_id}: {response.text}")
        return None

    data = response.json()
    result = data.get('result', {})
    return {
        'business_status': result.get('business_status'),
        'periods': result.get('opening_hours', {}).get('periods', [])
    }

# Lambda function handler
def lambda_handler(event, context):
    
    input_bars = event.get('bars', [])

    result = []

    for bar in input_bars:
        bar_id = bar['bar_id']
        place_id = bar['google_place_id']

        place_details = fetch_place_open_hours(place_id) or {}
        periods = place_details.get('periods', [])
        business_status = place_details.get('business_status')

        # Initialize all days as CLOSED
        hours_map = {day: "CLOSED" for day in ALL_DAYS}

        # Overwrite open days from Google
        for period in periods:
            open_day = DAY_MAP[period['open']['day']]
            open_time = period['open']['time']
            close_time = period.get('close', {}).get('time')

            open_time = f"{open_time[:2]}:{open_time[2:]}:00"
            close_time = f"{close_time[:2]}:{close_time[2:]}:00" if close_time else None

            hours_map[open_day] = [open_time, close_time]

        result.append({
            'bar_id': bar_id,
            'hours': hours_map,
            'business_status': business_status
        })
    
    return {
        'statusCode': 200,
        'body': json.dumps({'bars': result})
    }