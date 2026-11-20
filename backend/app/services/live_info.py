"""Small, source-backed live information tools.

Weather comes from Open-Meteo's public geocoding and forecast APIs, so it does
not require a secret or a paid account.  Broader product research is handled by
the configured HarnessRouter agent in ``assistant.py`` because prices need a
real web search and should name the retailer that supplied them.
"""
from __future__ import annotations

import re

GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search'
FORECAST_URL = 'https://api.open-meteo.com/v1/forecast'

WEATHER_CODES = {
    0: 'clear', 1: 'mostly clear', 2: 'partly cloudy', 3: 'overcast',
    45: 'foggy', 48: 'foggy', 51: 'light drizzle', 53: 'drizzle', 55: 'heavy drizzle',
    61: 'light rain', 63: 'rain', 65: 'heavy rain', 71: 'light snow',
    73: 'snow', 75: 'heavy snow', 80: 'rain showers', 81: 'rain showers',
    82: 'heavy rain showers', 95: 'thunderstorms', 96: 'thunderstorms with hail', 99: 'thunderstorms with hail',
}


class LiveInfoError(Exception):
    pass


async def _get(url: str, params: dict) -> dict:
    import httpx
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(8.0, connect=3.0)) as client:
            response = await client.get(url, params=params)
            response.raise_for_status()
            return response.json()
    except Exception as error:
        raise LiveInfoError('The weather service is unavailable right now.') from error


def requested_place(text: str) -> str:
    match = re.search(r'\b(?:weather|forecast|temperature|rain)\s+(?:in|at|for|near)\s+(.+?)[?.!]*$', text, re.IGNORECASE)
    return match.group(1).strip(' .,?!') if match else ''


async def weather(text: str, location: tuple[float, float] | None = None) -> str:
    """Return a short, spoken-friendly current-weather answer."""
    place = requested_place(text)
    label = 'your location'
    if location is not None:
        lat, lon = location
    elif place:
        matches = (await _get(GEOCODE_URL, {'name': place, 'count': 1, 'language': 'en', 'format': 'json'})).get('results') or []
        if not matches:
            raise LiveInfoError(f'I could not find {place} for a weather report.')
        found = matches[0]
        lat, lon = found['latitude'], found['longitude']
        label = ', '.join(part for part in (found.get('name'), found.get('admin1'), found.get('country')) if part)
    else:
        raise LiveInfoError('Tell me the city, or turn location on for the weather where you are.')

    data = await _get(FORECAST_URL, {
        'latitude': lat, 'longitude': lon,
        'current': 'temperature_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m',
        'temperature_unit': 'fahrenheit', 'wind_speed_unit': 'mph', 'timezone': 'auto',
    })
    current = data.get('current') or {}
    if 'temperature_2m' not in current:
        raise LiveInfoError('I could not get a current weather report right now.')
    condition = WEATHER_CODES.get(current.get('weather_code'), 'unknown conditions')
    temp = round(current['temperature_2m'])
    feels = round(current.get('apparent_temperature', current['temperature_2m']))
    wind = round(current.get('wind_speed_10m', 0))
    rain = current.get('precipitation', 0)
    extra = f', with {rain:g} millimeters of precipitation' if rain else ''
    return f'In {label}, it is {temp} degrees Fahrenheit and {condition}. It feels like {feels}, with wind around {wind} miles per hour{extra}.'
