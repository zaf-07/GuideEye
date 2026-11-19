def plan(text: str) -> dict:
    value = text.lower()
    if 'safeway' in value:
        return {'intent': 'schedule_journey', 'requires_confirmation': True, 'destination': 'Safeway', 'delay_minutes': 30 if '30' in value else 0}
    if 'call' in value:
        return {'intent': 'open_dialer', 'requires_confirmation': True}
    if 'whatsapp' in value or 'message' in value:
        return {'intent': 'open_whatsapp', 'requires_confirmation': True, 'limitation': 'Reading arbitrary chats requires an approved app API or user-enabled AccessibilityService.'}
    if 'bridge' in value:
        return {'intent': 'start_bridge', 'requires_confirmation': False}
    return {'intent': 'unknown', 'requires_confirmation': False}
