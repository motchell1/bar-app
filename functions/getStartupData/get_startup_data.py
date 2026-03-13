import pymysql
import json
import os

# Environment variables
RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']

# Database connection helper
def get_connection():
    return pymysql.connect(host=RDS_HOST, user=DB_USER, passwd=DB_PASSWORD, db=DB_NAME, connect_timeout=5)

# Query helpers
def query_bars(cursor):
    cursor.execute("SELECT bar_id, name, address, neighborhood, image_url FROM bar")
    return cursor.fetchall()

def query_open_hours(cursor):
    cursor.execute("SELECT * FROM open_hours")
    return cursor.fetchall()

def query_specials(cursor): 
    cursor.execute("SELECT special_id, bar_id, day_of_week, all_day, start_time, end_time, description, type FROM special where is_active = 'Y'")
    return cursor.fetchall()

#Payload builder
def build_startup_payload():
    conn = get_connection()
    try:
        with conn.cursor(pymysql.cursors.DictCursor) as cursor:
            bars = query_bars(cursor)
            hours = query_open_hours(cursor)
            specials = query_specials(cursor)


        # Build hours_by_day map
        hours_map = {}
        for h in hours:
            bar_id = h['bar_id']
            if bar_id not in hours_map:
                hours_map[bar_id] = {}
            hours_map[bar_id][h['day_of_week']] = {
                'open_time': str(h['open_time']) if h['open_time'] is not None else None,
                'close_time': str(h['close_time']) if h['close_time'] is not None else None,
                'closed': h['is_closed'] == 'Y'
            }
        
        # Build specials map
        specials_map = {}
        for s in specials:
            bar_id = s['bar_id']
            if bar_id not in specials_map:
                specials_map[bar_id] = {}
            day = s['day_of_week']
            if day not in specials_map[bar_id]:
                specials_map[bar_id][day] = []
            specials_map[bar_id][day].append({
                'special_id': s['special_id'],
                'all_day': s['all_day'] == 'Y',
                'start_time': str(s['start_time']) if s['start_time'] is not None else None,
                'end_time': str(s['end_time']) if s['end_time'] is not None else None,
                'description': s['description'],
                'type': s['type']
            })
        
        # Merge everything per bar
        payload = []
        for bar in bars:
            bar_id = bar['bar_id']
            payload.append({
                'bar_id': bar['bar_id'],
                'name': bar['name'],
                'address': bar['address'],
                'neighborhood': bar['neighborhood'],
                'image_url': bar['image_url'],
                'hours_by_day': hours_map.get(bar_id, {}),
                'specials_by_day': specials_map.get(bar_id, {})
            }) 
        
        return payload
    finally:
        conn.close()

# lambda handler
def lambda_handler(event, context):
    payload = build_startup_payload()
    return {
        'statusCode': 200,
        'body': json.dumps({'bars': payload})
    }