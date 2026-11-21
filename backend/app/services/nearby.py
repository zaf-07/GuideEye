from __future__ import annotations

import hashlib
import math
import os
import secrets
import time
from datetime import datetime, timezone

ROLES = {'blind', 'deaf'}
PARTNER_ROLE = {'blind': 'deaf', 'deaf': 'blind'}

RADAR_RADIUS_M = float(os.getenv('RADAR_RADIUS_M', '50'))
PRESENCE_TTL_S = 20
OFFER_TTL_S = 30
MATCH_TTL_S = 60
MATCH_COOLDOWN_S = float(os.getenv('RADAR_MATCH_COOLDOWN_S', '300'))
# After "Not now" the same two people are left alone for a while. Ten minutes
# made one stray tap, or one misheard word, look like the feature had died.
DECLINE_COOLDOWN_S = float(os.getenv('RADAR_DECLINE_COOLDOWN_S', '120'))
# Two people who just connected are in a conversation: asking them again a
# minute later put the prompt on top of the conversation they were having.
# An offer nobody answered is not repeated straight away.
EXPIRED_COOLDOWN_S = float(os.getenv('RADAR_EXPIRED_COOLDOWN_S', '60'))
HEARTBEAT_EVERY_S = 5
ROOM_TTL_S = 2 * 60 * 60
ROOM_MAX_DEVICES = 2
ROOM_MAX_MESSAGES = 500
MESSAGE_MAX_CHARS = 600


class NearbyError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status, self.detail = status, detail


def device_id_for(secret: str) -> str:
    return f'device-{hashlib.sha256(secret.encode()).hexdigest()[:32]}'


def verify_device(device_id: str | None, secret: str | None) -> str:
    if not device_id or len(device_id) > 80:
        raise NearbyError(400, 'A device id is required')
    if secret and device_id.startswith('device-') and device_id_for(secret) != device_id:
        raise NearbyError(403, 'The device id does not match its secret')
    return device_id


def distance_m(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    radius = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def iso(timestamp: float) -> str:
    return datetime.fromtimestamp(timestamp, timezone.utc).isoformat()


def relative_time(seconds: float) -> str:
    if seconds < 45:
        return 'just now'
    minutes = round(seconds / 60)
    if minutes < 60:
        return f'{max(1, minutes)} min ago'
    return f'{round(minutes / 60)} h ago'


class BridgeRooms:
    def __init__(self, clock=time.time) -> None:
        self._clock = clock
        self._rooms: dict[str, dict] = {}
        self._listeners: list = []

    def subscribe(self, listener) -> None:
        self._listeners.append(listener)

    def _emit(self, code: str, event: dict) -> None:
        for listener in self._listeners:
            listener(code, event)

    def _sweep(self) -> None:
        now = self._clock()
        for code in [code for code, room in self._rooms.items() if room['expires'] <= now]:
            del self._rooms[code]

    def _room(self, code: str) -> dict:
        self._sweep()
        room = self._rooms.get(code)
        if room is None:
            raise NearbyError(404, 'That bridge conversation is not available')
        return room

    def _view(self, room: dict, device: str) -> dict:
        return {
            'code': room['code'], 'created_at': iso(room['created']), 'expires_at': iso(room['expires']),
            'devices': len(room['devices']), 'max_devices': ROOM_MAX_DEVICES,
            'partner_joined': len(room['devices']) >= 2, 'is_member': device in room['devices'],
        }

    def create(self, device: str, partner: str | None = None) -> dict:
        self._sweep()
        code = f'{secrets.randbelow(900000) + 100000}'
        while code in self._rooms:
            code = f'{secrets.randbelow(900000) + 100000}'
        now = self._clock()
        devices = [device] + ([partner] if partner else [])
        room = {'code': code, 'created': now, 'expires': now + ROOM_TTL_S, 'devices': devices, 'messages': [], 'next_id': 1}
        self._rooms[code] = room
        return self._view(room, device)

    def join(self, code: str, device: str) -> dict:
        room = self._room(code)
        if device not in room['devices']:
            if len(room['devices']) >= ROOM_MAX_DEVICES:
                raise NearbyError(409, 'That bridge conversation already has two devices')
            room['devices'].append(device)
            self._emit(code, {'event': 'partner_joined', 'devices': len(room['devices'])})
        return self._view(room, device)

    def get(self, code: str, device: str) -> dict:
        return self._view(self._room(code), device)

    def is_member(self, code: str, device: str) -> bool:
        room = self._rooms.get(code)
        return room is not None and room['expires'] > self._clock() and device in room['devices']

    def _member_room(self, code: str, device: str) -> dict:
        room = self._room(code)
        if device not in room['devices']:
            raise NearbyError(403, 'This device is not part of that bridge conversation')
        return room

    def _message_view(self, message: dict, device: str) -> dict:
        return {
            'id': message['id'], 'session_id': message['session_id'], 'sender_role': message['sender_role'],
            'text': message['text'], 'client_id': message['client_id'],
            'from_this_device': message['device'] == device, 'created_at': iso(message['created']),
            'relative_time': relative_time(self._clock() - message['created']),
        }

    def post(self, code: str, device: str, sender_role: str, text: str, client_id: str | None = None) -> dict:
        room = self._member_room(code, device)
        if sender_role not in ROLES:
            raise NearbyError(422, 'sender_role must be blind or deaf')
        text = text.strip()[:MESSAGE_MAX_CHARS]
        if not text:
            raise NearbyError(422, 'The message is empty')
        if client_id:
            for existing in room['messages']:
                if existing['client_id'] == client_id and existing['device'] == device:
                    return self._message_view(existing, device)
        message = {'id': room['next_id'], 'session_id': code, 'sender_role': sender_role, 'text': text,
                   'client_id': client_id, 'device': device, 'created': self._clock()}
        room['next_id'] += 1
        room['messages'] = (room['messages'] + [message])[-ROOM_MAX_MESSAGES:]
        self._emit(code, {'event': 'message', 'message': message})
        return self._message_view(message, device)

    def messages(self, code: str, device: str, after_id: int = 0, limit: int = 50) -> list[dict]:
        room = self._member_room(code, device)
        limit = max(1, min(limit, 200))
        found = [m for m in room['messages'] if m['id'] > after_id]
        chosen = found[:limit] if after_id else found[-limit:]
        return [self._message_view(m, device) for m in chosen]

    def view_for(self, message: dict, device: str) -> dict:
        return self._message_view(message, device)


class Radar:
    def __init__(self, rooms: BridgeRooms, clock=time.time, radius_m: float | None = None) -> None:
        self._rooms, self._clock = rooms, clock
        self._radius = RADAR_RADIUS_M if radius_m is None else radius_m
        self._present: dict[str, dict] = {}
        self._offers: dict[str, dict] = {}
        self._matches: dict[str, dict] = {}
        self._recent_matches: dict[frozenset[str], float] = {}
        self._cooldown: dict[frozenset, float] = {}
        self._listeners: list = []

    def subscribe(self, listener) -> None:
        self._listeners.append(listener)

    def _emit(self, device: str, event: dict) -> None:
        for listener in self._listeners:
            listener(device, event)

    def _sweep(self) -> None:
        now = self._clock()
        for device in [d for d, p in self._present.items() if now - p['seen'] > PRESENCE_TTL_S]:
            del self._present[device]
        for offer in [o for o in self._offers.values() if o['expires'] <= now]:
            self._cooldown[frozenset(offer['devices'])] = now + EXPIRED_COOLDOWN_S
            self._close(offer, 'expired')
        for device in [d for d, m in self._matches.items() if m['expires'] <= now]:
            del self._matches[device]
        for pair in [p for p, until in self._cooldown.items() if until <= now]:
            del self._cooldown[pair]
        for pair in [p for p, until in self._recent_matches.items() if until <= now]:
            del self._recent_matches[pair]

    def _close(self, offer: dict, reason: str) -> None:
        self._offers.pop(offer['id'], None)
        for device in offer['devices']:
            self._emit(device, {'event': reason, 'offer_id': offer['id']})

    def _offer_for(self, device: str) -> dict | None:
        return next((o for o in self._offers.values() if device in o['devices']), None)

    def _offer_view(self, offer: dict, device: str) -> dict:
        partner = next(d for d in offer['devices'] if d != device)
        return {
            'offer_id': offer['id'], 'expires_in_s': max(0, round(offer['expires'] - self._clock())),
            'closeness': offer['closeness'], 'you_accepted': device in offer['accepted'],
            'partner_accepted': partner in offer['accepted'],
        }

    def _near(self, a: dict, b: dict) -> float | None:
        if a.get('beacon') and a.get('beacon') == b.get('beacon'):
            return 0.0
        if None in (a.get('lat'), a.get('lon'), b.get('lat'), b.get('lon')):
            return None
        gap = distance_m(a['lat'], a['lon'], b['lat'], b['lon'])
        return gap if gap <= self._radius else None

    def _find_partner(self, device: str) -> tuple[str, float] | None:
        me = self._present[device]
        best: tuple[str, float] | None = None
        for other, there in self._present.items():
            if other == device or there['role'] != PARTNER_ROLE[me['role']]:
                continue
            pair = frozenset((device, other))
            if self._offer_for(other) or other in self._matches or pair in self._cooldown or pair in self._recent_matches:
                continue
            gap = self._near(me, there)
            if gap is not None and (best is None or gap < best[1]):
                best = (other, gap)
        return best

    def heartbeat(self, device: str, role: str, lat: float | None = None, lon: float | None = None,
                  beacon: str | None = None) -> dict:
        if role not in ROLES:
            raise NearbyError(422, 'role must be blind or deaf')
        self._sweep()
        self._present[device] = {'role': role, 'lat': lat, 'lon': lon, 'beacon': (beacon or '').strip()[:64] or None,
                                 'seen': self._clock()}
        offer = self._offer_for(device)
        if offer is None and device not in self._matches:
            found = self._find_partner(device)
            if found is not None:
                partner, gap = found
                offer = {'id': secrets.token_urlsafe(9), 'devices': [device, partner], 'accepted': set(),
                         'expires': self._clock() + OFFER_TTL_S, 'closeness': 'very close' if gap <= 10 else 'nearby'}
                self._offers[offer['id']] = offer
                for member in offer['devices']:
                    self._emit(member, {'event': 'offer', **self._offer_view(offer, member)})
        return self.state(device)

    def state(self, device: str) -> dict:
        offer = self._offer_for(device)
        return {
            'active': device in self._present, 'heartbeat_every_s': HEARTBEAT_EVERY_S,
            'offer': self._offer_view(offer, device) if offer else None,
            'match': self._match_view(self._matches[device]) if device in self._matches else None,
        }

    @staticmethod
    def _match_view(match: dict) -> dict:
        return {'code': match['code'], 'your_role': match['your_role'], 'partner_role': match['partner_role']}

    def respond(self, device: str, offer_id: str, accept: bool) -> dict:
        self._sweep()
        offer = self._offers.get(offer_id)
        if offer is None or device not in offer['devices']:
            raise NearbyError(404, 'That offer is no longer available')
        partner = next(d for d in offer['devices'] if d != device)
        if not accept:
            self._cooldown[frozenset(offer['devices'])] = self._clock() + DECLINE_COOLDOWN_S
            self._close(offer, 'declined')
            return self.state(device)
        offer['accepted'].add(device)
        if partner not in offer['accepted']:
            self._emit(partner, {'event': 'offer_update', **self._offer_view(offer, partner)})
            return self.state(device)
        self._offers.pop(offer['id'], None)
        self._recent_matches[frozenset(offer['devices'])] = self._clock() + MATCH_COOLDOWN_S
        room = self._rooms.create(device, partner)
        for member in offer['devices']:
            role = self._present.get(member, {}).get('role', 'blind')
            self._matches[member] = {'code': room['code'], 'your_role': role, 'partner_role': PARTNER_ROLE[role],
                                     'expires': self._clock() + MATCH_TTL_S}
            self._emit(member, {'event': 'match', **self._match_view(self._matches[member])})
        return self.state(device)

    def leave(self, device: str) -> None:
        self._present.pop(device, None)
        self._matches.pop(device, None)
        for pair in list(self._recent_matches):
            if device in pair and all(member not in self._present for member in pair):
                del self._recent_matches[pair]
        offer = self._offer_for(device)
        if offer is not None:
            self._close(offer, 'expired')
