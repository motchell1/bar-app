import json
import logging
import os
from typing import Dict

import boto3

LOGGER = logging.getLogger()
LOGGER.setLevel(logging.INFO)

DB_BAR_SYNC_LAMBDA_NAME = os.environ['DB_BAR_SYNC_LAMBDA_NAME']
DB_SPECIAL_SYNC_LAMBDA_NAME = os.environ['DB_SPECIAL_SYNC_LAMBDA_NAME']
ALERT_SNS_TOPIC_ARN = os.environ.get('ALERT_SNS_TOPIC_ARN', '').strip()
ALERT_EMAIL_FROM = os.environ.get('ALERT_EMAIL_FROM', '').strip()
ALERT_EMAIL_TO = [address.strip() for address in os.environ.get('ALERT_EMAIL_TO', '').split(',') if address.strip()]

LAMBDA_CLIENT = boto3.client('lambda')
SNS_CLIENT = boto3.client('sns') if ALERT_SNS_TOPIC_ARN else None
SES_CLIENT = boto3.client('ses') if ALERT_EMAIL_FROM and ALERT_EMAIL_TO else None


def invoke_db_bar_sync(payload: Dict) -> Dict:
    LOGGER.info('dataAudit: invoking dbBarSync payload=%s', payload)
    response = LAMBDA_CLIENT.invoke(
        FunctionName=DB_BAR_SYNC_LAMBDA_NAME,
        InvocationType='RequestResponse',
        Payload=json.dumps(payload).encode('utf-8'),
    )
    if response.get('FunctionError'):
        raise RuntimeError(f"dbBarSync invocation failed: {response['FunctionError']}")

    response_payload = json.loads(response['Payload'].read())
    status_code = response_payload.get('statusCode', 500)
    body = response_payload.get('body')
    parsed_body = json.loads(body) if isinstance(body, str) else (body or {})
    if status_code >= 400:
        raise RuntimeError(f'dbBarSync returned {status_code}: {parsed_body}')
    return parsed_body


def invoke_db_special_sync(payload: Dict) -> Dict:
    LOGGER.info('dataAudit: invoking dbSpecialSync payload=%s', payload)
    response = LAMBDA_CLIENT.invoke(
        FunctionName=DB_SPECIAL_SYNC_LAMBDA_NAME,
        InvocationType='RequestResponse',
        Payload=json.dumps(payload).encode('utf-8'),
    )
    if response.get('FunctionError'):
        raise RuntimeError(f"dbSpecialSync invocation failed: {response['FunctionError']}")

    response_payload = json.loads(response['Payload'].read())
    status_code = response_payload.get('statusCode', 500)
    body = response_payload.get('body')
    parsed_body = json.loads(body) if isinstance(body, str) else (body or {})
    if status_code >= 400:
        raise RuntimeError(f'dbSpecialSync returned {status_code}: {parsed_body}')
    return parsed_body


def publish_duplicate_alert(result: Dict) -> Dict[str, object]:
    duplicate_groups = result.get('duplicate_groups', [])
    if not duplicate_groups:
        LOGGER.info('dataAudit: no duplicate groups found; skipping alert publish')
        return {'email_sent': False, 'email_reason': 'NO_DUPLICATES_FOUND'}

    subject = f"[Bar App] Duplicate website domains detected ({len(duplicate_groups)} groups)"
    message_lines = [
        'Duplicate website-domain groups were detected for active bars in the same neighborhood with active specials.',
        '',
        f"duplicate_group_count: {result.get('duplicate_group_count', 0)}",
        '',
    ]
    for group in duplicate_groups:
        message_lines.append(
            f"- Domain: {group.get('domain')} | Neighborhood: {group.get('neighborhood')} | Bars: {group.get('active_bar_count')}"
        )
        for bar in group.get('bars', []):
            message_lines.append(
                f"  • bar_id={bar.get('bar_id')} | bar_name={bar.get('bar_name')} | website_url={bar.get('website_url')}"
            )
        message_lines.append('')

    text_message = '\n'.join(message_lines).strip()
    send_result = send_alert_email(subject=subject, text_message=text_message)
    return send_result


def publish_duplicate_specials_alert(result: Dict) -> Dict[str, object]:
    same_description_count = int(result.get('same_description_different_times_count', 0) or 0)
    same_time_count = int(result.get('same_time_different_descriptions_count', 0) or 0)
    total_duplicate_groups = same_description_count + same_time_count
    if total_duplicate_groups == 0:
        LOGGER.info('dataAudit: no duplicate-special groups found; skipping alert publish')
        return {'email_sent': False, 'email_reason': 'NO_DUPLICATES_FOUND'}

    subject = f"[Bar App] Duplicate specials detected ({total_duplicate_groups} groups)"
    message_lines = [
        'Duplicate active-special groups were detected.',
        '',
        f'same_description_different_times_count: {same_description_count}',
        f'same_time_different_descriptions_count: {same_time_count}',
        '',
        'Groups with same bar/day/type/description but different times:',
    ]
    message_lines.extend(
        _build_plaintext_table(
            result.get('same_description_different_times', []),
            [
                ('bar_id', 'Bar'),
                ('day_of_week', 'Day'),
                ('type', 'Type'),
                ('description', 'Description'),
                ('special_count', 'Specials'),
                ('distinct_time_windows', 'Distinct Times'),
            ],
        )
    )

    message_lines.append('')
    message_lines.append('Groups with same bar/day/type/time window but different descriptions:')
    message_lines.extend(
        _build_plaintext_table(
            result.get('same_time_different_descriptions', []),
            [
                ('bar_id', 'Bar'),
                ('day_of_week', 'Day'),
                ('type', 'Type'),
                ('all_day', 'All Day'),
                ('start_time', 'Start'),
                ('end_time', 'End'),
                ('special_count', 'Specials'),
                ('distinct_descriptions', 'Distinct Descriptions'),
            ],
        )
    )

    text_message = '\n'.join(message_lines).strip()
    html_message = _build_duplicate_specials_html_email(
        same_description_count=same_description_count,
        same_time_count=same_time_count,
        same_description_rows=result.get('same_description_different_times', []),
        same_time_rows=result.get('same_time_different_descriptions', []),
    )
    return send_alert_email(subject=subject, text_message=text_message, html_message=html_message)


def _build_plaintext_table(rows, columns, max_cell_len: int = 40):
    if not rows:
        return ['(none)']

    headers = [label for _, label in columns]
    widths = [len(header) for header in headers]

    normalized_rows = []
    for row in rows:
        values = []
        for index, (key, _) in enumerate(columns):
            value = str(row.get(key, '') if row.get(key, '') is not None else '')
            if len(value) > max_cell_len:
                value = f"{value[: max_cell_len - 1]}…"
            widths[index] = min(max(widths[index], len(value)), max_cell_len)
            values.append(value)
        normalized_rows.append(values)

    def _format_line(values):
        return ' | '.join(value.ljust(widths[index]) for index, value in enumerate(values))

    separator = '-+-'.join('-' * width for width in widths)
    lines = [_format_line(headers), separator]
    lines.extend(_format_line(values) for values in normalized_rows)
    return lines


def _escape_html(value) -> str:
    return (
        str(value)
        .replace('&', '&amp;')
        .replace('<', '&lt;')
        .replace('>', '&gt;')
        .replace('"', '&quot;')
        .replace("'", '&#39;')
    )


def _build_html_table(rows, columns):
    header_cells = ''.join(f"<th style='border:1px solid #ddd;padding:8px;text-align:left;background:#f5f5f5'>{_escape_html(label)}</th>" for _, label in columns)
    if not rows:
        body_rows = f"<tr><td colspan='{len(columns)}' style='border:1px solid #ddd;padding:8px;color:#666'>(none)</td></tr>"
    else:
        rendered_rows = []
        for row in rows:
            cells = ''.join(
                f"<td style='border:1px solid #ddd;padding:8px;vertical-align:top'>{_escape_html(row.get(key, '') if row.get(key, '') is not None else '')}</td>"
                for key, _ in columns
            )
            rendered_rows.append(f'<tr>{cells}</tr>')
        body_rows = ''.join(rendered_rows)
    return (
        "<table style='border-collapse:collapse;width:100%;font-family:Arial,sans-serif;font-size:14px;margin:10px 0'>"
        f"<thead><tr>{header_cells}</tr></thead>"
        f"<tbody>{body_rows}</tbody>"
        '</table>'
    )


def _build_duplicate_specials_html_email(
    same_description_count: int,
    same_time_count: int,
    same_description_rows,
    same_time_rows,
) -> str:
    first_table = _build_html_table(
        same_description_rows,
        [
            ('bar_id', 'Bar'),
            ('day_of_week', 'Day'),
            ('type', 'Type'),
            ('description', 'Description'),
            ('special_count', 'Specials'),
            ('distinct_time_windows', 'Distinct Times'),
        ],
    )
    second_table = _build_html_table(
        same_time_rows,
        [
            ('bar_id', 'Bar'),
            ('day_of_week', 'Day'),
            ('type', 'Type'),
            ('all_day', 'All Day'),
            ('start_time', 'Start'),
            ('end_time', 'End'),
            ('special_count', 'Specials'),
            ('distinct_descriptions', 'Distinct Descriptions'),
        ],
    )
    return (
        "<html><body style='font-family:Arial,sans-serif;color:#222'>"
        '<h2>Duplicate active-special groups were detected</h2>'
        f"<p><strong>same_description_different_times_count:</strong> {_escape_html(same_description_count)}<br>"
        f"<strong>same_time_different_descriptions_count:</strong> {_escape_html(same_time_count)}</p>"
        '<h3>Groups with same bar/day/type/description but different times</h3>'
        f'{first_table}'
        '<h3>Groups with same bar/day/type/time window but different descriptions</h3>'
        f'{second_table}'
        '</body></html>'
    )


def send_alert_email(subject: str, text_message: str, html_message: str = None) -> Dict[str, object]:
    if SES_CLIENT:
        LOGGER.info('dataAudit: sending alert through SES from=%s to=%s', ALERT_EMAIL_FROM, ALERT_EMAIL_TO)
        body = {'Text': {'Data': text_message, 'Charset': 'UTF-8'}}
        if html_message:
            body['Html'] = {'Data': html_message, 'Charset': 'UTF-8'}
        SES_CLIENT.send_email(
            Source=ALERT_EMAIL_FROM,
            Destination={'ToAddresses': ALERT_EMAIL_TO},
            Message={
                'Subject': {'Data': subject[:100], 'Charset': 'UTF-8'},
                'Body': body,
            },
        )
        LOGGER.info('dataAudit: SES email send succeeded')
        return {'email_sent': True, 'email_reason': 'SENT_VIA_SES'}

    if SNS_CLIENT:
        LOGGER.info('dataAudit: sending alert through SNS topic=%s', ALERT_SNS_TOPIC_ARN)
        SNS_CLIENT.publish(
            TopicArn=ALERT_SNS_TOPIC_ARN,
            Subject=subject[:100],
            Message=text_message,
        )
        LOGGER.info('dataAudit: SNS publish succeeded')
        return {'email_sent': True, 'email_reason': 'SENT_VIA_SNS'}

    LOGGER.warning('dataAudit: no alert delivery channel configured (SES or SNS)')
    return {'email_sent': False, 'email_reason': 'NO_ALERT_CHANNEL_CONFIGURED'}


def lambda_handler(event, context):
    event = event or {}
    request_id = getattr(context, 'aws_request_id', 'unknown')
    mode = event.get('mode') or 'detect_duplicate_websites'
    LOGGER.info('dataAudit request_id=%s mode=%s received', request_id, mode)

    if mode == 'detect_duplicate_websites':
        result = invoke_db_bar_sync({'mode': 'detect_duplicate_websites'})
        LOGGER.info('dataAudit request_id=%s duplicate_group_count=%s', request_id, result.get('duplicate_group_count', 0))
        result.update(publish_duplicate_alert(result))
        return {
            'statusCode': 200,
            'body': json.dumps(result),
        }

    if mode == 'detect_duplicate_specials':
        payload = {'mode': 'detect_duplicate_specials'}
        if event.get('bar_id') not in {None, ''}:
            payload['bar_id'] = event.get('bar_id')
        result = invoke_db_special_sync(payload)
        LOGGER.info(
            'dataAudit request_id=%s same_description_different_times=%s same_time_different_descriptions=%s',
            request_id,
            result.get('same_description_different_times_count', 0),
            result.get('same_time_different_descriptions_count', 0),
        )
        result.update(publish_duplicate_specials_alert(result))
        return {
            'statusCode': 200,
            'body': json.dumps(result),
        }

    return {
        'statusCode': 400,
        'body': json.dumps({'error': 'mode must be detect_duplicate_websites or detect_duplicate_specials'}),
    }
