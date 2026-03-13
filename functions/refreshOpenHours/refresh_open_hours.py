import os
import json
import pymysql
import boto3

RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']
GOOGLE_API_FUNCTION_NAME = os.environ['GOOGLE_API_FUNCTION_NAME']

lambda_client = boto3.client('lambda')

# DB connection helper
def get_connection():
    return pymysql.connect(host=RDS_HOST, user=DB_USER, passwd=DB_PASSWORD, db=DB_NAME, cursorclass=pymysql.cursors.DictCursor)

# Lambda handler
def lambda_handler(event, context):
    # Get all bars from db with their google place id
    print("Started!")
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            cursor.execute("SELECT bar_id, google_place_id FROM bar")
            bars = cursor.fetchall()
    finally:
        conn.close()

    if not bars:
        return {
            'statusCode': 400,
            'body': json.dumps('No bars found in database!')
        }
    print(f"Found bars: {json.dumps({'bars': bars})}")
    
    # Invoke Google Places API function
    try:
        response = lambda_client.invoke(
            FunctionName=GOOGLE_API_FUNCTION_NAME,
            InvocationType='RequestResponse',
            Payload=json.dumps({'bars': bars})
        )
        payload_bytes = response['Payload'].read()
        google_result = json.loads(payload_bytes)
        google_bars = json.loads(google_result.get('body', '{}')).get('bars', [])
        print(f"google_bars: {google_bars}")
    except Exception as e:
        print(f"Failed to call Google API function: {e}")
        google_bars = []

    

    if not google_bars:
        return {
            'statusCode': 400,
            'body': json.dumps('Google API function returned no data!')
        }
        
    # Update open_hours table for each bar
    conn = get_connection()
    try:
        with conn.cursor() as cursor:
            for bar in google_bars:
                bar_id = bar['bar_id']
                hours = bar['hours']

                for day, value in hours.items():
                    if value == "CLOSED":
                        open_time = None
                        close_time = None
                        is_closed = 'Y'
                    else:
                        open_time, close_time = value
                        is_closed = 'N'

                    cursor.execute("""
                        INSERT INTO open_hours (bar_id, day_of_week, open_time, close_time, is_closed) 
                        VALUES (%s, %s, %s, %s, %s)
                        ON DUPLICATE KEY UPDATE
                            open_time = VALUES(open_time), 
                            close_time = VALUES(close_time),
                            is_closed = VALUES(is_closed),
                            update_date = NOW();
                    """, (bar_id, day, open_time, close_time, is_closed)
                    )

        conn.commit()
    finally: 
        conn.close()

    return {
        'statusCode': 200,
        'body': json.dumps(f'Updated {len(bars)} bars open hours!')
    }
    
