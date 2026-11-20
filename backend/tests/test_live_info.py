from __future__ import annotations

import asyncio
import unittest
from unittest import mock

from backend.app.services import live_info


class WeatherTests(unittest.TestCase):
    def test_weather_uses_current_location(self):
        async def get(_, __):
            return {'current': {'temperature_2m': 61.4, 'apparent_temperature': 59.6,
                                'weather_code': 2, 'wind_speed_10m': 7.8, 'precipitation': 0}}
        with mock.patch.object(live_info, '_get', get):
            answer = asyncio.run(live_info.weather('What is the weather?', (37.77, -122.42)))
        self.assertIn('your location', answer)
        self.assertIn('61 degrees Fahrenheit', answer)
        self.assertIn('partly cloudy', answer)

    def test_weather_can_find_a_named_city(self):
        calls = []
        async def get(url, params):
            calls.append((url, params))
            if url == live_info.GEOCODE_URL:
                return {'results': [{'name': 'Seattle', 'admin1': 'Washington', 'country': 'United States',
                                     'latitude': 47.61, 'longitude': -122.33}]}
            return {'current': {'temperature_2m': 48, 'apparent_temperature': 45,
                                'weather_code': 61, 'wind_speed_10m': 5, 'precipitation': 1.2}}
        with mock.patch.object(live_info, '_get', get):
            answer = asyncio.run(live_info.weather('What is the weather in Seattle?'))
        self.assertIn('Seattle, Washington, United States', answer)
        self.assertIn('light rain', answer)
        self.assertEqual(calls[0][0], live_info.GEOCODE_URL)

    def test_weather_needs_a_city_or_location(self):
        with self.assertRaises(live_info.LiveInfoError):
            asyncio.run(live_info.weather('What is the weather?'))
