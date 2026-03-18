import csv
import io
import json
import os
from datetime import datetime

import boto3
import pymysql

RDS_HOST = os.environ['RDS_HOST']
DB_USER = os.environ['DB_USER']
DB_PASSWORD = os.environ['DB_PASSWORD']
DB_NAME = os.environ['DB_NAME']
S3_BUCKET = os.environ['S3_BUCKET']
S3_DATA_FOLDER = os.environ['S3_DATA_FOLDER']

ALLOWED_TABLES = {'bar', 'special', 'open_hours'}
ALLOWED_TRANSACTION_TYPES = {'I', 'IU', 'D'}

s3_client = boto3.client('s3')


# DB connection helper

def get_connection():
    return pymysql.connect(
        host=RDS_HOST,
        user=DB_USER,
        passwd=DB_PASSWORD,
        db=DB_NAME,
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False
    )


def parse_csv_from_s3(bucket, key):
    response = s3_client.get_object(Bucket=bucket, Key=key)
    csv_content = response['Body'].read().decode('utf-8-sig')
    rows = list(csv.reader(io.StringIO(csv_content)))

    if len(rows) < 3:
        raise ValueError('CSV must include table row, transaction row, and header row.')

    table_row = rows[0]
    if not table_row:
        raise ValueError('Row 1 must include table name.')

    table_name = table_row[0].strip()
    if not table_name:
        raise ValueError('Row 1 table name cannot be empty.')

    transaction_row = rows[1]
    if not transaction_row:
        raise ValueError('Row 2 must include transaction type.')

    transaction_type = transaction_row[0].strip().upper()
    if not transaction_type:
        raise ValueError('Row 2 transaction type cannot be empty.')

    headers = [header.strip() for header in rows[2] if header is not None]
    if not headers or all(not header for header in headers):
        raise ValueError('Row 3 header row is required and cannot be empty.')

    clean_headers = [header for header in headers if header]
    if len(clean_headers) != len(headers):
        raise ValueError('Header row contains empty column names.')

    data_rows = []
    for row_number, row in enumerate(rows[3:], start=4):
        if not row or all(not str(value).strip() for value in row):
            continue

        normalized_row = [value.strip() if isinstance(value, str) else value for value in row]
        row_error = None
        if len(normalized_row) != len(clean_headers):
            row_error = (
                f'Row {row_number}: malformed CSV data row. Expected {len(clean_headers)} columns '
                f'but found {len(normalized_row)}.'
            )

        data_rows.append({
            'row_number': row_number,
            'values': normalized_row,
            'error': row_error
        })

    return table_name, transaction_type, clean_headers, data_rows


def build_insert_sql(table_name, columns):
    placeholders = ', '.join(['%s'] * len(columns))
    column_sql = ', '.join(columns)
    return f'INSERT INTO {table_name} ({column_sql}) VALUES ({placeholders})'


def build_insert_ignore_sql(table_name, columns):
    placeholders = ', '.join(['%s'] * len(columns))
    column_sql = ', '.join(columns)
    return f'INSERT IGNORE INTO {table_name} ({column_sql}) VALUES ({placeholders})'


def build_upsert_sql(table_name, columns):
    insert_sql = build_insert_sql(table_name, columns)
    update_clause = ', '.join([f'{column} = VALUES({column})' for column in columns])
    return f'{insert_sql} ON DUPLICATE KEY UPDATE {update_clause}'


def build_where_clause(columns):
    return ' AND '.join([f'{column} = %s' for column in columns])


def build_delete_sql(table_name, columns):
    return f'DELETE FROM {table_name} WHERE {build_where_clause(columns)}'


def get_primary_key_columns(cursor, table_name):
    cursor.execute(
        """
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.KEY_COLUMN_USAGE
        WHERE TABLE_SCHEMA = %s
          AND TABLE_NAME = %s
          AND CONSTRAINT_NAME = 'PRIMARY'
        ORDER BY ORDINAL_POSITION
        """,
        (DB_NAME, table_name)
    )
    rows = cursor.fetchall()
    primary_keys = [row['COLUMN_NAME'] for row in rows]

    if not primary_keys:
        raise ValueError(f'Table {table_name} does not have a primary key, so delete cannot safely resolve rows.')

    return primary_keys


def resolve_primary_key_values(cursor, table_name, row_dict, match_columns, primary_key_columns):
    lookup_sql = (
        f"SELECT {', '.join(primary_key_columns)} "
        f"FROM {table_name} "
        f"WHERE {build_where_clause(match_columns)}"
    )
    lookup_values = tuple(row_dict[column] for column in match_columns)
    cursor.execute(lookup_sql, lookup_values)
    matches = cursor.fetchall()

    if not matches:
        raise ValueError(f'No row found in {table_name} for delete criteria: {row_dict}')

    if len(matches) > 1:
        raise ValueError(f'Delete criteria matched multiple rows in {table_name}: {row_dict}')

    match = matches[0]
    return tuple(match[column] for column in primary_key_columns)


def build_s3_destination_key(source_key, destination_prefix):
    filename = source_key.split('/')[-1]
    timestamp = datetime.utcnow().strftime('%Y%m%d_%H%M%S')
    return f"{destination_prefix.rstrip('/')}/{timestamp}_{filename}"


def move_file(bucket, source_key, destination_prefix):
    destination_key = build_s3_destination_key(source_key, destination_prefix)

    s3_client.copy_object(
        Bucket=bucket,
        CopySource={'Bucket': bucket, 'Key': source_key},
        Key=destination_key
    )
    s3_client.delete_object(Bucket=bucket, Key=source_key)

    return destination_key


def upload_error_file(bucket, source_key, destination_prefix, table_name, transaction_type, columns, data_rows):
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([table_name])
    writer.writerow([transaction_type])
    writer.writerow(columns + ['Error'])

    for row in data_rows:
        values = list(row['values'])
        if len(values) < len(columns):
            values.extend([''] * (len(columns) - len(values)))
        if len(values) > len(columns):
            values = values[:len(columns)]
        writer.writerow(values + [row.get('error', '') or ''])

    destination_key = build_s3_destination_key(source_key, destination_prefix)
    s3_client.put_object(Bucket=bucket, Key=destination_key, Body=output.getvalue().encode('utf-8'))
    s3_client.delete_object(Bucket=bucket, Key=source_key)

    return destination_key


def find_input_file_key(bucket, input_prefix):
    response = s3_client.list_objects_v2(Bucket=bucket, Prefix=input_prefix, MaxKeys=100)
    contents = response.get('Contents', [])

    # Skip keys that are folder placeholders and use the earliest modified file.
    file_keys = [item for item in contents if item.get('Key') != input_prefix]
    if not file_keys:
        raise ValueError(f'No input files found at s3://{bucket}/{input_prefix}')

    file_keys.sort(key=lambda item: item.get('LastModified'))
    return file_keys[0]['Key']


def process_insert_row(cursor, table_name, columns, row_values):
    sql = build_insert_ignore_sql(table_name, columns)
    cursor.execute(sql, tuple(row_values))
    if cursor.rowcount == 1:
        return 'inserted'
    return 'ignored'


def process_upsert_row(cursor, table_name, columns, row_values):
    sql = build_upsert_sql(table_name, columns)
    cursor.execute(sql, tuple(row_values))
    if cursor.rowcount == 1:
        return 'inserted'
    if cursor.rowcount == 2:
        return 'updated'
    return 'ignored'


def process_delete_row(cursor, table_name, columns, row_values, primary_key_columns, has_primary_key_in_csv):
    row_dict = dict(zip(columns, row_values))

    if has_primary_key_in_csv:
        delete_values = tuple(row_dict[column] for column in primary_key_columns)
    else:
        delete_values = resolve_primary_key_values(
            cursor,
            table_name,
            row_dict,
            columns,
            primary_key_columns
        )

    delete_sql = build_delete_sql(table_name, primary_key_columns)
    cursor.execute(delete_sql, delete_values)
    if cursor.rowcount > 0:
        return 'deleted'
    return 'ignored'


def lambda_handler(event, context):
    event = event or {}
    bucket = event.get('bucket') or S3_BUCKET
    input_prefix = f"{S3_DATA_FOLDER.rstrip('/')}/input/"
    complete_prefix = f"{S3_DATA_FOLDER.rstrip('/')}/complete/"
    error_prefix = f"{S3_DATA_FOLDER.rstrip('/')}/error/"
    key = event.get('key')

    if not key:
        try:
            key = find_input_file_key(bucket, input_prefix)
        except Exception as e:
            return {
                'statusCode': 400,
                'body': json.dumps({'status': 'error', 'message': str(e)})
            }

    connection = None

    try:
        table_name, transaction_type, columns, data_rows = parse_csv_from_s3(bucket, key)

        if table_name not in ALLOWED_TABLES:
            raise ValueError(f'Unsupported table name: {table_name}')

        if transaction_type not in ALLOWED_TRANSACTION_TYPES:
            raise ValueError(f'Unsupported transaction type: {transaction_type}')

        connection = get_connection()
        summary = {
            'rows_processed': len(data_rows),
            'rows_inserted': 0,
            'rows_updated': 0,
            'rows_deleted': 0,
            'rows_ignored': 0,
            'rows_errored': 0
        }

        with connection.cursor() as cursor:
            primary_key_columns = []
            has_primary_key_in_csv = False
            if transaction_type == 'D' and data_rows:
                primary_key_columns = get_primary_key_columns(cursor, table_name)
                has_primary_key_in_csv = all(column in columns for column in primary_key_columns)

            for row in data_rows:
                if row.get('error'):
                    summary['rows_errored'] += 1
                    continue

                try:
                    if transaction_type == 'I':
                        result = process_insert_row(cursor, table_name, columns, row['values'])
                    elif transaction_type == 'IU':
                        result = process_upsert_row(cursor, table_name, columns, row['values'])
                    else:
                        result = process_delete_row(
                            cursor,
                            table_name,
                            columns,
                            row['values'],
                            primary_key_columns,
                            has_primary_key_in_csv
                        )

                    if result == 'inserted':
                        summary['rows_inserted'] += 1
                    elif result == 'updated':
                        summary['rows_updated'] += 1
                    elif result == 'deleted':
                        summary['rows_deleted'] += 1
                    else:
                        summary['rows_ignored'] += 1
                except Exception as row_error:
                    row['error'] = f"Row {row['row_number']}: {row_error}"
                    summary['rows_errored'] += 1

        connection.commit()

        completed_key = None
        error_key = None
        if summary['rows_errored'] > 0:
            error_key = upload_error_file(
                bucket,
                key,
                error_prefix,
                table_name,
                transaction_type,
                columns,
                data_rows
            )
        else:
            completed_key = move_file(bucket, key, complete_prefix)

        response_status = 'partial_success' if summary['rows_errored'] > 0 else 'success'
        response_message = None
        if summary['rows_errored'] > 0:
            response_message = 'One or more rows were skipped. Review the annotated error file for details.'

        summary.update({
            'status': response_status,
            'message': response_message,
            'table': table_name,
            'transaction_type': transaction_type,
            'completed_key': completed_key,
            'error_key': error_key
        })

        return {
            'statusCode': 200,
            'body': json.dumps(summary)
        }

    except Exception as e:
        if connection:
            connection.rollback()

        error_key = None
        if bucket and key:
            try:
                error_key = move_file(bucket, key, error_prefix)
            except Exception as move_error:
                print(f'Failed moving errored file: {move_error}')

        return {
            'statusCode': 500,
            'body': json.dumps({
                'status': 'error',
                'message': str(e),
                'error_key': error_key
            })
        }
    finally:
        if connection:
            connection.close()
