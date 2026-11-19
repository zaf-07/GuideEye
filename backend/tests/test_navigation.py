from __future__ import annotations

import asyncio
import os
import unittest
from unittest import mock

from backend.app.services import navigation
from backend.app.services.assistant import Assistant, route
from backend.app.services.memory import Memory
from backend.app.services.navigation import Navigator
from backend.app.services.payments import Orders

HOME = (37.7606, -122.3866)
SHOP = (37.7650, -122.3866)   # about 490 m north of HOME
CORNER = (37.7628, -122.3866)  # half way


def run(coroutine):
    return asyncio.run(coroutine)


async def fake_place(term, lat, lon):
    return {'name': 'Safeway', 'lat': SHOP[0], 'lon': SHOP[1], 'distance_m': 490}


async def no_place(term, lat, lon):
    return None


async def fake_route(lat, lon, dest_lat, dest_lon):
    return {'distance_m': 490, 'duration_s': 360, 'steps': [
        {'say': 'Head north on 20th Street for 250 feet.', 'lat': HOME[0], 'lon': HOME[1], 'distance_m': 245},
        {'say': 'Turn left onto Illinois Street. Then continue for 800 feet.', 'lat': CORNER[0], 'lon': CORNER[1], 'distance_m': 245},
        {'say': 'You have arrived.', 'lat': SHOP[0], 'lon': SHOP[1], 'distance_m': 0},
    ]}


class HelperTests(unittest.TestCase):
    def test_haversine(self):
        self.assertAlmostEqual(navigation.haversine(*HOME, *SHOP), 489, delta=3)

    def test_spoken_distance_uses_feet_then_miles(self):
        self.assertEqual(navigation.spoken_distance(10), 'a few steps')
        self.assertEqual(navigation.spoken_distance(120), '400 feet')
        self.assertEqual(navigation.spoken_distance(800), '0.5 miles')

    def test_destination_query(self):
        self.assertEqual(navigation.destination_query('Take me to the nearest supermarket')[0], 'supermarket')
        self.assertEqual(navigation.destination_query('Where is the closest grocery store?')[0], 'supermarket')
        self.assertEqual(navigation.destination_query('Guide me to Safeway.')[0], 'safeway')
        self.assertEqual(navigation.destination_query('directions to trader joe\'s')[0], "trader joe's")

    def test_instructions(self):
        depart = {'maneuver': {'type': 'depart', 'bearing_after': 264}, 'name': '20th Street', 'distance': 120}
        self.assertEqual(navigation.instruction(depart), 'Head west on 20th Street for 400 feet.')
        turn = {'maneuver': {'type': 'turn', 'modifier': 'left'}, 'name': 'Illinois Street', 'distance': 150}
        self.assertEqual(navigation.instruction(turn), 'Turn left onto Illinois Street. Then continue for 500 feet.')
        unnamed = {'maneuver': {'type': 'end of road', 'modifier': 'slight right'}, 'name': '', 'distance': 60}
        self.assertEqual(navigation.instruction(unnamed), 'Bear right. Then continue for 200 feet.')
        self.assertEqual(navigation.instruction({'maneuver': {'type': 'arrive'}}), 'You have arrived.')

    def test_build_route_drops_tiny_connectors_but_keeps_arrival(self):
        osrm = {'routes': [{'distance': 300, 'duration': 240, 'legs': [{'steps': [
            {'maneuver': {'type': 'depart', 'bearing_after': 0, 'location': [0, 0]}, 'name': 'A', 'distance': 100},
            {'maneuver': {'type': 'turn', 'modifier': 'right', 'location': [0, 1]}, 'name': '', 'distance': 5},
            {'maneuver': {'type': 'turn', 'modifier': 'left', 'location': [0, 2]}, 'name': 'B', 'distance': 195},
            {'maneuver': {'type': 'arrive', 'location': [0, 3]}, 'name': 'B', 'distance': 0},
        ]}]}]}
        steps = navigation.build_route(osrm)['steps']
        self.assertEqual(len(steps), 3)
        self.assertEqual(steps[-1]['say'], 'You have arrived.')


class NavigatorTests(unittest.TestCase):
    def test_route_is_spoken_turn_by_turn(self):
        nav = Navigator(fake_place, fake_route)
        intro = run(nav.start('s', 'Take me to the nearest supermarket', *HOME))
        self.assertIn('Safeway is 0.3 miles away, about 6 minutes on foot.', intro)
        self.assertIn('Head north on 20th Street', intro)
        self.assertIn('do not mean a crossing is safe', intro)
        self.assertIsNone(nav.update('s', 37.7612, HOME[1])['say'])           # still walking
        self.assertIn('Turn left onto Illinois', nav.update('s', *CORNER)['say'])
        self.assertIsNone(nav.update('s', *CORNER)['say'])                    # never repeated
        arrived = nav.update('s', 37.76485, SHOP[1])
        self.assertEqual((arrived['say'], arrived['active']), ('You have arrived at Safeway.', False))
        self.assertEqual(nav.update('s', *SHOP), {'active': False, 'say': None})

    def test_unknown_place_and_stop(self):
        nav = Navigator(no_place, fake_route)
        with self.assertRaises(navigation.NavigationError):
            run(nav.start('s', 'Take me to Atlantis', *HOME))
        self.assertFalse(nav.stop('s'))


class PathTests(unittest.TestCase):
    def test_breadcrumbs_skip_jitter_and_find_trip_start(self):
        memory = Memory(':memory:')
        self.assertTrue(memory.record_location(*HOME, now=1000))
        self.assertFalse(memory.record_location(HOME[0] + 0.00001, HOME[1], now=1010))  # about 1 m
        self.assertTrue(memory.record_location(*CORNER, now=1200))
        self.assertTrue(memory.record_location(*SHOP, now=1400))
        self.assertEqual(len(memory.path()), 3)
        start = memory.trip_start(now=1450)
        self.assertEqual((start['lat'], start['lon']), HOME)
        self.assertIsNone(memory.trip_start(now=1400 + 3600))  # the walk ended long ago

    def test_long_pause_starts_a_new_trip(self):
        memory = Memory(':memory:')
        memory.record_location(*HOME, now=1000)
        memory.record_location(*CORNER, now=1000 + 3600)
        memory.record_location(*SHOP, now=1000 + 3700)
        self.assertEqual(memory.trip_start(now=1000 + 3750)['lat'], CORNER[0])


class AssistantNavigationTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {'GEMINI_API_KEY': '', 'GROQ_API_KEY': ''})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.memory = Memory(':memory:')
        self.assistant = Assistant(self.memory, Orders(), navigator=Navigator(fake_place, fake_route))

    def test_routing_rules(self):
        self.assertEqual(route('Take me to the nearest supermarket'), 'navigate')
        self.assertEqual(route('Get me to Safeway'), 'navigate')       # not a purchase
        self.assertEqual(route('Get me a coffee'), 'pay_quote')
        self.assertEqual(route('Where is the closest pharmacy?'), 'navigate')
        self.assertEqual(route('Take me back'), 'go_back')
        self.assertEqual(route('Stop navigation'), 'nav_stop')

    def test_directions_need_a_location(self):
        reply = run(self.assistant.respond('s', 'Take me to Safeway'))
        self.assertIn('need your location', reply['say'])

    def test_navigate_then_stop(self):
        reply = run(self.assistant.respond('s', 'Take me to Safeway', location=HOME))
        self.assertTrue(reply['navigating'])
        self.assertIn('Safeway is', reply['say'])
        self.assertEqual(run(self.assistant.respond('s', 'Stop navigation'))['say'], 'Navigation stopped.')

    def test_take_me_back_uses_the_walked_path(self):
        self.assertIn('close to where you started', run(self.assistant.respond('s', 'Take me back', location=HOME))['say'])
        import time
        self.memory.record_location(*SHOP, now=time.time() - 300)
        self.memory.record_location(*CORNER, now=time.time() - 100)
        self.memory.record_location(*HOME, now=time.time() - 5)
        reply = run(self.assistant.respond('s', 'Take me back', location=HOME))
        self.assertIn('your starting point is', reply['say'])


if __name__ == '__main__':
    unittest.main()
