"""Walking directions with Google Maps when configured, OpenStreetMap otherwise.

Place search and addresses come from Nominatim, walking routes from the public
OSRM foot router. Distances here are map distances, so they may be spoken —
unlike anything estimated from the camera.

A route says where to walk. It never says that a street is safe to cross.
"""
from __future__ import annotations

import math
import os
import re
import time

USER_AGENT = {'User-Agent': 'GuideBand-hackathon-demo/0.3'}
SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse'
ROUTE_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/{lon1},{lat1};{lon2},{lat2}'
GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places:searchText'
GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

SEARCH_RADIUS_DEG = 0.035   # roughly 3-4 km around the user
ANNOUNCE_WITHIN_M = 25      # speak a turn when this close to it
ARRIVE_WITHIN_M = 30

# Spoken phrases mapped to a search term Nominatim understands.
CATEGORIES = {
    'supermarket': 'supermarket', 'grocery': 'supermarket', 'groceries': 'supermarket', 'store': 'supermarket',
    'pharmacy': 'pharmacy', 'drugstore': 'pharmacy', 'coffee': 'cafe', 'cafe': 'cafe',
    'restaurant': 'restaurant', 'bank': 'bank', 'atm': 'atm', 'hospital': 'hospital',
    'park': 'park', 'bus': 'bus stop', 'toilet': 'toilets', 'restroom': 'toilets', 'bathroom': 'toilets',
}
DESTINATION = re.compile(
    r"(?:\bto\b|\bnearest\b|\bclosest\b|\bfind\b)\s+(?:the |a |an |my )?(?:nearest |closest )?(.+?)[\s.?!]*$"
)


class NavigationError(Exception):
    pass


# ---------- Pure helpers ----------

def haversine(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distance in metres between two coordinates."""
    radius = 6371000.0
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lon2 - lon1) / 2) ** 2
    return 2 * radius * math.asin(math.sqrt(a))


def spoken_distance(metres: float) -> str:
    feet = metres * 3.281
    if feet < 75:
        return 'a few steps'
    if feet < 1000:
        return f'{int(round(feet / 50) * 50)} feet'
    miles = feet / 5280
    return f'{miles:.1f} miles' if round(miles, 1) != 1.0 else '1 mile'


def spoken_minutes(seconds: float) -> str:
    minutes = max(1, round(seconds / 60))
    if minutes >= 90:  # a long walk reads better in hours
        hours = round(minutes / 60, 1)
        return f'{hours:g} hours'
    return f'{minutes} minute{"s" if minutes != 1 else ""}'


def compass(bearing: float) -> str:
    return ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'][round(bearing / 45) % 8]


def destination_query(text: str) -> tuple[str, str]:
    """What the user asked for -> (search term, spoken name)."""
    match = DESTINATION.search(text.lower().strip())
    wanted = (match.group(1) if match else text.lower()).strip()
    wanted = re.sub(r'^(nearest|closest)\s+', '', wanted)
    for word, term in CATEGORIES.items():
        if re.search(rf'\b{word}\b', wanted) and len(wanted.split()) <= 2:
            return term, term
    return wanted, wanted


def instruction(step: dict) -> str:
    """One OSRM step as a short spoken sentence."""
    maneuver = step.get('maneuver', {})
    kind, modifier = maneuver.get('type', ''), maneuver.get('modifier', '')
    name = step.get('name') or ''
    onto = f' onto {name}' if name else ''
    ahead = f' Then continue for {spoken_distance(step.get("distance", 0))}.'
    if kind == 'arrive':
        return 'You have arrived.'
    if kind == 'depart':
        heading = compass(maneuver.get('bearing_after', 0))
        return f'Head {heading}{" on " + name if name else ""} for {spoken_distance(step.get("distance", 0))}.'
    if modifier == 'uturn':
        return 'Turn around.' + ahead
    if modifier == 'straight' or not modifier:
        return f'Continue straight{onto} for {spoken_distance(step.get("distance", 0))}.'
    turn = {'slight left': 'Bear left', 'slight right': 'Bear right',
            'sharp left': 'Turn sharp left', 'sharp right': 'Turn sharp right'}.get(modifier, f'Turn {modifier}')
    return f'{turn}{onto}.{ahead}'


def build_route(osrm: dict) -> dict:
    """Trim an OSRM response down to what gets spoken."""
    route = osrm['routes'][0]
    steps = []
    for step in route['legs'][0]['steps']:
        lon, lat = step['maneuver']['location']
        # Drop tiny connector steps so the user is not flooded with instructions.
        if steps and step['maneuver'].get('type') != 'arrive' and step.get('distance', 0) < 12:
            continue
        steps.append({'say': instruction(step), 'lat': lat, 'lon': lon, 'distance_m': step.get('distance', 0)})
    return {'distance_m': route['distance'], 'duration_s': route['duration'], 'steps': steps}


# ---------- Network ----------

async def _get(url: str, params: dict) -> object:
    import httpx
    async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=5.0), headers=USER_AGENT) as client:
        response = await client.get(url, params=params)
        response.raise_for_status()
        return response.json()


async def _find_osm_place(term: str, lat: float, lon: float) -> dict | None:
    """Nearest matching place around the user, or None."""
    r = SEARCH_RADIUS_DEG
    results = await _get(SEARCH_URL, {
        'format': 'jsonv2', 'q': term, 'limit': 20, 'bounded': 1,
        'viewbox': f'{lon - r},{lat + r},{lon + r},{lat - r}',
    })
    places = [
        {'name': item.get('name') or term, 'lat': float(item['lat']), 'lon': float(item['lon']),
         'distance_m': haversine(lat, lon, float(item['lat']), float(item['lon']))}
        for item in results
    ]
    return min(places, key=lambda place: place['distance_m']) if places else None


async def geocode(text: str, lat: float | None = None, lon: float | None = None) -> dict | None:
    """Coordinates for an address or place name, preferring results near the user. None when nothing matches."""
    params = {'format': 'jsonv2', 'q': text, 'limit': 1}
    if lat is not None and lon is not None:
        r = 0.5  # prefer the user's own region, without excluding the rest of the world
        params['viewbox'] = f'{lon - r},{lat + r},{lon + r},{lat - r}'
    results = await _get(SEARCH_URL, params)
    if not results:
        return None
    best = results[0]  # the map service's best match; the viewbox above already favours the user's region
    label = ', '.join(part.strip() for part in best.get('display_name', text).split(',')[:3])
    return {'label': label, 'lat': float(best['lat']), 'lon': float(best['lon'])}


async def _find_osm_route(lat: float, lon: float, dest_lat: float, dest_lon: float) -> dict:
    data = await _get(ROUTE_URL.format(lon1=lon, lat1=lat, lon2=dest_lon, lat2=dest_lat),
                      {'steps': 'true', 'overview': 'false'})
    if data.get('code') != 'Ok' or not data.get('routes'):
        raise NavigationError('No walking route was found.')
    return build_route(data)


def _google_headers(field_mask: str) -> dict[str, str]:
    key = os.getenv('GOOGLE_MAPS_API_KEY', '')
    if not key:
        raise NavigationError('Google Maps is not configured.')
    return {'Content-Type': 'application/json', 'X-Goog-Api-Key': key, 'X-Goog-FieldMask': field_mask}


async def _google_post(url: str, payload: dict, field_mask: str) -> dict:
    import httpx
    async with httpx.AsyncClient(timeout=httpx.Timeout(12.0, connect=5.0)) as client:
        response = await client.post(url, headers=_google_headers(field_mask), json=payload)
        response.raise_for_status()
        return response.json()


async def _find_google_place(term: str, lat: float, lon: float) -> dict | None:
    data = await _google_post(GOOGLE_PLACES_URL, {
        'textQuery': term,
        'locationBias': {'circle': {'center': {'latitude': lat, 'longitude': lon}, 'radius': 5000.0}},
        'maxResultCount': 10,
    }, 'places.displayName,places.location')
    places = []
    for item in data.get('places', []):
        point = item.get('location', {})
        if 'latitude' in point and 'longitude' in point:
            places.append({'name': item.get('displayName', {}).get('text') or term,
                           'lat': float(point['latitude']), 'lon': float(point['longitude'])})
    if not places:
        return None
    for place in places:
        place['distance_m'] = haversine(lat, lon, place['lat'], place['lon'])
    return min(places, key=lambda place: place['distance_m'])


def _seconds(value: str | int | float | None) -> float:
    try:
        return float(str(value or '0').removesuffix('s'))
    except ValueError:
        return 0.0


async def _find_google_route(lat: float, lon: float, dest_lat: float, dest_lon: float) -> dict:
    fields = ('routes.distanceMeters,routes.duration,routes.polyline.encodedPolyline,'
              'routes.legs.steps.navigationInstruction.instructions,routes.legs.steps.startLocation,'
              'routes.legs.steps.distanceMeters,routes.legs.steps.staticDuration')
    data = await _google_post(GOOGLE_ROUTES_URL, {
        'origin': {'location': {'latLng': {'latitude': lat, 'longitude': lon}}},
        'destination': {'location': {'latLng': {'latitude': dest_lat, 'longitude': dest_lon}}},
        'travelMode': 'WALK', 'languageCode': 'en-US', 'computeAlternativeRoutes': False,
    }, fields)
    routes = data.get('routes', [])
    if not routes:
        raise NavigationError('No walking route was found.')
    route = routes[0]
    steps = []
    for step in route.get('legs', [{}])[0].get('steps', []):
        point = step.get('startLocation', {}).get('latLng', {})
        words = step.get('navigationInstruction', {}).get('instructions', '')
        if 'latitude' not in point or 'longitude' not in point or not words:
            continue
        distance = float(step.get('distanceMeters', 0))
        if steps and distance < 12:
            continue
        steps.append({'say': f'{words}.', 'lat': float(point['latitude']), 'lon': float(point['longitude']),
                      'distance_m': distance})
    return {'distance_m': float(route.get('distanceMeters', 0)), 'duration_s': _seconds(route.get('duration')),
            'steps': steps, 'polyline': route.get('polyline', {}).get('encodedPolyline', ''), 'provider': 'google'}


async def find_place(term: str, lat: float, lon: float) -> dict | None:
    if os.getenv('GOOGLE_MAPS_API_KEY'):
        try:
            found = await _find_google_place(term, lat, lon)
            if found is not None:
                return found
        except Exception:
            pass
    return await _find_osm_place(term, lat, lon)


async def find_route(lat: float, lon: float, dest_lat: float, dest_lon: float) -> dict:
    if os.getenv('GOOGLE_MAPS_API_KEY'):
        try:
            return await _find_google_route(lat, lon, dest_lat, dest_lon)
        except NavigationError:
            raise
        except Exception:
            pass
    route = await _find_osm_route(lat, lon, dest_lat, dest_lon)
    route['provider'] = 'openstreetmap'
    return route


_places: dict[tuple[float, float], str] = {}


async def place_name(lat: float, lon: float) -> str:
    """Short human name for a coordinate, e.g. '20th Street, Dogpatch'. Empty on failure."""
    key = (round(lat, 3), round(lon, 3))  # about a city block
    if key not in _places:
        try:
            data = await _get(REVERSE_URL, {'format': 'jsonv2', 'lat': lat, 'lon': lon, 'zoom': 17})
            address = data.get('address', {})
            parts = [address.get('road'), address.get('neighbourhood') or address.get('suburb')]
            _places[key] = ', '.join(part for part in parts if part)
        except Exception:
            return ''
    return _places[key]


async def address(lat: float, lon: float) -> str:
    """Street address for a coordinate, e.g. '560 20th Street, Dogpatch, San Francisco'. Empty on failure."""
    try:
        data = await _get(REVERSE_URL, {'format': 'jsonv2', 'lat': lat, 'lon': lon, 'zoom': 18})
    except Exception:
        return ''
    found = data.get('address', {})
    street = ' '.join(part for part in [found.get('house_number'), found.get('road')] if part)
    place = data.get('name') if data.get('name') and data.get('name') != found.get('road') else ''
    parts = [place, street, found.get('neighbourhood') or found.get('suburb'), found.get('city') or found.get('town')]
    return ', '.join(part for part in parts if part)


# ---------- Guidance ----------

class Navigator:
    """Holds one active route per session and decides what to say as the user moves."""

    def __init__(self, find_place=find_place, find_route=find_route) -> None:
        self._find_place, self._find_route = find_place, find_route
        self._active: dict[str, dict] = {}

    def active(self, session: str) -> dict | None:
        return self._active.get(session)

    def stop(self, session: str) -> bool:
        return self._active.pop(session, None) is not None

    async def start(self, session: str, text: str, lat: float, lon: float) -> str:
        term, spoken = destination_query(text)
        try:
            place = await self._find_place(term, lat, lon)
        except Exception as error:
            raise NavigationError('I could not reach the map service. Please try again.') from error
        if place is None:
            raise NavigationError(f'I could not find {spoken} near you.')
        return await self.start_to(session, place['name'], lat, lon, place['lat'], place['lon'])

    async def start_to(self, session: str, name: str, lat: float, lon: float, dest_lat: float, dest_lon: float) -> str:
        try:
            route = await self._find_route(lat, lon, dest_lat, dest_lon)
        except NavigationError:
            raise
        except Exception as error:
            raise NavigationError('I could not reach the map service. Please try again.') from error
        self._active[session] = {'name': name, 'lat': dest_lat, 'lon': dest_lon, 'steps': route['steps'],
                                 'next': 1, 'started': time.time(), 'provider': route.get('provider', 'openstreetmap'),
                                 'polyline': route.get('polyline', '')}
        first = route['steps'][0]['say'] if route['steps'] else ''
        return (f'{name} is {spoken_distance(route["distance_m"])} away, about {spoken_minutes(route["duration_s"])} on foot. '
                f'{first} I will tell you each turn. Directions do not mean a crossing is safe.')

    def update(self, session: str, lat: float, lon: float) -> dict:
        """Call with each GPS fix. `say` is set only when there is something new to speak."""
        state = self._active.get(session)
        if state is None:
            return {'active': False, 'say': None}
        remaining = haversine(lat, lon, state['lat'], state['lon'])
        result = {'active': True, 'say': None, 'destination': state['name'], 'remaining': spoken_distance(remaining)}
        if remaining <= ARRIVE_WITHIN_M:
            del self._active[session]
            return {**result, 'active': False, 'say': f'You have arrived at {state["name"]}.'}
        steps, index = state['steps'], state['next']
        if index < len(steps) - 1:  # the last step is the arrival, handled above
            step = steps[index]
            if haversine(lat, lon, step['lat'], step['lon']) <= ANNOUNCE_WITHIN_M:
                state['next'] = index + 1
                result['say'] = step['say']
        return result
