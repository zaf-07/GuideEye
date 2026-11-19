"""The GuideBand assistant: one spoken sentence in, one spoken reply out.

`route` decides what the user wants with plain rules, so the safety-relevant
decisions (is this a payment? was that a yes?) never depend on a language model.
`Assistant.respond` then runs the matching tool: see, recall, remember, pay,
navigate or message.

Anything that leaves the device on the user's behalf — money or a message — is
first read back and held until the user answers yes.
"""
from __future__ import annotations

import re
import time
from urllib.parse import quote

from . import checkout, messaging, navigation, vision
from .memory import Memory
from .payments import Orders, PaymentError

YES = re.compile(r"^\W*(yes|yeah|yep|yup|sure|confirm|go ahead|do it|send( it)?|pay( it| now)?|okay|ok)\b[\w\s,.!']{0,22}$")
NO = re.compile(r"^\W*(no|nope|cancel|stop|not now|never mind|don't|do not)\b[\w\s,.!']{0,22}$")
TIMER = re.compile(r'\b(?:set|start|put|make) (?:a |an |the |me a )?(?:\w+ )?(?:timer|alarm|reminder)\b|\bremind me\b|\btimer for\b')
DURATION = re.compile(
    r'\b(half an?|an?|\d+|[a-z]+(?:[ -][a-z]+)?) (second|minute|hour)s?\b|\b(half) an (hour)\b'
)
NUMBER_WORDS = {
    'a': 1, 'an': 1, 'one': 1, 'two': 2, 'three': 3, 'four': 4, 'five': 5, 'six': 6, 'seven': 7, 'eight': 8, 'nine': 9,
    'ten': 10, 'eleven': 11, 'twelve': 12, 'thirteen': 13, 'fourteen': 14, 'fifteen': 15, 'sixteen': 16,
    'seventeen': 17, 'eighteen': 18, 'nineteen': 19, 'twenty': 20, 'thirty': 30, 'forty': 40, 'fifty': 50, 'sixty': 60,
}
UNIT_SECONDS = {'second': 1, 'minute': 60, 'hour': 3600}


def _number(words: str) -> float | None:
    words = words.strip().lower()
    if words.isdigit():
        return float(words)
    if words in ('half a', 'half an'):
        return 0.5
    total = 0
    for word in re.split(r'[ -]', words):
        if word not in NUMBER_WORDS:
            return None
        total += NUMBER_WORDS[word]
    return float(total) if total else None


def parse_duration(text: str) -> int | None:
    """Seconds in phrases like '15 minutes', 'fifteen minutes', 'twenty five minutes', 'half an hour'."""
    value = text.lower()
    for match in DURATION.finditer(value):
        if match.group(3):
            return 1800
        amount = _number(match.group(1))
        if amount is None:  # e.g. "in the next five minutes": try the last word alone
            amount = _number(match.group(1).split()[-1])
        if amount:
            return int(amount * UNIT_SECONDS[match.group(2)])
    return None


def spoken_duration(seconds: int) -> str:
    if seconds % 3600 == 0:
        count, unit = seconds // 3600, 'hour'
    elif seconds >= 60:
        count, unit = round(seconds / 60), 'minute'
    else:
        count, unit = seconds, 'second'
    return f'{count} {unit}{"s" if count != 1 else ""}'


def timer_label(text: str) -> str:
    """What the reminder is about: 'remind me to take my pills in ten minutes' -> 'take my pills'."""
    match = re.search(r'\bremind me (?:to |that |about )?(.+?)(?: in | after |$)', text, re.IGNORECASE)
    label = match.group(1).strip(' .,!?') if match else ''
    return label if label and not DURATION.search(label.lower()) else ''
FORGET = re.compile(r'\b(forget everything|(clear|delete|wipe|erase) (all )?(my |your )?memor(y|ies))\b')
REMEMBER = re.compile(r'^\W*(please )?remember\b|\bsave this\b|\bremember (this|that|where)\b')
PAY = re.compile(r'\b(buy|order|purchase|pay for|get me)\b')
SCAN_PAY = re.compile(r'\b(pay|scan|buy)\b.*\b(this|that|it|code|qr|bill|total)\b|\bscan (and|to) pay\b|^\W*pay\W*$')
RECALL = re.compile(
    r'\bwhere (did|have)\b|\bwhere (is|are|was|were) my\b|\bwhat did\b|\b(did|have) you seen?\b'
    r'|\bdo you remember\b|\blast (saw|seen)\b|\bwhat (do|did) you remember\b'
    r'|\bwhere (was|have) i\b|\bwhere did i go\b|\bwhat (did|have) i (ask|asked|say|said)\b'
)
WHERE = re.compile(r"\bwhere am i\b|\bwhat(?:'s| is) (around|near|nearby)( me)?\b|\bmy (current )?location\b|\bwhat street\b")
MESSAGE = re.compile(
    r'^\W*(?:please |can you |could you )*(tell|text|message|whatsapp|send|write)\s+(?:a (?:message|text|whatsapp) )?(?:to )?(?!me\b)'
    r'|\bshare my location\b|\b(?:send|write) (?:a )?(?:whatsapp |text )?message to\b'
)
LOOSE_MESSAGE = re.compile(r'\b(tell|text|message|whatsapp|write|send)\b')
PLACE_NAMES = {'home': 'home', 'house': 'home', 'work': 'work', 'office': 'work', 'school': 'school', 'dorm': 'dorm'}
_PLACE = r'(?:(home|house|work|office|school|dorm)(?: address| mattress| adress)?|address|adress)'
PLACE_SET = re.compile(
    r'\b(?:my ' + _PLACE + r' is(?: at| in)?'
    r'|(?:change|changing|set|update|make|save|put) my ' + _PLACE + r'(?: to| as| is| at)?'
    r'|i live (?:at|in|on))\s+(.+?)[\s.!?]*$'
)
PLACE_ASK = re.compile(r'\b(?:change|changing|set|update|save|edit) my ' + _PLACE + r'[\s.!?]*$')
# Words that lead into an address but are not part of it.
ADDRESS_LEAD = re.compile(r'^(?:(?:it is|it\'s|its|to|at|is|in|the address is|located in|located at)\s+)+', re.IGNORECASE)
PLACE_CHANGE_TTL_SECONDS = 120
# Chatter around an address: "Yeah. Yeah. Search it. <address>. Should be there."
_LEAD_FILLER = re.compile(r"^(?:yeah|yes|yep|no|nope|okay|ok|hello|hi|hey|now|please|thanks|thank you|search it|find it|change it|look it up|i said|i mean)[\s.,!?]*$", re.IGNORECASE)
_TAIL_FILLER = re.compile(r"^(?:(?:it )?should be there|i think|please|right now|thank you|thanks|that is it|that's it|okay|ok)[\s.,!?]*$", re.IGNORECASE)
# In the middle of confirming an address, these mean yes wherever they fall in a short reply.
CONFIRM_ANY = re.compile(r"\b(?:yes|yeah|yep|correct|right|save it|change it|do it|confirm|that's it|that is it)\b")


def spoken_place(text: str) -> str:
    """The place inside a spoken sentence, with the chatter before and after it removed."""
    parts = [part for part in re.split(r'(?<=[.!?])\s+', text.strip()) if part.strip()]
    while parts and _LEAD_FILLER.match(parts[0]):
        parts.pop(0)
    while parts and _TAIL_FILLER.match(parts[-1]):
        parts.pop()
    return ' '.join(parts).strip(' .!?,')
# An address has a number in it, or at least two real words (a place name).
ADDRESS_LIKE = re.compile(r'\d|[A-Za-z]{3,}\W+[A-Za-z]{3,}')
FILLER = re.compile(r"^(?:(?:can|could|would|will) you\b.*|please\b.*|get the\b.*|okay\b.*|um+\b.*|uh+\b.*|now\b.*|oh\b.*|i (?:said|mean)\b.*)$")
PLACE_LOOKUP_PROMPT = (
    'The text below was spoken aloud and transcribed, so words may be misheard and it may contain filler. '
    'Work out which real place or address is meant and give its full street address on one line, with city and state. '
    'Reply with the address only. If you do not know it, reply with the single word UNKNOWN.'
)
PLACE_GO = re.compile(
    r'\b(?:take|get|guide|walk|bring|lead) me (?:to )?(?:my )?(home|house|work|office|school|dorm)\b'
    r'|\b(?:directions?|route|way|go|going|head|navigate) (?:to )?(?:my )?(home|house|work|office|school|dorm)\b'
)
CALL = re.compile(r'\b(?:call|dial|phone)\s+(?:my\s+)?([a-z][a-z0-9 .-]{1,39})\b', re.IGNORECASE)
OPEN_APP = re.compile(r'^\W*(?:open|launch|start)\s+(?:the\s+)?(whatsapp|messages|maps|facetime|calendar)\b', re.IGNORECASE)
BRIDGE = re.compile(r'\bbridge\b')
NAV = re.compile(
    r'\b(take|guide|walk|navigate|lead|bring|get) me to\b|\b(directions?|route|way) to\b'
    r'|\bhow do i get to\b|\bnavigate to\b|\b(nearest|closest)\b'
)
NAV_STOP = re.compile(r'\b(stop|cancel|end) (the )?(navigation|directions|route|guiding)\b')
GO_BACK = re.compile(r'\b(take|guide|walk|lead|bring) me back\b|\bway back\b|\bgo back to (the )?start\b')
READ = re.compile(r'\bread\b|\bwhat does (it|that|this|the) .*\bsay\b|\bwhat is written\b')
READ_QUESTION = (
    'Read aloud every piece of text you can see in this image, word for word, starting with the largest. '
    'Say only the text itself. If there is no readable text, say that you cannot see any text.'
)
HELP = re.compile(r'\bwhat can you do\b|^\W*help\b')
GREETING = re.compile(r'^\W*(hi|hello|hey|good (morning|afternoon|evening)|howdy)\b')

HELP_TEXT = (
    'I can tell you what is in front of you, read text, remember where things are, tell you where you are, '
    'guide you on foot to a place nearby, message your family, and pay after you say yes. '
    'Try: what is in front of me?'
)
MESSAGE_TTL_SECONDS = 60


def route(text: str, has_pending: bool = False) -> str:
    value = text.lower().strip()
    if has_pending:
        if YES.search(value):
            return 'pay_confirm'
        if NO.search(value):
            return 'pay_cancel'
        return 'pay_waiting'
    if FORGET.search(value):
        return 'forget'
    if TIMER.search(value):
        return 'timer'
    if NAV_STOP.search(value):
        return 'nav_stop'
    if GO_BACK.search(value):
        return 'go_back'
    if PLACE_SET.search(value) or PLACE_ASK.search(value):
        return 'place_set'
    if PLACE_GO.search(value):
        return 'place_go'
    if WHERE.search(value):
        return 'where_am_i'
    if MESSAGE.search(value):
        return 'message'
    if CALL.search(value):
        return 'call'
    if OPEN_APP.search(value):
        return 'open_app'
    if NAV.search(value):
        return 'navigate'
    if SCAN_PAY.search(value):
        return 'scan_pay'
    if PAY.search(value):
        return 'pay_quote'
    if RECALL.search(value):
        return 'recall'
    if REMEMBER.search(value):
        return 'remember'
    if BRIDGE.search(value):
        return 'bridge'
    if HELP.search(value):
        return 'help'
    if GREETING.search(value):
        return 'greeting'
    if YES.search(value) or NO.search(value):
        return 'nothing_pending'
    return 'see'


def message_body(text: str) -> str:
    """The words to send, when the user dictated them: '... saying I am running late'."""
    match = re.search(r'\b(?:saying|that says|say|that)\b[\s,:]*(.+)$', text, re.IGNORECASE)
    body = match.group(1).strip(' .') if match else ''
    return '' if re.search(r'\bwhere i am\b|\bmy location\b', body, re.IGNORECASE) else body


class Assistant:
    def __init__(self, memory: Memory, orders: Orders, detector=None, navigator=None, place_name=None,
                 read_frame=None, send_whatsapp=None, send_desktop=None, geocode=None,
                 lookup_address=None) -> None:
        self.geocode = geocode or navigation.geocode
        self.lookup_address = lookup_address or self._lookup_address
        self.send_whatsapp = send_whatsapp or messaging.send_whatsapp
        self.send_desktop = send_desktop or messaging.send_desktop
        self.navigator = navigator or navigation.Navigator()
        self.place_name = place_name or navigation.place_name
        self.read_frame = read_frame or checkout.read_frame
        self.memory = memory
        self.orders = orders
        self.detector = detector or vision.detector
        self._messages: dict[str, dict] = {}
        self._calls: dict[str, dict] = {}
        self._place_changes: dict[str, dict] = {}

    def pending_message(self, session: str) -> dict | None:
        message = self._messages.get(session)
        if message and time.time() > message['expires']:
            del self._messages[session]
            return None
        return message

    async def respond(self, session: str, text: str, image: bytes | None = None, mime: str = 'image/jpeg',
                      location: tuple[float, float] | None = None) -> dict:
        order = self.orders.pending(session)
        message = self.pending_message(session)
        call = self._calls.get(session)
        change = self._place_changes.get(session)
        if change and time.time() > change['expires']:
            change = self._place_changes.pop(session, None) and None
        if change and not order and not message and not call:
            return await self._continue_place_change(session, change, text, location)
        intent = route(text, bool(order or message))
        if (intent in ('see', 'place_go', 'navigate', 'go_back', 'where_am_i', 'recall', 'help', 'timer')
                and LOOSE_MESSAGE.search(text.lower()) and self.memory.find_contact(text)):
            # "Message Zack that I am going home right now" names a contact, so it is a message, not a
            # request for directions home; so is "send my location to Tim".
            intent = 'message'
        if call and not order and not message:
            if YES.search(text.lower()):
                intent = 'call_confirm'
            elif NO.search(text.lower()):
                intent = 'call_cancel'
            else:
                intent = 'call_waiting'
        if message and not order:
            intent = intent.replace('pay_', 'message_')
        reply = {'intent': intent, 'heard': text, 'say': '', 'order': None, 'confirm': None, 'open_url': None,
                 'map_url': None, 'timer': None,
                 'warnings': [], 'detections': [], 'provider': None}
        if not intent.endswith(('_confirm', '_cancel', '_waiting')) and intent not in ('forget', 'nothing_pending', 'recall'):
            self.memory.add_note('asked', f'I asked: "{text}"')

        if intent == 'pay_quote':
            self._quote(reply, self.orders.quote(session, text))
        elif intent == 'scan_pay':
            await self._scan_pay(reply, session, image, mime)
        elif intent == 'pay_confirm':
            try:
                receipt = await self.orders.confirm(session)
                reply['order'] = receipt
                note = ' This was a simulated payment.' if receipt['mode'] == 'simulated' else ' Paid in Stripe test mode.'
                reply['say'] = f'Done. I paid {receipt["price"]} for {receipt["item"]}.{note}'
                self.memory.add_note('purchase', f'Bought {receipt["item"]} for {receipt["price"]}.')
            except PaymentError as error:
                reply['say'] = str(error)
        elif intent == 'pay_cancel':
            self.orders.cancel(session)
            reply['say'] = 'Cancelled. Nothing was paid.'
        elif intent == 'pay_waiting':
            reply['order'] = order
            reply['confirm'] = f'Pay {order["price"]} for {order["item"]}?'
            reply['say'] = f'I am waiting for a yes or no: {order["item"]} for {order["price"]}.'
        elif intent == 'message':
            await self._compose_message(reply, session, text, location)
        elif intent == 'message_confirm':
            del self._messages[session]
            await self._send_message(reply, message)
        elif intent == 'message_cancel':
            del self._messages[session]
            reply['say'] = 'Cancelled. Nothing was sent.'
        elif intent == 'message_waiting':
            reply['confirm'] = f'Send to {message["name"]} on WhatsApp?'
            reply['say'] = f'I am waiting for a yes or no on the message to {message["name"]}.'
        elif intent == 'call':
            await self._prepare_call(reply, session, text)
        elif intent == 'call_confirm':
            contact = self._calls.pop(session)
            reply['open_url'] = f'tel:{contact["phone"]}'
            reply['say'] = f'Calling {contact["name"]}.'
        elif intent == 'call_cancel':
            self._calls.pop(session, None)
            reply['say'] = 'Cancelled. I will not call anyone.'
        elif intent == 'call_waiting':
            reply['confirm'] = f'Call {call["name"]}?'
            reply['say'] = f'I am waiting for a yes or no before calling {call["name"]}.'
        elif intent == 'open_app':
            self._open_app(reply, text)
        elif intent == 'nothing_pending':
            reply['say'] = 'There is nothing waiting for your answer.'
        elif intent == 'forget':
            self.memory.clear()
            reply['say'] = 'Done. I have erased everything I remembered.'
        elif intent == 'recall':
            answer = await self.memory.recall(text)
            reply.update(say=answer['text'], provider=answer['provider'])
        elif intent == 'where_am_i':
            await self._where(reply, image, mime, location)
        elif intent == 'place_set':
            await self._start_place_change(reply, session, text, location)
        elif intent == 'timer':
            self._timer(reply, text)
        elif intent == 'place_go':
            before = self.navigator.active(session)
            reply['say'] = await self._go_to_place(session, text, location)
            reply['navigating'] = self.navigator.active(session) is not None
            reply['map_url'] = self._map_url(session, location, before)
        elif intent == 'nav_stop':
            reply['say'] = 'Navigation stopped.' if self.navigator.stop(session) else 'No navigation is running.'
        elif intent in ('navigate', 'go_back'):
            before = self.navigator.active(session)
            reply['say'] = await self._navigate(session, intent, text, location)
            reply['navigating'] = self.navigator.active(session) is not None
            reply['map_url'] = self._map_url(session, location, before)
        elif intent == 'bridge':
            reply['say'] = 'Bridge is on. I will speak signs I can read, and show what you say as large text.'
        elif intent == 'help':
            reply['say'] = HELP_TEXT
        elif intent == 'greeting':
            reply['say'] = 'Hello! I am GuideBand. I can describe what is in front of you, navigate, read text, or remember your items.'
        elif image is None:
            reply['say'] = 'I need the camera for that. Please turn the camera on.'
        else:
            place = await self.place_name(*location) if location else ''
            await self._look(reply, intent, text, image, mime, place)
        return reply

    # ----- pay -----

    def _quote(self, reply: dict, order: dict | None) -> None:
        if order is None:
            reply['say'] = 'I could not find a price for that, so I will not pay for it.'
            return
        reply['order'] = order
        reply['confirm'] = f'Pay {order["price"]} for {order["item"]}?'
        reply['say'] = f'{order["item"].capitalize()} for {order["price"]}. Say yes to pay, or no to cancel.'

    async def _scan_pay(self, reply: dict, session: str, image: bytes | None, mime: str) -> None:
        if image is None:
            reply['say'] = 'I need the camera to read the price. Please turn the camera on.'
            return
        found = await self.read_frame(image, mime)
        if found is None:
            reply['say'] = 'I cannot read a payment code or a clear price. Hold it closer and try again. Nothing was paid.'
            return
        item, cents, source = found
        try:
            order = self.orders.quote_item(session, item, cents)
        except PaymentError as error:
            reply['say'] = str(error)
            return
        self._quote(reply, order)
        reply['say'] = ('I scanned a payment code. ' if source == 'qr' else 'I read the price. ') + reply['say']

    # ----- message -----

    async def _compose_message(self, reply: dict, session: str, text: str, location: tuple[float, float] | None) -> None:
        contact = self.memory.find_contact(text)
        if contact is None:
            names = [item['name'] for item in self.memory.contacts()]
            known = ' Your contacts are ' + ', '.join(names) + '.' if names else ' You have no contacts yet: add them in the Family tab.'
            reply['say'] = 'I did not catch who to message.' + known + ' Say, for example: tell ' + (names[0] if names else 'Mom') + ' where I am.'
            return
        body = message_body(text)
        if not body:
            if location is None:
                reply['say'] = 'I need your location to share it. Please turn location on.'
                return
            place = await self.place_name(*location)
            body = (f'I am near {place}. ' if place else 'Here is where I am. ') + \
                   f'Map: https://maps.google.com/?q={location[0]:.5f},{location[1]:.5f} (sent with GuideBand)'
        self._messages[session] = {
            'name': contact['name'], 'phone': contact['phone'], 'text': body, 'expires': time.time() + MESSAGE_TTL_SECONDS,
            'url': f'https://wa.me/{contact["phone"]}?text={quote(body)}',
        }
        reply['confirm'] = f'Send to {contact["name"]} on WhatsApp?'
        spoken = body.split(' Map:')[0]
        reply['say'] = f'Message to {contact["name"]}: {spoken} Say yes to send, or no to cancel.'

    async def _prepare_call(self, reply: dict, session: str, text: str) -> None:
        match = CALL.search(text)
        name = match.group(1).strip() if match else ''
        contact = self.memory.find_contact(name)
        if contact is None:
            reply['say'] = f'I do not have {name or "that person"} in your contacts. Add them in the Family tab first.'
            return
        self._calls[session] = contact
        reply['confirm'] = f'Call {contact["name"]}?'
        reply['say'] = f'I found {contact["name"]}. Say yes to call, or no to cancel.'

    def _open_app(self, reply: dict, text: str) -> None:
        match = OPEN_APP.search(text)
        app = match.group(1).lower() if match else ''
        urls = {
            'whatsapp': 'whatsapp://',
            'messages': 'sms:',
            'maps': 'maps://',
            'facetime': 'facetime://',
            'calendar': 'ical://',
        }
        url = urls.get(app)
        if url is None:
            reply['say'] = 'I can only open WhatsApp, Messages, Maps, FaceTime, or Calendar.'
            return
        reply['open_url'] = url
        reply['say'] = f'Opening {app.capitalize()}.'

    async def _send_message(self, reply: dict, message: dict) -> None:
        """The user said yes. Deliver directly when a message service is set up; otherwise open WhatsApp."""
        if messaging.configured():
            try:
                await self.send_whatsapp(message['phone'], message['text'])
                reply['say'] = f'Sent to {message["name"]} on WhatsApp.'
                self.memory.add_note('message', f'Sent {message["name"]} a WhatsApp message: "{message["text"]}"')
                return
            except messaging.MessageError:
                pass  # fall back to the options below
        if messaging.desktop_enabled() and await self.send_desktop(message['phone'], message['text']):
            reply['say'] = f'Sent to {message["name"]} on WhatsApp.'
            self.memory.add_note('message', f'Sent {message["name"]} a WhatsApp message: "{message["text"]}"')
            return
        reply['open_url'] = message['url']
        reply['say'] = f'Your message to {message["name"]} is ready in WhatsApp.'
        self.memory.add_note('message', f'Prepared a WhatsApp message for {message["name"]}: "{message["text"]}"')

    # ----- where, navigate, look -----

    async def _where(self, reply: dict, image: bytes | None, mime: str, location: tuple[float, float] | None) -> None:
        parts = []
        if location is not None:
            address = await navigation.address(*location)
            parts.append(f'You are at {address}.' if address else 'I have your GPS position, but could not look up the address.')
        else:
            parts.append('I do not have your location. Turn location on for the address.')
        if image is not None:
            import asyncio
            detections = await asyncio.to_thread(self.detector.detect, image)
            answer = await vision.describe(image, mime, 'Briefly describe my surroundings: what kind of place is this and what is around me?', detections)
            parts.append(answer['text'])
            reply.update(detections=detections, provider=answer['provider'])
        reply['say'] = ' '.join(parts)
        if location is not None:
            self.memory.add_note('place', reply['say'])

    async def resolve_place(self, wanted: str, location: tuple[float, float] | None) -> dict | None:
        """Coordinates for an address or a place name.

        Street addresses go straight to the map. A place name the map does not really know (it answers with
        something that merely sounds similar) is first turned into a street address by the language model.
        """
        near = location or (None, None)
        found = await self.geocode(wanted, *near)
        if re.search(r'\d', wanted):  # looks like a street address: trust the map
            return found
        words = [w for w in re.findall(r'[a-z]+', wanted.lower()) if len(w) > 3]
        label = (found or {}).get('label', '').lower()
        matched = sum(1 for w in words if w in label)
        if found is not None and words and matched / len(words) >= 0.6:
            return found
        address = await self.lookup_address(wanted)
        if address:
            better = await self.geocode(address, *near)
            if better is not None:
                name = spoken_place(wanted)
                label = f'{name.title()} ({better["label"]})' if name and len(name.split()) <= 5 else better['label']
                return {**better, 'label': label}
        return found

    @staticmethod
    async def _lookup_address(place: str) -> str:
        """Ask the language model for a place's street address. Empty when it does not know."""
        from . import llm
        if not llm.configured():
            return ''
        try:
            answer = (await llm.complete([{'text': f'Place: {place}'}], system=PLACE_LOOKUP_PROMPT)).strip()
        except Exception:
            return ''
        return '' if 'UNKNOWN' in answer.upper() or len(answer) > 160 else answer.splitlines()[0]

    # ----- changing a saved address: ask, read back, confirm -----
    # Speech recognition mangles names and cuts addresses in two, so nothing is saved until the
    # user has heard what was found and said yes.

    async def _start_place_change(self, reply: dict, session: str, text: str, location: tuple[float, float] | None) -> None:
        """'My home address is ...', 'change my home address to ...', 'I live at ...', or just 'change my home address'."""
        value = text.lower().strip()
        asked, match = PLACE_ASK.search(value), PLACE_SET.search(value)
        if asked:  # "change my home address", with nothing after it
            name, address = PLACE_NAMES[asked.group(1) or 'home'], ''
        else:
            name = PLACE_NAMES[match.group(1) or match.group(2) or 'home']
            address = text.strip()[match.start(3):].strip(' .!?')
        change = {'name': name, 'stage': 'address', 'found': None, 'expires': time.time() + PLACE_CHANGE_TTL_SECONDS}
        self._place_changes[session] = change
        if len(address) < 3:
            reply['say'] = f'What is your {name} address? Say the street number, the street and the city.'
            return
        await self._offer_place(reply, change, address, location)

    async def _offer_place(self, reply: dict, change: dict, address: str, location: tuple[float, float] | None) -> None:
        """Look the address up and read it back for a yes or no."""
        name = change['name']
        change['expires'] = time.time() + PLACE_CHANGE_TTL_SECONDS
        change['query'] = address  # remembered, so the rest of a cut-off address can be added to it
        try:
            found = await self.resolve_place(address, location)
        except Exception:
            found = None
        if found is None:
            change['stage'] = 'address'
            reply['say'] = f'I could not find "{address}" on the map. Say the address again, with the street number and the city.'
            return
        change.update(stage='confirm', found=found)
        reply['confirm'] = f'Save {found["label"]} as your {name}?'
        reply['say'] = f'I found {found["label"]}. Should I save it as your {name}? Say yes, or say the address again.'

    async def _continue_place_change(self, session: str, change: dict, text: str, location: tuple[float, float] | None) -> dict:
        reply = {'intent': 'place_set', 'heard': text, 'say': '', 'order': None, 'confirm': None, 'open_url': None,
                 'map_url': None, 'timer': None, 'warnings': [], 'detections': [], 'provider': None}
        value, name = text.lower().strip(), change['name']
        short_yes = len(value.split()) <= 6 and CONFIRM_ANY.search(value) and not re.search(r'\d', value) and not NO.search(value)
        if change['stage'] == 'confirm' and (YES.search(value) or short_yes):
            found = change['found']
            self.memory.save_place(name, found['label'], found['lat'], found['lon'])
            del self._place_changes[session]
            reply['intent'] = 'place_saved'
            reply['say'] = f'Saved. Your {name} is {found["label"]}. Say "take me {name}" for directions.'
        elif NO.search(value):
            if change['stage'] == 'confirm':
                change.update(stage='address', found=None, expires=time.time() + PLACE_CHANGE_TTL_SECONDS)
                reply['say'] = 'Okay, not saved. Say the address again, with the street number and the city. Or say cancel.'
            else:
                del self._place_changes[session]
                reply['intent'] = 'place_cancel'
                reply['say'] = f'Okay. Your {name} address is unchanged.'
        else:
            match = PLACE_SET.search(value)
            other = route(text)
            if not match and other not in ('see', 'nothing_pending', 'place_set'):
                # A different request ("take me to the supermarket"): leave the address alone and do that instead.
                del self._place_changes[session]
                return await self.respond(session, text, None, 'image/jpeg', location)
            address = text.strip()[match.start(3):].strip(' .!?') if match else text.strip(' .!?')
            address = ADDRESS_LEAD.sub('', spoken_place(address) or address).strip()  # drop chatter and lead-in words
            # A word or two right after an offer is the end of the same address, cut off by a pause:
            # "San Francisco Bay" ... "University".
            if (change['stage'] == 'confirm' and change.get('query') and not match
                    and len(address.split()) <= 3 and not re.search(r'\d', address)):
                address = f"{change['query']} {address}"
            if not ADDRESS_LIKE.search(address) or FILLER.match(address.lower()):
                # A stray fragment ("can you please", "get the") is not an address: do not look it up.
                change['misses'] = change.get('misses', 0) + 1
                if change['misses'] >= 3:
                    del self._place_changes[session]
                    reply['intent'] = 'place_cancel'
                    reply['say'] = f'I will leave your {name} address as it is. Say "change my {name} address" to try again.'
                else:
                    reply['say'] = 'Say the address: the street number, the street and the city. Or say cancel.'
                return reply
            await self._offer_place(reply, change, address, location)
        return reply

    async def _go_to_place(self, session: str, text: str, location: tuple[float, float] | None) -> str:
        match = PLACE_GO.search(text.lower().strip())
        name = PLACE_NAMES[match.group(1) or match.group(2)]
        place = self.memory.place(name)
        if place is None:
            return f'I do not know your {name} address yet. Say: my {name} address is, followed by the address.'
        if location is None:
            return 'I need your location for directions. Please turn location on.'
        try:
            return await self.navigator.start_to(session, f'Your {name}', *location, place['lat'], place['lon'])
        except navigation.NavigationError as error:
            return str(error)

    def _timer(self, reply: dict, text: str) -> None:
        seconds = parse_duration(text)
        if seconds is None:
            reply['say'] = 'For how long? Say, for example: set a timer for ten minutes.'
            return
        if seconds > 24 * 3600:
            reply['say'] = 'I can only set timers of up to a day.'
            return
        label = timer_label(text)
        reply['timer'] = {'seconds': seconds, 'label': label}
        about = f' to {label}' if label else ''
        reply['say'] = f'Timer set for {spoken_duration(seconds)}. I will remind you{about}.'

    def _map_url(self, session: str, location: tuple[float, float] | None, before: dict | None = None) -> str | None:
        """A Google Maps walking route to the place being navigated to, for anyone who wants to see it."""
        active = self.navigator.active(session)
        if active is None or location is None or active is before:
            return None
        return ('https://www.google.com/maps/dir/?api=1&travelmode=walking'
                f'&origin={location[0]:.6f},{location[1]:.6f}&destination={active["lat"]:.6f},{active["lon"]:.6f}')

    async def _navigate(self, session: str, intent: str, text: str, location: tuple[float, float] | None) -> str:
        if location is None:
            return 'I need your location for directions. Please turn location on.'
        try:
            if intent == 'go_back':
                start = self.memory.trip_start()
                if start is None or navigation.haversine(*location, start['lat'], start['lon']) < 40:
                    return 'You are still close to where you started.'
                return await self.navigator.start_to(session, 'your starting point', *location, start['lat'], start['lon'])
            try:
                return await self.navigator.start(session, text, *location)
            except navigation.NavigationError:
                wanted = navigation.destination_query(text)[1]
                try:
                    found = await self.resolve_place(wanted, location)
                except Exception:
                    found = None
                if found is None:
                    raise
                return await self.navigator.start_to(session, found['label'], *location, found['lat'], found['lon'])
        except navigation.NavigationError as error:
            return str(error)

    async def _look(self, reply: dict, intent: str, text: str, image: bytes, mime: str, place: str = '') -> None:
        import asyncio
        detections = await asyncio.to_thread(self.detector.detect, image)
        self.memory.record_detections(detections)
        reply['detections'] = detections
        reply['warnings'] = vision.hazard_warnings(detections)
        if intent == 'remember':
            note = await self.memory.snapshot(image, mime, vision.local_description(detections), place)
            reply.update(say=f'I will remember this. {note["text"]}', provider=note['provider'])
            return
        if READ.search(text.lower()):
            # Reading is a different job from describing: ask for the words only, with no object hints.
            answer = await vision.describe(image, mime, READ_QUESTION, [])
        else:
            answer = await vision.describe(image, mime, text, detections)
        reply.update(say=answer['text'], provider=answer['provider'])
        if answer['provider'] != 'local':
            self.memory.add_note('seen', f'Answer to "{text}": {answer["text"]}', place=place)
