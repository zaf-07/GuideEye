"""The GuideEye assistant: one spoken sentence in, one spoken reply out.

`route` decides what the user wants with plain rules, so the safety-relevant
decisions (is this a payment? was that a yes?) never depend on a language model.
`Assistant.respond` then runs the matching tool: see, recall, remember, pay,
navigate or message.

Anything that leaves the device on the user's behalf — money or a message — is
first read back and held until the user answers yes.
"""
from __future__ import annotations

import json
import os
import re
import time
from collections import deque
from urllib.parse import quote

from . import checkout, errand, live_info, messaging, navigation, vision
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
    r'\bwhere (did|have)\b|\bwhere (is|are|was|were) (?:my|the|a|an)\b|\bwhat did\b|\b(did|have) you seen?\b'
    r'|\bwhat (?:was|were) (?:around|near|next to|beside|there)\b|\bwhat have you (?:seen|scanned|detected|noticed)\b'
    r'|\bwhat (?:objects|things) (?:did|have) you\b|\bwhen did (?:you|i) (?:last )?see\b|\bwhat else was\b'
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
CALL = re.compile(r'\b(?:call|dial|phone)(?!\s+call\b)\s+(?:my\s+)?([a-z][a-z0-9 .-]{1,39})\b', re.IGNORECASE)
CALL_REQUEST = re.compile(r'\b(?:make|place|start)\s+(?:a\s+)?(?:phone\s+)?call\b|\b(?:i want|i need|help me)\s+(?:to\s+)?call\b', re.IGNORECASE)
TRANSFER = re.compile(r'\btransfer\b|\b(?:send)\s+(?:money|cash|funds|dollars?)\b', re.IGNORECASE)
CONTACT_ADD = re.compile(
    r'\b(?:add|create|make|save|new)\s+(?:a\s+)?(?:new\s+)?(?:(?:phone|whatsapp)\s+)?contact\b'
    r'|\b(?:i want|i need)\s+(?:to\s+)?(?:add|create|make)\s+(?:a\s+)?(?:new\s+)?(?:(?:phone|whatsapp)\s+)?contact\b'
    r'|\b(?:add|save|create)\s+(?:my\s+)?[a-z][a-z .\'-]{0,35}(?:\'s)?\s+(?:phone|mobile|whatsapp)\s+number\b', re.IGNORECASE)
OPEN_APP = re.compile(r'^\W*(?:open|launch|start)\s+(?:the\s+)?(whatsapp|messages|maps|facetime|calendar)\b', re.IGNORECASE)
BRIDGE = re.compile(r'\bbridge\b')
NAV = re.compile(
    r'\b(take|guide|walk|navigate|lead|bring|get) me to\b|\b(directions?|route|way) to\b'
    r'|\bhow do i get to\b|\bnavigate to\b|\b(nearest|closest)\b'
)
# A complete street address is a useful spoken destination even when the
# person does not say "directions to" first.  Keep this deliberately strict:
# a house number followed by at least two words avoids treating short numbers
# and phone numbers as map searches.
DIRECT_ADDRESS = re.compile(r'^\s*\d{1,6}[\w-]*(?:\s+[a-z][a-z.\'-]*){2,}(?:\s*,?\s*[a-z][a-z .\'-]*)?\s*[.!?]?\s*$', re.IGNORECASE)
# "Find a pharmacy open now", "is there a cafe nearby", "where is the bathroom".
NEARBY_PLACE = re.compile(
    r"\b(?:find|locate|look for|where is|where's|is there|are there)\s+(?:me\s+)?(?:a |an |the |any )?(?:nearest |closest |nearby )?(?:"
    + '|'.join(sorted(navigation.CATEGORIES, key=len, reverse=True)) + r')\b'
)
NAV_NEXT = re.compile(
    r"\bwhich way\b|\b(where|when) do i (turn|go)\b|\bnext (turn|step|direction)\b|\b(do|should) i turn\b"
    r"|\bhow (far|much further|much longer)\b|\bam i (going|on) the right way\b"
    r"|\brepeat (the |that )?(directions?|turn|step)\b"
)
NAV_STOP = re.compile(r'\b(stop|cancel|end) (the )?(navigation|directions|route|guiding)\b')
GO_BACK = re.compile(r'\b(take|guide|walk|lead|bring) me back\b|\bway back\b|\bgo back to (the )?start\b')
READ = re.compile(r'\bread\b|\bwhat does (it|that|this|the) .*\bsay\b|\bwhat is written\b')
READ_QUESTION = (
    'Read aloud every piece of text you can see in this image, word for word, starting with the largest. '
    'Say only the text itself. If there is no readable text, say that you cannot see any text.'
)
ERRAND = re.compile(
    r"\b(?:letter|document|paperwork|form|invoice|bill|statement|discharge|prescription|contract|lease"
    r"|lab (?:result|chart|report)s?|test results?|visit (?:note|summary)|doctor'?s? note)\b"
    r"|\b(?:look up|research|find out)\b|\berrand\b"
    r"|\b(?:explain|summari[sz]e|summary)\b|\bhelp me understand\b"
    r"|\bwhat (?:do|should|must) i (?:need to |have to )?do\b|\bwhat does (?:this|that|it) (?:mean|ask|want)\b"
    r"|\btell me what (?:to do|i (?:need|have) to do|(?:this|that|it) (?:means|asks|wants))\b"
)
WEATHER = re.compile(r'\b(?:weather|forecast|temperature|will it rain|is it raining)\b', re.IGNORECASE)
WEB_LOOKUP = re.compile(
    r'\b(?:price of|how much (?:is|does)|what(?:\'s| is) (?:the )?(?:price|cost)|what does .+ cost|search (?:the )?(?:web|internet)|look (?:this|that|it) up online)\b',
    re.IGNORECASE,
)
ERRAND_STATUS = re.compile(r"\berrand\b|\b(?:is it|is that|are you) (?:ready|done|finished)\b|\bany (?:update|news)\b|\bstill working\b")
ERRAND_ASKS = re.compile(r"should i go ahead\?\s*$", re.IGNORECASE)
ERRAND_TTL_SECONDS = 900
# "Remember that my keys are on the kitchen table": a fact said aloud, no camera needed.
REMEMBER_FACT = re.compile(r"^\W*(?:please )?remember(?: that)?\s+(.+)$", re.IGNORECASE)
# Requests that are about what the camera sees.
CAMERA_REQUEST = re.compile(
    r"\bin front of me\b|\bahead of me\b|\b(?:see|look|describe|read|scan|show|camera)\b|\bwhat colou?r\b"
    r"|\bwhat(?:'s| is) (?:this|that|it)\b|\bwhat does (?:it|this|that)\b|\bwho is (?:this|that|here)\b"
)
CHAT_PROMPT = (
    'You are GuideEye, a voice assistant for a blind or low-vision person. '
    'Answer in one or two short sentences that sound natural when spoken aloud. '
    'You have no camera image for this request: never describe surroundings or invent facts about them. '
    'If the request needs the camera, say to turn the camera on and ask again. '
    'If the person says something is wrong or not working, ask one short question about what happened.'
)
UNKNOWN_REQUEST = 'I did not catch what you need. Say help to hear what I can do.'
HELP = re.compile(r'\bwhat can you do\b|^\W*help\b')
GREETING = re.compile(r'^\W*(hi|hello|hey|good (morning|afternoon|evening)|howdy)\b')

HELP_TEXT = (
    'I can tell you what is in front of you, read text, remember where things are, tell you where you are, '
    'recall what I saw earlier and what was around it, guide you on foot to a place nearby, message your family, '
    'rename or remove a contact, pay after you say yes, '
    'and run errands such as reading a letter and telling you what it asks for. '
    'Try: what is in front of me?'
)
MESSAGE_TTL_SECONDS = 60
CONTACT_TTL_SECONDS = 120
PHONE_WORDS = {'zero': '0', 'oh': '0', 'o': '0', 'one': '1', 'two': '2', 'three': '3', 'four': '4',
               'five': '5', 'six': '6', 'seven': '7', 'eight': '8', 'nine': '9'}


def spoken_phone(text: str) -> str:
    """Extract a 7+ digit phone number from digits or a dictated digit sequence."""
    direct = re.sub(r'\D', '', text)
    if len(direct) >= 7:
        return direct
    tokens = re.findall(r"[a-z]+|\d", text.lower())
    run, best = '', ''
    for token in tokens:
        digit = PHONE_WORDS.get(token, token if token.isdigit() else '')
        if digit:
            run += digit
        else:
            if len(run) > len(best): best = run
            run = ''
    best = best if len(best) >= len(run) else run
    return best if len(best) >= 7 else ''


# ----- changing saved contacts by voice -----
_ASK_LEAD = re.compile(
    r"^\W*(?:(?:hey|hi|ok|okay|please|guide|guideeye)[\s,]+)*"
    r"(?:(?:can|could|would|will) you (?:please )?|i (?:want|need|would like|wanna)(?: you)? to |i'd like(?: you)? to |please |let's )*",
    re.IGNORECASE)
_CONTACTS_LEAD = re.compile(
    r"^(?:go (?:in)?to|open|check|look (?:in|at)|pull up) (?:my |the )?contacts?(?: list| book)?[\s,]*(?:and (?:then )?|then )?",
    re.IGNORECASE)
_NAME_TAIL = re.compile(
    r"[\s,]+(?:please|thanks|thank you|for me|(?:in|from|on) (?:my |the )?contacts?(?: list| book)?)\W*$", re.IGNORECASE)
_NAME_LEAD = re.compile(r"^(?:(?:my|the|a|one of my) )?(?:contacts?\b ?)?(?:(?:named|called) )?", re.IGNORECASE)
_CHANGE = r"(?:change|update|edit|fix|correct|set|modify)"
_NUMBER = r"(?:phone |whatsapp |mobile |cell )?number"
_S = r"(?:'s|’s)"
PRONOUN_NAME = re.compile(r"^(?:him|her|them|it|that|that one|that person|that contact|the same (?:one|person|contact))$", re.IGNORECASE)
PRONOUN = re.compile(r"\b(?:him|her|them|that person|that contact|the same person)\b", re.IGNORECASE)
CONTACT_LIST = re.compile(
    r"\b(?:who(?:'s| is| are)|what(?:'s| is| are)|list|read|tell me|show|say|name)\b.*\bmy contacts?\b"
    r"|\bhow many contacts\b|\bdo i have (?:any )?contacts\b|\bwho (?:do i have|is saved)\b.*\bcontacts?\b", re.IGNORECASE)
_EDIT_FORMS = [
    ('number', re.compile(rf"^{_CHANGE} (?:the |my )?{_NUMBER} (?:of|for) (?P<name>.+?)(?: (?:to|as|into|with)\b.*)?$", re.IGNORECASE)),
    ('number', re.compile(rf"^{_CHANGE} (?P<name>.+?){_S} {_NUMBER}\b.*$", re.IGNORECASE)),
    ('rename', re.compile(r"^rename (?P<name>.+?) (?:to|as|into) (?P<new>.+)$", re.IGNORECASE)),
    ('rename', re.compile(
        rf"^{_CHANGE} (?:the |my )?(?:contact{_S}? )?name (?:of|for|from|on) (?P<name>.+?) (?:to|as|into) (?P<new>.+)$", re.IGNORECASE)),
    ('rename', re.compile(rf"^{_CHANGE} (?P<name>.+?){_S} (?:contact )?name (?:to|as|into) (?P<new>.+)$", re.IGNORECASE)),
    ('rename', re.compile(rf"^{_CHANGE} (?:my |the )?contact (?P<name>.+?) (?:to|as|into) (?P<new>.+)$", re.IGNORECASE)),
    ('rename', re.compile(rf"^{_CHANGE} (?:the |my |his |her |their |its )?(?:contact{_S}? )?name (?:to|as|into) (?P<new>.+)$", re.IGNORECASE)),
    ('rename', re.compile(r"^rename (?P<name>.+)$", re.IGNORECASE)),
    ('rename', re.compile(rf"^{_CHANGE} (?:the |my )?(?:contact{_S}? )?name (?:of|for|on) (?P<name>.+)$", re.IGNORECASE)),
    ('rename', re.compile(rf"^{_CHANGE} (?P<name>.+?){_S} (?:contact )?name$", re.IGNORECASE)),
    ('remove', re.compile(r"^(?:delete|remove|erase) (?:my |the )?contact (?P<name>.+)$", re.IGNORECASE)),
    ('remove', re.compile(r"^(?:delete|remove|erase) (?P<name>.+?) from (?:my |the )?contacts?(?: list| book)?$", re.IGNORECASE)),
    ('rename', re.compile(
        rf"^{_CHANGE} (?:a |my |the |one of my )?(?:contacts?{_S}?(?: list| names?| details| info| information)?|(?:contact )?name)$",
        re.IGNORECASE)),
]
NO_CONTACTS = 'You have no contacts yet. Say add a contact to save one.'
CONTACT_EDIT_TTL_SECONDS = 90
# Requests that end a half-finished contact change instead of being taken as a name.
LEAVES_CONTACT_EDIT = {'forget', 'timer', 'nav_stop', 'go_back', 'place_set', 'place_go', 'where_am_i', 'navigate',
                       'scan_pay', 'pay_quote', 'help', 'contact_add', 'contact_edit', 'errand', 'recall', 'bridge'}


def _clean_name(value: str) -> str:
    """A person's name out of a spoken fragment; empty when it is not a plausible name."""
    value = value.strip(" .,!?'\"")
    while _NAME_TAIL.search(value):
        value = _NAME_TAIL.sub('', value)
    value = _NAME_LEAD.sub('', value).strip(" .,!?'\"-")
    if not value or len(value) > 40 or len(value.split()) > 4 or not re.fullmatch(r"[A-Za-z][A-Za-z .'’-]*", value):
        return ''
    return ' '.join(word[:1].upper() + word[1:] for word in value.split())


def spoken_name(text: str) -> str:
    """The name in an answer to "what should the new name be?": 'Leo', 'call him Leo', 'it should be Leo'."""
    value = re.sub(
        r"^\W*(?:(?:please )?(?:call|name|rename|make|change|set) (?:it|him|her|them|that)(?: to| as)?"
        r"|it should be|it is|it's|(?:the )?new name (?:is|should be)|to|as|just)\s+", '', text.strip(), flags=re.IGNORECASE)
    return _clean_name(value)


def contact_edit(text: str) -> dict | None:
    """Recognise a request to rename, renumber, remove or list saved contacts.

    Returns {'kind', 'name', 'new_name', 'phone'}; a missing detail is an empty string and is asked for.
    """
    value = _ASK_LEAD.sub('', text.strip()).strip()
    value = _CONTACTS_LEAD.sub('', value).strip(' .,!?')
    if CONTACT_LIST.search(text) or re.fullmatch(r"(?:(?:my|the) )?contacts?(?: list)?", value, re.IGNORECASE):
        return {'kind': 'list', 'name': '', 'new_name': '', 'phone': ''}
    for kind, pattern in _EDIT_FORMS:
        match = pattern.match(value)
        if not match:
            continue
        found = match.groupdict()
        raw = (found.get('name') or '').strip()
        name = raw if PRONOUN_NAME.match(raw) else _clean_name(raw)
        new_name = _clean_name(found.get('new') or '')
        if found.get('name') and not name and kind != 'rename':
            continue
        if found.get('new') and not new_name:
            continue
        if kind == 'rename' and 'name' in found and not name and raw and not re.fullmatch(
                r"(?:(?:a|my|the|one of my) )?contacts?", raw, re.IGNORECASE):
            continue
        if kind == 'rename' and not name and not new_name and 'contact' not in value.lower() and 'name' not in value.lower():
            continue
        return {'kind': kind, 'name': name, 'new_name': new_name,
                'phone': spoken_phone(text) if kind == 'number' else ''}
    return None


UNDERSTAND_PROMPT = (
    'You work out what a blind or low-vision person wants from GuideEye, a voice assistant, when its fixed rules '
    'did not recognise the request. Reply with JSON only: {"action": "...", "command": "...", "say": "..."}.\n'
    'Actions:\n'
    '- "command": GuideEye can do this. Put the request in "command", rewritten as exactly one of the command '
    'forms below, filling in names and details from the conversation so far.\n'
    '- "look": answering needs the live camera view, for example what is ahead, a colour, or whether a door is open.\n'
    '- "recall": a question about what was seen, noted, said or left somewhere earlier. Put the whole question in '
    '"command", replacing words like "it", "that" or "there" with what they refer to in the conversation.\n'
    '- "ask": it is a command, but a detail GuideEye needs is missing or unclear. Put one short question in "say".\n'
    '- "answer": anything else, such as small talk or a general question. Put one or two short spoken sentences in '
    '"say". Never describe surroundings, and never say an action was done.\n'
    'Command forms:\n'
    'rename contact NAME to NEW NAME | delete contact NAME | list my contacts | change the number for NAME to DIGITS | '
    'add a contact named NAME number DIGITS | call NAME | tell NAME that MESSAGE | tell NAME where I am | '
    'take me to PLACE | take me home | stop navigation | where am I | set a timer for N minutes | '
    'change my home address to ADDRESS | remember that FACT | buy ITEM | open whatsapp | open maps | help\n'
    'Use only contact names from the saved contacts list. Never invent a name, number, address or amount.'
)
CONVERSATION_TURNS = 8
CONVERSATION_TTL_SECONDS = 15 * 60
MAX_SESSIONS = 500


def contact_name(text: str) -> str:
    """Find an optional name in 'add a contact named Sam' without mistaking command words for a name."""
    match = re.search(r'\b(?:named|name is|for)\s+([a-z][a-z .\'-]{0,39})', text, re.IGNORECASE)
    if match:
        value = re.split(r'\b(?:number|phone|whatsapp)\b|\d', match.group(1), maxsplit=1, flags=re.IGNORECASE)[0]
        return value.strip(" .,'-").title()
    match = re.search(r'\b(?:add|save|create)\s+(?:my\s+)?([a-z][a-z .\'-]{0,35}?)(?:\'s)?\s+(?:phone|mobile|whatsapp)\s+number\b', text, re.IGNORECASE)
    if not match:
        return ''
    value = match.group(1)
    return value.strip(" .,'-").title()


def route(text: str, has_pending: bool = False, navigating: bool = False) -> str:
    value = text.lower().strip()
    if has_pending:
        if YES.search(value):
            return 'pay_confirm'
        if NO.search(value):
            return 'pay_cancel'
        return 'pay_waiting'
    if FORGET.search(value):
        return 'forget'
    if CONTACT_ADD.search(value):
        return 'contact_add'
    if contact_edit(text):
        return 'contact_edit'
    if TIMER.search(value):
        return 'timer'
    if NAV_STOP.search(value):
        return 'nav_stop'
    if navigating and NAV_NEXT.search(value):
        return 'nav_next'
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
    if CALL.search(value) or CALL_REQUEST.search(value):
        return 'call'
    if TRANSFER.search(value):
        return 'transfer'
    if OPEN_APP.search(value):
        return 'open_app'
    if NAV.search(value) or NEARBY_PLACE.search(value) or DIRECT_ADDRESS.match(value):
        return 'navigate'
    if SCAN_PAY.search(value):
        return 'scan_pay'
    if WEATHER.search(value):
        return 'weather'
    if WEB_LOOKUP.search(value):
        return 'web_lookup'
    if PAY.search(value):
        return 'pay_quote'
    if ERRAND.search(value) and not REMEMBER.search(value):
        return 'errand'
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


def spoken_fact(text: str) -> str:
    """The fact in 'remember that my keys are on the table'; empty for 'remember this' (a camera request)."""
    match = REMEMBER_FACT.search(text.strip())
    if not match:
        return ''
    fact = match.group(1).strip(' .!?')
    if len(fact.split()) < 3 or re.match(r'(?:this|that|it|where|what|these|those)\b', fact, re.IGNORECASE):
        return ''
    return fact


def message_body(text: str) -> str:
    """The words to send, when the user dictated them: '... saying I am running late'."""
    match = re.search(r'\b(?:saying|that says|say|that)\b[\s,:]*(.+)$', text, re.IGNORECASE)
    body = match.group(1).strip(' .') if match else ''
    return '' if re.search(r'\bwhere i am\b|\bmy location\b', body, re.IGNORECASE) else body


def remembered_text(text: str) -> str:
    """Return the dictated part of a text-only memory request.

    A visual request such as "remember this" still needs a frame, but a user
    should be able to dictate a fact without turning on the camera.
    """
    value = re.sub(r'^\W*(?:please\s+)?remember\b(?:\s+(?:this|that))?[\s,:-]*', '', text,
                   flags=re.IGNORECASE)
    value = re.sub(r'^\W*save\s+this\b[\s,:-]*', '', value, flags=re.IGNORECASE)
    return value.strip(' .,!')


class Assistant:
    def __init__(self, memory: Memory, orders: Orders, detector=None, navigator=None, place_name=None,
                 read_frame=None, send_whatsapp=None, send_desktop=None, geocode=None,
                 lookup_address=None, errands=None) -> None:
        self.errands = errands or errand
        self._errands: dict[str, dict] = {}
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
        self._contacts: dict[str, dict] = {}
        self._contact_edits: dict[str, dict] = {}
        self._last_contact: dict[str, dict] = {}
        self._turns: dict[str, deque] = {}

    # ----- the conversation so far -----

    def conversation(self, session: str, limit: int = CONVERSATION_TURNS) -> str:
        """Recent turns of this session as plain lines, so a follow-up can refer back to them."""
        turns = self._turns.get(session)
        if not turns:
            return ''
        if time.time() - turns[-1][0] > CONVERSATION_TTL_SECONDS:
            del self._turns[session]
            return ''
        return '\n'.join(f'User: {said}\nGuideEye: {answer}' for _, said, answer in list(turns)[-limit:])

    def _note_turn(self, session: str, text: str, reply: dict) -> None:
        if session not in self._turns and len(self._turns) >= MAX_SESSIONS:
            del self._turns[min(self._turns, key=lambda key: self._turns[key][-1][0])]
        turns = self._turns.setdefault(session, deque(maxlen=CONVERSATION_TURNS))
        if turns and time.time() - turns[-1][0] > CONVERSATION_TTL_SECONDS:
            turns.clear()
        turns.append((time.time(), text.strip()[:300], str(reply.get('say') or '')[:300]))

    def forget_conversation(self, session: str | None = None) -> None:
        for store in (self._turns, self._last_contact):
            store.clear() if session is None else store.pop(session, None)

    async def respond(self, session: str, text: str, image: bytes | None = None, mime: str = 'image/jpeg',
                      location: tuple[float, float] | None = None, detections: list[dict] | None = None) -> dict:
        """Answer one request and keep it in the conversation. `detections` are objects the phone's own
        detector currently sees; they go into the scan history."""
        if detections:
            self.memory.record_detections(detections)
        reply = await self._respond(session, text, image, mime, location)
        self._note_turn(session, text, reply)
        return reply

    def pending_message(self, session: str) -> dict | None:
        message = self._messages.get(session)
        if message and time.time() > message['expires']:
            del self._messages[session]
            return None
        return message

    async def _respond(self, session: str, text: str, image: bytes | None = None, mime: str = 'image/jpeg',
                       location: tuple[float, float] | None = None, inferred: bool = False) -> dict:
        order = self.orders.pending(session)
        message = self.pending_message(session)
        call = self._calls.get(session)
        pending_contact = self._contacts.get(session)
        change = self._place_changes.get(session)
        if change and time.time() > change['expires']:
            change = self._place_changes.pop(session, None) and None
        if change and not order and not message and not call:
            return await self._continue_place_change(session, change, text, location)
        if pending_contact and time.time() > pending_contact['expires']:
            self._contacts.pop(session, None)
            pending_contact = None
        intent = route(text, bool(order or message), self.navigator.active(session) is not None)
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
        if pending_contact and not order and not message and not call:
            intent = 'contact_continue'
        edit = self._contact_edits.get(session)
        if edit and (time.time() > edit['expires'] or intent in LEAVES_CONTACT_EDIT
                     or (intent == 'see' and CAMERA_REQUEST.search(text.lower()))):
            edit = self._contact_edits.pop(session, None) and None
        if edit and not (order or message or call or pending_contact):
            intent = 'contact_edit_continue'
        if message and not order:
            intent = intent.replace('pay_', 'message_')
        task = self._errands.get(session)
        if task and time.time() > task['expires']:
            task = self._errands.pop(session, None) and None
        if task and not (order or message or call or pending_contact or edit):
            if not task['done'] and (intent in ('errand', 'nothing_pending') or ERRAND_STATUS.search(text.lower())):
                intent = 'errand_status'
            elif task['done'] and task['asks'] and intent == 'nothing_pending':
                intent = 'errand_followup' if YES.search(text.lower()) else 'errand_dismiss'
        reply = {'intent': intent, 'heard': text, 'say': '', 'order': None, 'confirm': None, 'open_url': None,
                 'map_url': None, 'timer': None, 'errand': None,
                 'warnings': [], 'detections': [], 'provider': None}
        if (not inferred and not intent.endswith(('_confirm', '_cancel', '_waiting', '_continue'))
                and intent not in ('forget', 'nothing_pending', 'recall')):
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
        elif intent == 'transfer':
            reply['say'] = 'Bank transfers are not connected to GuideEye, so I will not move money. I can prepare a payment only after you confirm a price.'
        elif intent == 'contact_add':
            self._start_contact(reply, session, text)
        elif intent == 'contact_continue':
            self._continue_contact(reply, session, pending_contact, text)
        elif intent == 'contact_edit':
            self._edit_contact(reply, session, contact_edit(text), inferred)
        elif intent == 'contact_edit_continue':
            self._continue_contact_edit(reply, session, edit, text)
        elif intent == 'open_app':
            self._open_app(reply, text)
        elif intent == 'nothing_pending':
            reply['say'] = 'There is nothing waiting for your answer.'
        elif intent == 'forget':
            self.memory.clear()
            self.forget_conversation()
            reply['say'] = 'Done. I have erased everything I remembered.'
        elif intent == 'recall':
            answer = await self.memory.recall(text, self.conversation(session))
            reply.update(say=answer['text'], provider=answer['provider'])
        elif intent == 'remember' and image is None:
            note_text = remembered_text(text)
            if note_text:
                self.memory.add_note('note', note_text)
                reply['say'] = f'I will remember: {note_text}.'
            else:
                reply['say'] = 'Please tell me what to remember, or turn on the camera so I can remember what is in view.'
        elif intent == 'where_am_i':
            await self._where(reply, image, mime, location)
        elif intent == 'place_set':
            await self._start_place_change(reply, session, text, location)
        elif intent == 'timer':
            self._timer(reply, text)
        elif intent == 'weather':
            await self._weather(reply, text, location)
        elif intent == 'web_lookup':
            await self._web_lookup(reply, session, text, image, mime)
        elif intent == 'place_go':
            before = self.navigator.active(session)
            reply['say'] = await self._go_to_place(session, text, location)
            reply['navigating'] = self.navigator.active(session) is not None
            reply['map_url'] = self._map_url(session, location, before)
        elif intent == 'nav_stop':
            reply['say'] = 'Navigation stopped.' if self.navigator.stop(session) else 'No navigation is running.'
        elif intent == 'nav_next':
            if location is None:
                reply['say'] = 'I need your location for directions. Please turn location on.'
            else:
                reply['say'] = self.navigator.next_turn(session, *location) or 'No navigation is running.'
            reply['navigating'] = self.navigator.active(session) is not None
        elif intent in ('navigate', 'go_back'):
            before = self.navigator.active(session)
            reply['say'] = await self._navigate(session, intent, text, location)
            reply['navigating'] = self.navigator.active(session) is not None
            reply['map_url'] = self._map_url(session, location, before)
        elif intent == 'bridge':
            reply['say'] = 'Bridge is on. I will speak signs I can read, and show what you say as large text.'
        elif intent == 'errand':
            await self._errand(reply, session, text, text, image, mime)
        elif intent == 'errand_status':
            await self._errand_status(reply, session, task)
        elif intent == 'errand_followup':
            await self._errand(reply, session, task['request'], 'Yes, go ahead.', None, mime, task)
        elif intent == 'errand_dismiss':
            self._errands.pop(session, None)
            reply['say'] = 'Okay. I left it as it is.'
        elif intent == 'help':
            reply['say'] = HELP_TEXT
        elif intent == 'greeting':
            reply['say'] = 'Hello! I am GuideEye. I can describe what is in front of you, navigate, read text, or remember your items.'
        elif intent == 'remember' and spoken_fact(text):
            fact = spoken_fact(text)
            place = await self.place_name(*location) if location else ''
            self.memory.add_note('note', fact[0].upper() + fact[1:], place=place)
            reply['say'] = f'I will remember that: {fact}.'
        else:
            if intent == 'see' and not inferred and not CAMERA_REQUEST.search(text.lower()):
                # No rule matched and it is not plainly about the camera: work out what was meant
                # before sending the frame to the vision model.
                understood = await self._act_on_meaning(reply, session, text, image, mime, location)
                if understood is not None:
                    return understood
            if image is None:
                if intent == 'see' and not CAMERA_REQUEST.search(text.lower()):
                    await self._chat(reply, text, self.conversation(session))
                else:
                    reply['say'] = 'I need the camera for that. Please turn the camera on.'
            else:
                place = await self.place_name(*location) if location else ''
                await self._look(reply, intent, text, image, mime, place, self.conversation(session, 3))
        return reply

    async def _understand(self, session: str, text: str) -> dict | None:
        """Ask the language model what an unrecognised request means. None when it cannot say."""
        from . import llm
        if not llm.configured():
            return None
        names = ', '.join(contact['name'] for contact in self.memory.contacts()) or 'none'
        conversation = self.conversation(session)
        prompt = f'Saved contacts: {names}.\n'
        if conversation:
            prompt += f'Conversation so far:\n{conversation}\n\n'
        prompt += f'The person now says: {text}'
        try:
            raw = await llm.complete([{'text': prompt}], system=UNDERSTAND_PROMPT, json_mode=True, timeout=6.0)
            meaning = json.loads(raw[raw.index('{'):raw.rindex('}') + 1])
        except Exception:
            return None
        return meaning if isinstance(meaning, dict) and isinstance(meaning.get('action'), str) else None

    async def _act_on_meaning(self, reply: dict, session: str, text: str, image: bytes | None, mime: str,
                              location: tuple[float, float] | None) -> dict | None:
        """Carry out what the language model made of a request. None leaves it to the camera or chat path.

        The model only rewrites the request into a command; that command still goes through `route`
        and the same yes-or-no gates as anything the user says directly.
        """
        meaning = await self._understand(session, text)
        if not meaning:
            return None
        action = meaning['action'].strip().lower()
        command = str(meaning.get('command') or '').strip()[:200]
        say = str(meaning.get('say') or '').strip()[:400]
        if action == 'command' and command:
            if route(command) in ('see', 'nothing_pending', 'forget', 'greeting'):
                return None
            result = await self._respond(session, command, image, mime, location, inferred=True)
            result.update(heard=text, understood=command, inferred=True)
            return result
        if action == 'recall':
            answer = await self.memory.recall(command or text, self.conversation(session))
            reply.update(intent='recall', say=answer['text'], provider=answer['provider'])
            return reply
        if action in ('ask', 'answer') and say:
            reply.update(intent='clarify' if action == 'ask' else 'chat', say=say, provider='llm')
            return reply
        return None

    async def _chat(self, reply: dict, text: str, conversation: str = '') -> None:
        """A request no rule matched and that is not about the camera: answer it, or say it was not understood."""
        from . import llm
        if llm.configured():
            try:
                asked = f'Conversation so far:\n{conversation}\n\nThe person now says: {text}' if conversation else text
                answer = (await llm.complete([{'text': asked}], system=CHAT_PROMPT)).strip()
                if answer:
                    reply.update(intent='chat', say=answer[:400], provider='llm')
                    return
            except Exception:
                pass
        reply.update(intent='unknown', say=UNKNOWN_REQUEST)

    # ----- errands -----

    async def _errand(self, reply: dict, session: str, request: str, text: str, image: bytes | None, mime: str,
                      previous: dict | None = None, wait_seconds: float | None = None) -> None:
        if not self.errands.configured():
            reply['say'] = 'Errands are not set up on this device yet.'
            return
        try:
            task = await self.errands.start(text, f'guideeye-{session}', image, mime, previous)
            if not task['done']:
                # General document errands can take a little longer. Live web
                # research should return control quickly and keep searching in
                # the background rather than holding the conversation open.
                seconds = wait_seconds if wait_seconds is not None else float(os.getenv('ERRAND_WAIT_SECONDS', '45'))
                task = await self.errands.wait(task['id'], seconds)
        except errand.ErrandError:
            reply['say'] = 'I could not reach the errand agent. Please try again in a moment.'
            return
        self._finish_errand(reply, session, request, task)

    async def _errand_status(self, reply: dict, session: str, task: dict) -> None:
        try:
            fresh = await self.errands.get(task['id'])
        except errand.ErrandError:
            reply['say'] = 'I could not check on that errand. Please ask again in a moment.'
            return
        self._finish_errand(reply, session, task['request'], fresh)

    def _finish_errand(self, reply: dict, session: str, request: str, task: dict) -> None:
        answer = task['text'] if task['status'] == 'completed' else ''
        self._errands[session] = {
            'id': task['id'], 'session_id': task['session_id'], 'request': request, 'done': task['done'],
            'asks': bool(ERRAND_ASKS.search(answer)), 'expires': time.time() + ERRAND_TTL_SECONDS,
        }
        reply['errand'] = {'id': task['id'], 'status': task['status']}
        reply['provider'] = 'harnessrouter'
        if not task['done']:
            reply['say'] = 'I am still working on that. Ask me: is my errand ready?'
        elif answer:
            reply['say'] = answer
            self.memory.add_note('errand', f'Errand "{request}": {answer}')
        else:
            reply['say'] = 'I could not finish that errand. Nothing was sent or changed.'

    async def _weather(self, reply: dict, text: str, location: tuple[float, float] | None) -> None:
        try:
            reply.update(say=await live_info.weather(text, location), provider='weather')
        except live_info.LiveInfoError as error:
            reply['say'] = str(error)

    async def _web_lookup(self, reply: dict, session: str, text: str, image: bytes | None, mime: str) -> None:
        request = (
            'Search the public web for current information to answer this GuideEye user request: ' + text + '\n'
            'If an image is included, use it to identify the item. For a price, give one current price, the currency, '
            'the retailer or source, and say that prices can change. Do not purchase anything or ask for payment. '
            'Use one focused search and at most two sources. Stop immediately after one blocked page or after 30 seconds; '
            'do not retry, broaden the search repeatedly, or wait for inaccessible retailer pages. If you cannot verify a '
            'price quickly, say which detail is needed or that you could not verify it. Keep the answer to two short '
            'sentences suitable for speech.'
        )
        await self._errand(reply, session, text, request, image, mime,
                           wait_seconds=float(os.getenv('WEB_LOOKUP_WAIT_SECONDS', '8')))
        if reply.get('errand', {}).get('status') == 'in_progress':
            # The page polls this job automatically. Do not make a blind user
            # remember a special status question or repeat their request.
            reply['say'] = 'I am searching the web now. I will read the result automatically as soon as it is ready.'

    # ----- pay -----

    def _quote(self, reply: dict, order: dict | None) -> None:
        if order is None:
            reply['say'] = 'I could not find a price for that, so I will not pay for it.'
            return
        reply['order'] = order
        reply['confirm'] = f'Pay {order["price"]} for {order["item"]}?'
        reply['say'] = f'{order["item"].capitalize()} for {order["price"]}. Say yes to pay, or no to cancel.'

    # ----- contacts -----

    def _start_contact(self, reply: dict, session: str, text: str) -> None:
        """Start a spoken contact form; save locally once both fields are clear."""
        self._contacts[session] = {
            'name': contact_name(text), 'phone': spoken_phone(text),
            'expires': time.time() + CONTACT_TTL_SECONDS,
        }
        self._finish_or_prompt_contact(reply, session)

    def _continue_contact(self, reply: dict, session: str, pending: dict, text: str) -> None:
        if NO.search(text.lower()):
            self._contacts.pop(session, None)
            reply['intent'] = 'contact_cancel'
            reply['say'] = 'Okay, I cancelled adding that contact.'
            return
        name, phone = contact_name(text), spoken_phone(text)
        # After we explicitly ask for a name, a short spoken reply such as
        # “Jordan Lee” is the name even though it has no "named" prefix.
        if not pending['name'] and not name and not phone:
            candidate = re.sub(r"[^a-zA-Z .'-]", '', text).strip(" .'-")
            if candidate and len(candidate.split()) <= 4 and not YES.search(candidate) and not NO.search(candidate):
                name = candidate.title()
        if name:
            pending['name'] = name
        if phone:
            pending['phone'] = phone
        pending['expires'] = time.time() + CONTACT_TTL_SECONDS
        self._finish_or_prompt_contact(reply, session)

    def _finish_or_prompt_contact(self, reply: dict, session: str) -> None:
        pending = self._contacts[session]
        if pending['name'] and pending['phone']:
            try:
                contact = self.memory.add_contact(pending['name'], pending['phone'])
            except ValueError:
                pending['phone'] = ''
            else:
                self._contacts.pop(session, None)
                self._last_contact[session] = contact
                reply['intent'] = 'contact_saved'
                reply['contact'] = contact
                reply['say'] = f"Saved {contact['name']} as a WhatsApp contact."
                return
        reply['intent'] = 'contact_waiting'
        if pending['name']:
            reply['say'] = f"What is {pending['name']}'s WhatsApp number, including the country code?"
        else:
            reply['say'] = 'Who should I add? Say their name, then their WhatsApp number with the country code.'

    # ----- changing saved contacts -----

    def _contact_names(self) -> str:
        names = [contact['name'] for contact in self.memory.contacts()]
        if len(names) < 2:
            return ''.join(names)
        return ', '.join(names[:-1]) + ' and ' + names[-1]

    def _named_contact(self, session: str, name: str) -> dict | None:
        """The saved contact a spoken name means; "him", "her" or "that one" is the contact last talked about."""
        if not name:
            return None
        if PRONOUN_NAME.match(name.strip()):
            last = self._last_contact.get(session)
            return self.memory.find_contact(last['name']) if last else None
        return self.memory.find_contact(name)

    def _edit_contact(self, reply: dict, session: str, edit: dict, inferred: bool = False) -> None:
        known = self._contact_names()
        if edit['kind'] == 'list':
            count = len(self.memory.contacts())
            reply['intent'] = 'contact_list'
            reply['say'] = f'You have {count} contact{"s" if count != 1 else ""}: {known}.' if known else NO_CONTACTS
            return
        if not known:
            reply.update(intent='contact_missing', say=NO_CONTACTS)
            return
        contact = self._named_contact(session, edit['name'])
        if contact is None and not edit['name'] and edit['kind'] == 'rename' and edit['new_name']:
            contact = self._named_contact(session, 'that one')  # "change the name to Leo", right after talking about Lee
        pending = {'kind': edit['kind'], 'contact': contact, 'new_name': edit['new_name'], 'phone': edit['phone'],
                   'ask_first': inferred or edit['kind'] == 'remove', 'agreed': False, 'misses': 0,
                   'expires': time.time() + CONTACT_EDIT_TTL_SECONDS}
        self._contact_edits[session] = pending
        if contact is None and edit['name'] and not PRONOUN_NAME.match(edit['name']):
            reply['intent'] = 'contact_edit_waiting'
            if edit['kind'] == 'rename' and not edit['new_name']:
                # "Change the name for Lee" with no contact called Lee: Lee is the name they want to give.
                pending['new_name'] = edit['name']
                reply['say'] = (f'I do not have a contact called {edit["name"]}. '
                                f'Which contact should I rename to {edit["name"]}? You have {known}.')
            else:
                reply['say'] = f'I do not have {edit["name"]} in your contacts. You have {known}. Which one do you mean?'
            return
        self._advance_contact_edit(reply, session)

    def _advance_contact_edit(self, reply: dict, session: str) -> None:
        """Do the change if everything is known; otherwise ask for the next missing detail."""
        pending = self._contact_edits[session]
        contact, kind = pending['contact'], pending['kind']
        reply['intent'] = 'contact_edit_waiting'
        if contact is None:
            verb = {'rename': 'rename', 'remove': 'remove', 'number': 'update'}[kind]
            reply['say'] = f'Which contact do you want to {verb}? You have {self._contact_names()}.'
            return
        name = contact['name']
        if kind == 'rename':
            new_name = pending['new_name']
            if not new_name:
                reply['say'] = f"What should {name}'s new name be?"
                return
            if new_name.lower() == name.lower():
                self._contact_edits.pop(session, None)
                reply.update(intent='contact_renamed', contact=contact, say=f'{name} is already saved under that name.')
                return
            if pending['ask_first'] and not pending['agreed']:
                reply['confirm'] = f'Rename {name} to {new_name}?'
                reply['say'] = f'Rename {name} to {new_name}? Say yes or no.'
                return
            try:
                saved = self.memory.rename_contact(name, new_name)
            except ValueError as error:
                if 'already' in str(error):
                    pending['new_name'] = ''
                    reply['say'] = f'You already have a contact called {new_name}. What other name should I use for {name}?'
                    return
                self._contact_edits.pop(session, None)
                reply.update(intent='contact_missing', say=f'I could not find {name} in your contacts any more.')
                return
            self._contact_edits.pop(session, None)
            self._last_contact[session] = saved
            reply.update(intent='contact_renamed', contact=saved, say=f'Done. {name} is now saved as {saved["name"]}.')
        elif kind == 'number':
            if pending['ask_first'] and pending['phone'] and not pending['agreed']:
                reply['confirm'] = f"Change {name}'s number?"
                reply['say'] = f"Change {name}'s number to {' '.join(pending['phone'])}? Say yes or no."
                return
            try:
                saved = self.memory.add_contact(name, pending['phone'])
            except ValueError:
                pending['phone'] = ''
                reply['say'] = f"What is {name}'s new WhatsApp number, including the country code?"
                return
            self._contact_edits.pop(session, None)
            self._last_contact[session] = saved
            reply.update(intent='contact_updated', contact=saved, say=f"Done. I updated {name}'s number.")
        else:
            if not pending['agreed']:
                reply['confirm'] = f'Remove {name} from your contacts?'
                reply['say'] = f'Remove {name} from your contacts? Say yes or no.'
                return
            self.memory.remove_contact(name)
            self._contact_edits.pop(session, None)
            self._last_contact.pop(session, None)
            reply.update(intent='contact_removed', say=f'Done. I removed {name} from your contacts.')

    def _continue_contact_edit(self, reply: dict, session: str, pending: dict, text: str) -> None:
        value = text.lower()
        contact, kind = pending['contact'], pending['kind']
        if NO.search(value):
            self._contact_edits.pop(session, None)
            reply.update(intent='contact_edit_cancel', say='Okay. I left your contacts as they are.')
            return
        pending['expires'] = time.time() + CONTACT_EDIT_TTL_SECONDS
        ready = contact and (kind == 'remove' or (kind == 'rename' and pending['new_name'])
                             or (kind == 'number' and pending['phone']))
        if ready and pending['ask_first'] and not pending['agreed']:
            pending['agreed'] = bool(YES.search(value))
        elif contact is None:
            found = self._named_contact(session, text)
            if found is None:
                pending['misses'] += 1
                if pending['misses'] >= 2:
                    self._contact_edits.pop(session, None)
                    reply.update(intent='contact_edit_cancel',
                                 say=f'I still did not find that contact, so I changed nothing. You have {self._contact_names()}.')
                else:
                    reply.update(intent='contact_edit_waiting',
                                 say=f'I did not find that contact. You have {self._contact_names()}. Which one?')
                return
            pending['contact'] = found
        elif kind == 'rename':
            new_name = spoken_name(text)
            if not new_name:
                reply.update(intent='contact_edit_waiting', say=f"I did not catch the name. What should {contact['name']}'s new name be?")
                return
            pending['new_name'] = new_name
        elif kind == 'number':
            pending['phone'] = spoken_phone(text)
        self._advance_contact_edit(reply, session)

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
        if contact is None and PRONOUN.search(text):
            contact = self._named_contact(session, 'that one')  # "text her that I am late"
        if contact is not None:
            self._last_contact[session] = contact
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
                   f'Map: https://maps.google.com/?q={location[0]:.5f},{location[1]:.5f} (sent with GuideEye)'
        self._messages[session] = {
            'name': contact['name'], 'phone': contact['phone'], 'text': body, 'expires': time.time() + MESSAGE_TTL_SECONDS,
            'url': f'https://wa.me/{contact["phone"]}?text={quote(body)}',
        }
        reply['confirm'] = f'Send to {contact["name"]} on WhatsApp?'
        spoken = body.split(' Map:')[0]
        reply['say'] = f'Message to {contact["name"]}: {spoken} Say yes to send, or no to cancel.'

    async def _prepare_call(self, reply: dict, session: str, text: str) -> None:
        match = CALL.search(text)
        name = re.sub(r'^(?:to|the)\s+', '', match.group(1).strip(), flags=re.IGNORECASE) if match else ''
        if not name:
            reply['say'] = 'Who would you like to call? Say call, followed by a saved contact name.'
            return
        contact = self._named_contact(session, name)
        if contact is None:
            reply['say'] = f'I do not have {name or "that person"} in your contacts. Add them in the Family tab first.'
            return
        self._calls[session] = self._last_contact[session] = contact
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
        address = ''
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
        if location is not None and address:
            # Only a real address is a memory; "could not look up the address" is not a place.
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
            is_direct_address = bool(DIRECT_ADDRESS.match(value))
            if not match and other not in ('see', 'nothing_pending', 'place_set') and not is_direct_address:
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

    async def _look(self, reply: dict, intent: str, text: str, image: bytes, mime: str, place: str = '',
                    conversation: str = '') -> None:
        import asyncio
        detections = await asyncio.to_thread(self.detector.detect, image)
        self.memory.record_detections(detections, place=place)
        reply['detections'] = detections
        reply['warnings'] = vision.hazard_warnings(detections)
        if intent == 'remember':
            small, small_mime = await asyncio.to_thread(vision.normalize_image, image, mime, vision.DESCRIBE_SIDE)
            note = await self.memory.snapshot(small, small_mime, vision.local_description(detections) if detections else '', place)
            if note['text']:
                reply.update(say=f'I will remember this. {note["text"]}', provider=note['provider'])
            else:
                reply.update(say='I could not make out what is in view, so I did not save it. Hold the camera steady and ask again.',
                             provider=note['provider'])
            return
        if READ.search(text.lower()):
            # Reading is a different job from describing: ask for the words only, with no object
            # hints, and keep the picture large enough for small print.
            answer = await vision.describe(image, mime, READ_QUESTION, [], max_side=vision.MAX_FRAME_SIDE)
        else:
            question = text
            if conversation:
                # A follow-up such as "what colour is it?" only makes sense with what was just said.
                question = f'{text}\n\nFor context only, the conversation so far:\n{conversation}\nAnswer only the latest request.'
            answer = await vision.describe(image, mime, question, detections)
        reply.update(say=answer['text'], provider=answer['provider'])
        if answer['provider'] != 'local':
            self.memory.add_note('seen', f'Answer to "{text}": {answer["text"]}', place=place)
