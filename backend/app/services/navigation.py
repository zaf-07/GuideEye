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

USER_AGENT = {'User-Agent': 'GuideEye-hackathon-demo/0.3'}
SEARCH_URL = 'https://nominatim.openstreetmap.org/search'
REVERSE_URL = 'https://nominatim.openstreetmap.org/reverse'
ROUTE_URL = 'https://routing.openstreetmap.de/routed-foot/route/v1/foot/{lon1},{lat1};{lon2},{lat2}'
GOOGLE_PLACES_URL = 'https://places.googleapis.com/v1/places:searchText'
GOOGLE_ROUTES_URL = 'https://routes.googleapis.com/directions/v2:computeRoutes'

SEARCH_RADIUS_DEG = 0.035   # roughly 3-4 km around the user
ANNOUNCE_WITHIN_M = 25      # speak a turn when this close to it
PREPARE_WITHIN_M = 70
PREPARE_BEYOND_M = 40
OFF_ROUTE_M = 40
OFF_ROUTE_FIXES = 2
REROUTE_EVERY_S = 20
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


def bearing(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    p1, p2, d = math.radians(lat1), math.radians(lat2), math.radians(lon2 - lon1)
    y = math.sin(d) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(d)
    return (math.degrees(math.atan2(y, x)) + 360) % 360


def relative_direction(heading: float, target: float) -> str:
    diff = (target - heading + 540) % 360 - 180
    if abs(diff) <= 25:
        return 'straight ahead'
    if abs(diff) >= 150:
        return 'behind you'
    side = 'right' if diff > 0 else 'left'
    return f'ahead to your {side}' if abs(diff) < 70 else f'to your {side}'


def distance_to_path(lat: float, lon: float, path: list[list[float]]) -> float:
    scale = math.cos(math.radians(lat))
    best = float('inf')
    for (lat1, lon1), (lat2, lon2) in zip(path, path[1:]):
        ax, ay, bx, by = (lon1 - lon) * scale, lat1 - lat, (lon2 - lon) * scale, lat2 - lat
        dx, dy = bx - ax, by - ay
        length = dx * dx + dy * dy
        t = 0.0 if length == 0 else min(1.0, max(0.0, -(ax * dx + ay * dy) / length))
        best = min(best, math.hypot(ax + t * dx, ay + t * dy) * 111320)
    return best


def short_action(say: str) -> str:
    action = say.split('. ')[0].rstrip('.')
    return action[0].lower() + action[1:] if action else action


TURN_WORDS = re.compile(r'\b(turn|bear|keep|slight|sharp|make a)\b[^.]*?\b(left|right)\b')


def turn_kind(say: str) -> str:
    text = say.lower().split('. ')[0]
    if 'arrived' in text:
        return 'arrive'
    if 'u-turn' in text or 'turn around' in text:
        return 'uturn'
    match = TURN_WORDS.search(text)
    if not match:
        return 'straight'
    return f'slight-{match.group(2)}' if match.group(1) in ('bear', 'keep', 'slight') else match.group(2)


def decode_polyline(encoded: str) -> list[list[float]]:
    points, index, lat, lon = [], 0, 0, 0
    try:
        while index < len(encoded):
            for axis in (0, 1):
                shift = result = 0
                while True:
                    value = ord(encoded[index]) - 63
                    index += 1
                    result |= (value & 0x1f) << shift
                    shift += 5
                    if value < 0x20:
                        break
                delta = ~(result >> 1) if result & 1 else result >> 1
                if axis == 0:
                    lat += delta
                else:
                    lon += delta
            points.append([lat / 1e5, lon / 1e5])
    except IndexError:
        pass
    return points


def destination_query(text: str) -> tuple[str, str]:
    """What the user asked for -> (search term, spoken name)."""
    match = DESTINATION.search(text.lower().strip())
    wanted = (match.group(1) if match else text.lower()).strip()
    wanted = re.sub(r'^(nearest|closest)\s+', '', wanted)
    # "a pharmacy open now", "a cafe near me": the place is the first words.
    for _ in range(2):
        wanted = re.sub(r"\s+(?:that is |that's |which is )?(?:open(?: right)? now|open|nearby|near me|near here|close by|around here|right now|please)$", '', wanted)
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
    path = [[lat, lon] for lon, lat in route.get('geometry', {}).get('coordinates', [])]
    return {'distance_m': route['distance'], 'duration_s': route['duration'], 'steps': steps, 'path': path}


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
                      {'steps': 'true', 'overview': 'full', 'geometries': 'geojson'})
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
        spoken = '. '.join(part.strip().rstrip('.') for part in words.splitlines() if part.strip())
        steps.append({'say': f'{spoken}.', 'lat': float(point['latitude']), 'lon': float(point['longitude']),
                      'distance_m': distance})
    if steps:
        steps.append({'say': 'You have arrived.', 'lat': dest_lat, 'lon': dest_lon, 'distance_m': 0.0})
    polyline = route.get('polyline', {}).get('encodedPolyline', '')
    return {'distance_m': float(route.get('distanceMeters', 0)), 'duration_s': _seconds(route.get('duration')),
            'steps': steps, 'polyline': polyline, 'path': decode_polyline(polyline), 'provider': 'google'}


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
                                 'polyline': route.get('polyline', ''), 'path': route.get('path') or [],
                                 'distance_m': route.get('distance_m', 0), 'fix': (lat, lon), 'heading': None,
                                 'warned': set(), 'off': 0, 'rerouted': 0.0}
        first = route['steps'][0]['say'] if route['steps'] else ''
        return (f'{name} is {spoken_distance(route["distance_m"])} away, about {spoken_minutes(route["duration_s"])} on foot. '
                f'{first} I will tell you each turn. Directions do not mean a crossing is safe.')

    @staticmethod
    def _track(state: dict, lat: float, lon: float, heading: float | None = None) -> None:
        last = state.get('fix')
        if heading is not None:
            state['heading'] = heading % 360
            state['fix'] = (lat, lon)
        elif last is None:
            state['fix'] = (lat, lon)
        elif haversine(*last, lat, lon) >= 5:
            state['heading'] = bearing(*last, lat, lon)
            state['fix'] = (lat, lon)

    @staticmethod
    def _path(state: dict) -> list[list[float]]:
        if len(state.get('path') or []) >= 2:
            return state['path']
        return [[step['lat'], step['lon']] for step in state['steps']] + [[state['lat'], state['lon']]]

    @staticmethod
    def _next(state: dict, lat: float, lon: float) -> dict:
        steps, index = state['steps'], state['next']
        if index < len(steps) - 1:
            step = steps[index]
            say, kind, turn_lat, turn_lon = step['say'], turn_kind(step['say']), step['lat'], step['lon']
        else:
            say, kind, turn_lat, turn_lon = f'{state["name"]} is ahead.', 'arrive', state['lat'], state['lon']
        distance = haversine(lat, lon, turn_lat, turn_lon)
        heading = state.get('heading')
        relative = relative_direction(heading, bearing(lat, lon, turn_lat, turn_lon)) if heading is not None else ''
        return {'index': index, 'say': say, 'turn': kind, 'distance_m': round(distance),
                'distance': spoken_distance(distance), 'relative': relative, 'lat': turn_lat, 'lon': turn_lon}

    def update(self, session: str, lat: float, lon: float, heading: float | None = None) -> dict:
        """Call with each GPS fix. `say` is set only when there is something new to speak."""
        state = self._active.get(session)
        if state is None:
            return {'active': False, 'say': None}
        remaining = haversine(lat, lon, state['lat'], state['lon'])
        result = {'active': True, 'say': None, 'destination': state['name'], 'remaining': spoken_distance(remaining)}
        if remaining <= ARRIVE_WITHIN_M:
            del self._active[session]
            return {**result, 'active': False, 'say': f'You have arrived at {state["name"]}.', 'kind': 'arrive'}
        self._track(state, lat, lon, heading)
        steps, index = state['steps'], state['next']
        if index < len(steps) - 1:  # the last step is the arrival, handled above
            step = steps[index]
            away = haversine(lat, lon, step['lat'], step['lon'])
            if away <= ANNOUNCE_WITHIN_M:
                state['next'] = index + 1
                result.update(say=step['say'], kind='turn', say_turn=turn_kind(step['say']))
            elif PREPARE_BEYOND_M < away <= PREPARE_WITHIN_M and index not in state.setdefault('warned', set()):
                state['warned'].add(index)
                result.update(say=f'In {spoken_distance(away)}, {short_action(step["say"])}.', kind='prepare',
                              say_turn=turn_kind(step['say']))
        off = distance_to_path(lat, lon, self._path(state)) > OFF_ROUTE_M
        state['off'] = state.get('off', 0) + 1 if off else 0
        if state['off'] >= OFF_ROUTE_FIXES and not result['say']:
            result['off_route'] = True
        result.update(remaining_m=round(remaining), total_m=round(state.get('distance_m') or 0),
                      heading=state.get('heading'), next=self._next(state, lat, lon))
        return result

    async def follow(self, session: str, lat: float, lon: float, heading: float | None = None) -> dict:
        result = self.update(session, lat, lon, heading)
        state = self._active.get(session)
        if state is None or not result.get('off_route') or time.time() - state.get('rerouted', 0) < REROUTE_EVERY_S:
            return result
        state['rerouted'] = time.time()
        try:
            route = await self._find_route(lat, lon, state['lat'], state['lon'])
        except Exception:
            return {**result, 'say': 'You have left the route. I could not find a new one yet.', 'kind': 'off_route'}
        state.update(steps=route['steps'], next=1, path=route.get('path') or [], distance_m=route.get('distance_m', 0),
                     provider=route.get('provider', 'openstreetmap'), polyline=route.get('polyline', ''),
                     warned=set(), off=0)
        first = route['steps'][0]['say'] if route['steps'] else ''
        fresh = self.update(session, lat, lon, heading)
        return {**fresh, 'say': f'You have left the route. New directions. {first}'.strip(), 'kind': 'reroute',
                'say_turn': turn_kind(first), 'rerouted': True}

    def next_turn(self, session: str, lat: float, lon: float) -> str | None:
        state = self._active.get(session)
        if state is None:
            return None
        self._track(state, lat, lon)
        upcoming = self._next(state, lat, lon)
        remaining = spoken_distance(haversine(lat, lon, state['lat'], state['lon']))
        where = f' It is {upcoming["relative"]}.' if upcoming['relative'] else ''
        if upcoming['turn'] == 'arrive':
            return f'No more turns. {state["name"]} is {remaining} away.{where}'
        lead = 'Now' if upcoming['distance_m'] <= ANNOUNCE_WITHIN_M else f'In {upcoming["distance"]}'
        return f'{lead}, {short_action(upcoming["say"])}.{where} {remaining} to {state["name"]} in total.'

    def snapshot(self, session: str) -> dict:
        state = self._active.get(session)
        if state is None:
            return {'active': False}
        steps = [{'say': step['say'], 'turn': turn_kind(step['say']), 'lat': step['lat'], 'lon': step['lon'],
                  'distance_m': round(step.get('distance_m', 0))} for step in state['steps']]
        path = state.get('path') or [[step['lat'], step['lon']] for step in state['steps']] + [[state['lat'], state['lon']]]
        return {'active': True, 'destination': {'name': state['name'], 'lat': state['lat'], 'lon': state['lon']},
                'provider': state.get('provider', 'openstreetmap'), 'distance_m': round(state.get('distance_m') or 0),
                'next': state['next'], 'steps': steps, 'path': path}
