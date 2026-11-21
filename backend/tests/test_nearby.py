from __future__ import annotations

import os
import unittest
from unittest import mock

from backend.app.services.nearby import BridgeRooms, NearbyError, Radar, device_id_for, verify_device

try:
    from fastapi.testclient import TestClient
except ImportError:
    TestClient = None

HALL = (37.4890, -121.9290)
SAME_ROOM = (37.48903, -121.92902)
ACROSS_TOWN = (37.5483, -121.9886)


class Clock:
    def __init__(self) -> None:
        self.now = 1_000_000.0

    def __call__(self) -> float:
        return self.now


class RoomTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.rooms = BridgeRooms(self.clock)

    def test_two_devices_share_a_code_and_a_third_is_refused(self):
        room = self.rooms.create('a')
        self.assertRegex(room['code'], r'^\d{6}$')
        self.assertEqual((room['partner_joined'], room['is_member']), (False, True))
        self.assertTrue(self.rooms.join(room['code'], 'b')['partner_joined'])
        self.assertTrue(self.rooms.join(room['code'], 'b')['is_member'])
        with self.assertRaises(NearbyError) as refused:
            self.rooms.join(room['code'], 'c')
        self.assertEqual(refused.exception.status, 409)

    def test_messages_are_ordered_deduplicated_and_private_to_members(self):
        code = self.rooms.create('a', 'b')['code']
        first = self.rooms.post(code, 'a', 'blind', ' Where is room 204? ', 'c1')
        again = self.rooms.post(code, 'a', 'blind', 'Where is room 204?', 'c1')
        self.rooms.post(code, 'b', 'deaf', 'Down the hall.', 'c2')
        self.assertEqual((first['id'], again['id'], first['text']), (1, 1, 'Where is room 204?'))
        seen = self.rooms.messages(code, 'b')
        self.assertEqual([(m['id'], m['from_this_device']) for m in seen], [(1, False), (2, True)])
        self.assertEqual([m['id'] for m in self.rooms.messages(code, 'a', after_id=1)], [2])
        with self.assertRaises(NearbyError) as outsider:
            self.rooms.messages(code, 'c')
        self.assertEqual(outsider.exception.status, 403)

    def test_rooms_expire(self):
        code = self.rooms.create('a')['code']
        self.clock.now += 3 * 60 * 60
        with self.assertRaises(NearbyError) as gone:
            self.rooms.get(code, 'a')
        self.assertEqual(gone.exception.status, 404)


class RadarTests(unittest.TestCase):
    def setUp(self):
        self.clock = Clock()
        self.rooms = BridgeRooms(self.clock)
        self.radar = Radar(self.rooms, self.clock, radius_m=50)
        self.events: list[tuple[str, str]] = []
        self.radar.subscribe(lambda device, event: self.events.append((device, event['event'])))

    def test_nearby_blind_and_deaf_users_are_offered_then_matched(self):
        self.assertIsNone(self.radar.heartbeat('blind-phone', 'blind', *HALL)['offer'])
        offer = self.radar.heartbeat('deaf-phone', 'deaf', *SAME_ROOM)['offer']
        self.assertEqual((offer['closeness'], offer['you_accepted'], offer['partner_accepted']), ('very close', False, False))
        self.assertNotIn('role', offer)
        self.assertEqual(self.radar.state('blind-phone')['offer']['offer_id'], offer['offer_id'])
        waiting = self.radar.respond('blind-phone', offer['offer_id'], True)
        self.assertIsNone(waiting['match'])
        self.assertTrue(self.radar.state('deaf-phone')['offer']['partner_accepted'])
        match = self.radar.respond('deaf-phone', offer['offer_id'], True)['match']
        self.assertEqual((match['your_role'], match['partner_role']), ('deaf', 'blind'))
        self.assertEqual(self.radar.state('blind-phone')['match']['code'], match['code'])
        self.assertTrue(self.rooms.get(match['code'], 'blind-phone')['partner_joined'])
        self.assertIn(('blind-phone', 'offer'), self.events)
        self.assertIn(('blind-phone', 'match'), self.events)

    def test_far_apart_or_same_role_users_are_not_offered(self):
        self.radar.heartbeat('a', 'blind', *HALL)
        self.assertIsNone(self.radar.heartbeat('b', 'deaf', *ACROSS_TOWN)['offer'])
        self.assertIsNone(self.radar.heartbeat('c', 'blind', *SAME_ROOM)['offer'])

    def test_a_shared_beacon_matches_without_location(self):
        self.radar.heartbeat('a', 'blind', beacon='yc-demo')
        self.assertIsNotNone(self.radar.heartbeat('b', 'deaf', beacon='yc-demo')['offer'])

    def test_declining_stops_the_pair_being_offered_again(self):
        self.radar.heartbeat('a', 'blind', *HALL)
        offer = self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer']
        self.assertIsNone(self.radar.respond('a', offer['offer_id'], False)['offer'])
        self.assertIn(('b', 'declined'), self.events)
        self.assertIsNone(self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer'])
        self.clock.now += 5
        self.assertIsNone(self.radar.heartbeat('a', 'blind', *HALL)['offer'])

    def test_offers_and_presence_expire(self):
        self.radar.heartbeat('a', 'blind', *HALL)
        offer = self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer']
        self.clock.now += 31
        with self.assertRaises(NearbyError):
            self.radar.respond('a', offer['offer_id'], True)
        self.assertFalse(self.radar.state('a')['active'])
        self.assertIsNone(self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer'])

    def test_a_declined_pair_is_offered_again_after_two_minutes_not_ten(self):
        self.radar.heartbeat('a', 'blind', *HALL)
        offer = self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer']
        self.radar.respond('a', offer['offer_id'], False)
        self.clock.now += 100
        self.radar.heartbeat('a', 'blind', *HALL)
        self.assertIsNone(self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer'])
        self.clock.now += 30
        self.radar.heartbeat('a', 'blind', *HALL)
        self.assertIsNotNone(self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer'])

    def test_a_connected_pair_is_not_offered_again_a_minute_into_the_conversation(self):
        self.radar.heartbeat('a', 'blind', *HALL)
        offer = self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer']
        self.radar.respond('a', offer['offer_id'], True)
        self.radar.respond('b', offer['offer_id'], True)
        for _ in range(4):
            self.clock.now += 25
            self.radar.heartbeat('a', 'blind', *HALL)
            self.assertIsNone(self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer'])

    def test_a_matched_pair_can_reconnect_after_both_leave_radar(self):
        self.radar.heartbeat('a', 'blind', *HALL)
        offer = self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer']
        self.radar.respond('a', offer['offer_id'], True)
        self.radar.respond('b', offer['offer_id'], True)
        self.radar.leave('a')
        self.radar.leave('b')
        self.radar.heartbeat('a', 'blind', *HALL)
        again = self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer']
        self.assertNotEqual(again['offer_id'], offer['offer_id'])

    def test_an_unanswered_offer_is_not_repeated_at_once(self):
        self.radar.heartbeat('a', 'blind', *HALL)
        first = self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer']
        self.clock.now += 15
        self.radar.heartbeat('a', 'blind', *HALL)
        self.radar.heartbeat('b', 'deaf', *SAME_ROOM)
        self.clock.now += 16
        self.radar.heartbeat('a', 'blind', *HALL)
        self.assertIsNone(self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer'])
        self.assertIn(('a', 'expired'), self.events)
        self.clock.now += 15
        self.radar.heartbeat('a', 'blind', *HALL)
        self.radar.heartbeat('b', 'deaf', *SAME_ROOM)
        self.clock.now += 50
        self.radar.heartbeat('a', 'blind', *HALL)
        again = self.radar.heartbeat('b', 'deaf', *SAME_ROOM)['offer']
        self.assertIsNotNone(again)
        self.assertNotEqual(again['offer_id'], first['offer_id'])

    def test_leaving_withdraws_an_open_offer(self):
        self.radar.heartbeat('a', 'blind', *HALL)
        self.radar.heartbeat('b', 'deaf', *SAME_ROOM)
        self.radar.leave('a')
        self.assertIsNone(self.radar.state('b')['offer'])

    def test_device_identity(self):
        secret = 'ab' * 32
        self.assertEqual(verify_device(device_id_for(secret), secret), device_id_for(secret))
        with self.assertRaises(NearbyError) as forged:
            verify_device(device_id_for('cd' * 32), secret)
        self.assertEqual(forged.exception.status, 403)
        with self.assertRaises(NearbyError):
            verify_device(None, None)


@unittest.skipIf(TestClient is None, 'FastAPI is not installed')
class NearbyApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with mock.patch.dict(os.environ, {'MEMORY_DB': ':memory:', 'BAND_AUTOCONNECT': 'false'}):
            from backend.app import main
            cls.context = TestClient(main.app)
            cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)

    @staticmethod
    def headers(name: str) -> dict:
        return {'X-Device-ID': name}

    def test_bridge_endpoints_match_what_the_app_calls(self):
        blind, deaf = self.headers('api-blind'), self.headers('api-deaf')
        room = self.client.post('/v1/bridge/conversations', headers=blind).json()
        code = room['code']
        self.assertEqual(set(room), {'code', 'created_at', 'expires_at', 'devices', 'max_devices', 'partner_joined', 'is_member'})
        self.assertTrue(self.client.post(f'/v1/bridge/conversations/{code}/join', headers=deaf).json()['partner_joined'])
        sent = self.client.post('/v1/bridge/message', headers=deaf, json={
            'session_id': code, 'sender_role': 'deaf', 'text': 'HELLO', 'client_id': 'x1'}).json()
        self.assertEqual((sent['id'], sent['from_this_device'], sent['relative_time']), (1, True, 'just now'))
        inbox = self.client.get(f'/v1/bridge/messages?session_id={code}&limit=50', headers=blind).json()
        self.assertEqual([(m['text'], m['from_this_device']) for m in inbox], [('HELLO', False)])
        self.assertEqual(self.client.get('/v1/bridge/conversations/000000', headers=blind).status_code, 404)
        self.assertEqual(self.client.get(f'/v1/bridge/messages?session_id={code}', headers=self.headers('stranger')).status_code, 403)
        self.assertEqual(self.client.post('/v1/bridge/conversations').status_code, 400)

    def test_radar_pairs_two_phones_and_pushes_the_match(self):
        blind, deaf = self.headers('radar-blind'), self.headers('radar-deaf')
        with self.client.websocket_connect('/v1/radar/ws') as socket:
            socket.send_json({'device_id': 'radar-blind'})
            self.assertEqual(socket.receive_json()['event'], 'state')
            self.client.post('/v1/radar/heartbeat', headers=blind, json={'role': 'blind', 'lat': HALL[0], 'lon': HALL[1]})
            state = self.client.post('/v1/radar/heartbeat', headers=deaf, json={'role': 'deaf', 'lat': SAME_ROOM[0], 'lon': SAME_ROOM[1]}).json()
            offer_id = state['offer']['offer_id']
            pushed = socket.receive_json()
            self.assertEqual((pushed['event'], pushed['offer_id']), ('offer', offer_id))
            self.client.post('/v1/radar/respond', headers=deaf, json={'offer_id': offer_id, 'accept': True})
            self.assertEqual(socket.receive_json()['event'], 'offer_update')
            socket.send_json({'type': 'respond', 'offer_id': offer_id, 'accept': True})
            received = [socket.receive_json(), socket.receive_json()]
            match = next(item for item in received if item['event'] == 'match')
            self.assertEqual((match['your_role'], match['partner_role']), ('blind', 'deaf'))
        code = match['code']
        with self.client.websocket_connect(f'/v1/bridge/ws/{code}') as room:
            room.send_json({'device_id': 'radar-blind'})
            self.assertTrue(room.receive_json()['partner_joined'])
            self.client.post('/v1/bridge/message', headers=deaf, json={'session_id': code, 'sender_role': 'deaf', 'text': 'HI'})
            live = room.receive_json()
            self.assertEqual((live['event'], live['message']['text'], live['message']['from_this_device']), ('message', 'HI', False))
        self.assertEqual(self.client.post('/v1/radar/leave', headers=blind).json(), {'active': False})

    def test_bad_input_is_refused(self):
        self.assertEqual(self.client.post('/v1/radar/heartbeat', headers=self.headers('x'), json={'role': 'pilot'}).status_code, 422)
        self.assertEqual(self.client.post('/v1/radar/respond', headers=self.headers('x'), json={'offer_id': 'nope', 'accept': True}).status_code, 404)


if __name__ == '__main__':
    unittest.main()
