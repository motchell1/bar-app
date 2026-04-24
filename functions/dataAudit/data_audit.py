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

LAMBDA_CLIENT = boto3.client('lambda')
SNS_CLIENT = boto3.client('sns') if ALERT_SNS_TOPIC_ARN else None


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
    if not ALERT_SNS_TOPIC_ARN:
        LOGGER.warning('dataAudit: ALERT_SNS_TOPIC_ARN is not configured; skipping alert publish')
        return {'email_sent': False, 'email_reason': 'ALERT_SNS_TOPIC_ARN_NOT_CONFIGURED'}

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

    LOGGER.info('dataAudit: publishing SNS alert topic=%s duplicate_groups=%s', ALERT_SNS_TOPIC_ARN, len(duplicate_groups))
    SNS_CLIENT.publish(
        TopicArn=ALERT_SNS_TOPIC_ARN,
        Subject=subject[:100],
        Message='\n'.join(message_lines).strip(),
    )
    LOGGER.info('dataAudit: SNS publish succeeded')
    return {'email_sent': True, 'email_reason': 'SENT'}


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
        return {
            'statusCode': 200,
            'body': json.dumps(result),
        }

    return {
        'statusCode': 400,
        'body': json.dumps({'error': 'mode must be detect_duplicate_websites or detect_duplicate_specials'}),
    }
