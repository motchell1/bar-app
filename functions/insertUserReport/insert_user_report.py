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

        special_id = body.get('special_id')
        reason = body.get('reason')
        user_identifier = body.get('user_identifier')
        comment = body.get('comment')
        print("Parsed objects: " + json.dumps({"special_id": special_id, "reason": reason, "user_identifier": user_identifier, "comment": comment}))
        if not special_id or not user_identifier or not reason:
            return {
                "statusCode": 400,
                "body": json.dumps({"error": "Missing required fields"})
            }

        connection = pymysql.connect(
            host=DB_HOST,
            user=DB_USER,
            password=DB_PASSWORD,
            database=DB_NAME,
            cursorclass=pymysql.cursors.DictCursor
        )

        with connection.cursor() as cursor:
            sql = """
                INSERT INTO report (special_id, reason, user_identifier, comment)
                VALUES (%s, %s, %s, %s)
            """
            cursor.execute(sql, (special_id, reason, user_identifier, comment))

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