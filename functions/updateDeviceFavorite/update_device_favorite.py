import json
import os

import pymysql

DB_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']


def parse_event_body(event):
    if not event:
        return {}

    body = event.get('body') if isinstance(event, dict) else None

    if body is None and isinstance(event, dict):
        return event

    if isinstance(body, str):
        return json.loads(body)

    if isinstance(body, dict):
        return body

    return {}


def lambda_handler(event, context):
    try:
        body = parse_event_body(event)

        device_id = body.get('device_id')
        special_id = body.get('special_id')
        bar_id = body.get('bar_id')
        is_favorite = body.get('is_favorite')

        has_special_id = special_id is not None
        has_bar_id = bar_id is not None

        if not device_id or not isinstance(is_favorite, bool) or has_special_id == has_bar_id:
            return {
                'statusCode': 400,
                'body': json.dumps({
                    'error': 'Missing or invalid required fields: device_id, is_favorite (boolean), and exactly one of special_id or bar_id'
                })
            }

        connection = pymysql.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME,
            cursorclass=pymysql.cursors.DictCursor
        )

        with connection.cursor() as cursor:
            if has_special_id:
                if is_favorite:
                    cursor.execute(
                        """
                        INSERT INTO device_special_favorite (device_id, special_id)
                        VALUES (%s, %s)
                        ON DUPLICATE KEY UPDATE device_id = VALUES(device_id)
                        """,
                        (device_id, special_id)
                    )
                    message = 'Special favorite added'
                else:
                    cursor.execute(
                        """
                        DELETE FROM device_special_favorite
                        WHERE device_id = %s AND special_id = %s
                        """,
                        (device_id, special_id)
                    )
                    message = 'Special favorite removed'
            else:
                if is_favorite:
                    cursor.execute(
                        """
                        INSERT INTO device_bar_favorite (device_id, bar_id)
                        VALUES (%s, %s)
                        ON DUPLICATE KEY UPDATE device_id = VALUES(device_id)
                        """,
                        (device_id, bar_id)
                    )
                    message = 'Bar favorite added'
                else:
                    cursor.execute(
                        """
                        DELETE FROM device_bar_favorite
                        WHERE device_id = %s AND bar_id = %s
                        """,
                        (device_id, bar_id)
                    )
                    message = 'Bar favorite removed'

        connection.commit()
        connection.close()

        return {
            'statusCode': 200,
            'body': json.dumps({'message': message})
        }
    except Exception as error:
        return {
            'statusCode': 500,
            'body': json.dumps({'error': str(error)})
        }
