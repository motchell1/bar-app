import json
import os
import pymysql

DB_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']


def lambda_handler(event, context):
    try:
        body = json.loads(event['body'])
        print(body)

        report_type = (body.get('report_type') or '').strip().lower()
        bar_id = body.get('bar_id')
        special_id = body.get('special_id')
        reason = body.get('reason')
        user_identifier = body.get('user_identifier')
        comment = body.get('comment')
        print("Parsed objects: " + json.dumps({
            "report_type": report_type,
            "bar_id": bar_id,
            "special_id": special_id,
            "reason": reason,
            "user_identifier": user_identifier,
            "comment": comment
        }))

        if report_type not in ('special', 'bar'):
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Invalid report_type. Expected 'special' or 'bar'."})
            }

        if not user_identifier or not reason:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Missing required fields: reason and user_identifier"})
            }

        if not bar_id:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Missing required field: bar_id"})
            }

        if report_type == 'special' and not special_id:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Missing required field: special_id for special reports"})
            }

        if report_type == 'bar':
            special_id = None

        connection = pymysql.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME,
            cursorclass=pymysql.cursors.DictCursor
        )

        with connection.cursor() as cursor:
            sql = """
                INSERT INTO report (report_type, bar_id, special_id, reason, comment, user_identifier)
                VALUES (%s, %s, %s, %s, %s, %s)
            """
            cursor.execute(sql, (report_type, bar_id, special_id, reason, comment, user_identifier))

        connection.commit()
        connection.close()

        return {
            "statusCode": 200,
            "body": json.dumps({"message": "Report submitted"})
        }

    except Exception as e:
        return {
            "statusCode": 500,
            "body": json.dumps({"error": str(e)})
        }
