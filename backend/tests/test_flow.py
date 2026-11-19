from __future__ import annotations

import asyncio
import os
import unittest
from unittest import mock

from backend.app.services.assistant import Assistant, parse_duration, route, timer_label
from backend.app.services.memory import Memory
from backend.app.services.navigation import Navigator
from backend.app.services.payments import Orders

HERE = (37.7606, -122.3866)


def run(coroutine):
    return asyncio.run(coroutine)


async def fake_place(term, lat, lon):
    return {'name': 'Safeway', 'lat': 37.7650, 'lon': -122.3866, 'distance_m': 490}


async def fake_route(lat, lon, dest_lat, dest_lon):
    return {'distance_m': 490, 'duration_s': 360, 'steps': [
        {'say': 'Head north for 500 feet.', 'lat': lat, 'lon': lon, 'distance_m': 490},
        {'say': 'You have arrived.', 'lat': dest_lat, 'lon': dest_lon, 'distance_m': 0},
    ]}


class FlowTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {'GEMINI_API_KEY': '', 'GROQ_API_KEY': '', 'MINIMAX_API_KEY': '', 'STRIPE_SECRET_KEY': ''})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.assistant = Assistant(Memory(':memory:'), Orders(), navigator=Navigator(fake_place, fake_route))

    def test_a_long_sentence_starting_with_okay_is_not_a_confirmation(self):
        long_request = "Okay. Can you set a timer I'm going to Safeway near Safeway in fifteen minutes."
        self.assertEqual(route(long_request), 'timer')
        self.assertEqual(route('Okay, what is in front of me right now please'), 'see')
        self.assertEqual(route('yes'), 'nothing_pending')
        # With a payment waiting, only a short answer confirms it.
        self.assertEqual(route('Yes please', True), 'pay_confirm')
        self.assertEqual(route('Okay do it', True), 'pay_confirm')
        self.assertEqual(route('No, cancel that', True), 'pay_cancel')
        self.assertEqual(route(long_request, True), 'pay_waiting')

    def test_a_long_okay_sentence_never_pays(self):
        run(self.assistant.respond('s', 'Buy me a coffee'))
        reply = run(self.assistant.respond('s', 'Okay so I was thinking we could go to the park later today'))
        self.assertEqual(reply['intent'], 'pay_waiting')
        self.assertEqual(run(self.assistant.respond('s', 'No'))['say'], 'Cancelled. Nothing was paid.')

    def test_durations(self):
        self.assertEqual(parse_duration('set a timer for 15 minutes'), 900)
        self.assertEqual(parse_duration('in fifteen minutes'), 900)
        self.assertEqual(parse_duration('timer for twenty five minutes'), 1500)
        self.assertEqual(parse_duration('remind me in an hour'), 3600)
        self.assertEqual(parse_duration('wake me in half an hour'), 1800)
        self.assertEqual(parse_duration('thirty seconds'), 30)
        self.assertIsNone(parse_duration('set a timer'))

    def test_timer_reply(self):
        reply = run(self.assistant.respond('s', "Okay. Can you set a timer I'm going to Safeway in fifteen minutes."))
        self.assertEqual(reply['timer']['seconds'], 900)
        self.assertIn('Timer set for 15 minutes', reply['say'])
        reminder = run(self.assistant.respond('s', 'Remind me to take my pills in ten minutes'))
        self.assertEqual(reminder['timer'], {'seconds': 600, 'label': 'take my pills'})
        self.assertEqual(timer_label('set a timer for five minutes'), '')
        self.assertIn('For how long', run(self.assistant.respond('s', 'Set a timer'))['say'])

    def test_a_failed_request_does_not_reuse_the_previous_map(self):
        async def nothing_nearby(term, lat, lon):
            return None

        async def no_such_place(text, lat=None, lon=None):
            return None

        first = run(self.assistant.respond('s', 'Take me to the nearest supermarket', location=HERE))
        self.assertIn('destination=37.765000', first['map_url'])
        assistant = Assistant(self.assistant.memory, Orders(), navigator=self.assistant.navigator, geocode=no_such_place)
        assistant.navigator._find_place = nothing_nearby
        failed = run(assistant.respond('s', 'Take me to Atlantis', location=HERE))
        self.assertIn('could not find', failed['say'])
        self.assertIsNone(failed['map_url'])  # the old route is still running, but this is not its map

    def test_a_far_away_place_is_found_on_the_whole_map(self):
        async def nothing_nearby(term, lat, lon):
            return None

        async def whole_map(text, lat=None, lon=None):
            return {'label': '161, Mission Falls Lane, Fremont', 'lat': 37.4845, 'lon': -121.9273}

        assistant = Assistant(Memory(':memory:'), Orders(), navigator=Navigator(nothing_nearby, fake_route), geocode=whole_map)
        reply = run(assistant.respond('s', 'Get directions to 161 Mission Falls Lane Fremont', location=HERE))
        self.assertTrue(reply['navigating'])
        self.assertIn('destination=37.484500,-121.927300', reply['map_url'])

    def test_directions_come_with_a_map_link(self):
        reply = run(self.assistant.respond('s', 'Take me to the nearest supermarket', location=HERE))
        self.assertTrue(reply['navigating'])
        self.assertIn('travelmode=walking', reply['map_url'])
        self.assertIn('destination=37.765000,-122.386600', reply['map_url'])
        self.assertIsNone(run(self.assistant.respond('s', 'Take me to the nearest supermarket'))['map_url'])


if __name__ == '__main__':
    unittest.main()
