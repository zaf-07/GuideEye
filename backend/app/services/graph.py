"""Relationship extraction: turning memory notes into a graph.

A note like "The keys are on the kitchen counter, next to the kettle" only
answers "where are my keys?" if something understands that *keys* sit *on* the
*counter*, and that the *counter* is *next to* the *kettle*. This module pulls
those (subject, relation, object) triples out of plain sentences so the memory
can be walked as a graph instead of grepped as a bag of words.

Extraction is rule-based and runs offline. It is deliberately conservative:
a missed edge costs a little recall, a wrong edge would make GuideEye confidently
say the wrong thing to someone who cannot check it.
"""
from __future__ import annotations

import re

# Spatial and possessive prepositions, longest first so "in front of" wins over "in".
RELATIONS: list[tuple[str, str]] = [
    (r'in front of', 'in_front_of'),
    (r'to the left of', 'left_of'),
    (r'to the right of', 'right_of'),
    (r'on top of', 'on'),
    (r'next to', 'next_to'),
    (r'close to', 'near'),
    (r'attached to', 'on'),
    (r'underneath', 'under'),
    (r'opposite', 'opposite'),
    (r'behind', 'behind'),
    (r'between', 'between'),
    (r'beside', 'next_to'),
    (r'against', 'next_to'),
    (r'inside', 'in'),
    (r'below', 'under'),
    (r'under', 'under'),
    (r'above', 'above'),
    (r'near', 'near'),
    (r'over', 'above'),
    (r'onto', 'on'),
    (r'on', 'on'),
    (r'at', 'at'),
    (r'by', 'next_to'),
    (r'in', 'in'),
]
_RELATION_RE = re.compile(r'\b(' + '|'.join(pattern for pattern, _ in RELATIONS) + r')\b', re.I)
_RELATION_BY_PHRASE = {pattern.replace('\\', ''): name for pattern, name in RELATIONS}

# Words that never start a useful entity name.
_LEADING = {
    'a', 'an', 'the', 'my', 'your', 'his', 'her', 'their', 'our', 'its', 'some', 'that', 'this',
    'these', 'those', 'there', 'here', 'it', 'they', 'them', 'and', 'but', 'or', 'then', 'also',
    'is', 'are', 'was', 'were', 'be', 'been', 'being', 'has', 'have', 'had', 'saw', 'see', 'seen',
    'left', 'put', 'placed', 'sitting', 'sits', 'sat', 'standing', 'stands', 'lying', 'lies',
    'resting', 'rests', 'i', 'you', 'we', 'noted', 'note', 'appears', 'appear', 'looks', 'seems',
    'leaning', 'leans', 'leant', 'hanging', 'hangs', 'hung', 'propped', 'parked', 'stored', 'kept',
    'tucked', 'folded', 'stacked', 'perched', 'balanced', 'laid', 'lay', 'set', 'still', 'now',
}
# The person using GuideEye, as a node in the graph ("you were at the cafe").
USER = 'you'
# Entities that carry no meaning on their own.
_JUNK = {'', 'it', 'them', 'there', 'here', 'one', 'thing', 'things', 'side', 'top', 'front', 'back', 'me'}
_FIRST_PERSON = re.compile(r'^\s*i\b', re.I)

_SENTENCE_SPLIT = re.compile(r'[.!?;]\s+|\n+')
_CLAUSE_SPLIT = re.compile(r',\s*|\s+and\s+|\s+but\s+')


def _clean(phrase: str) -> str:
    """Normalise an entity name: lower case, no articles, no trailing filler."""
    words = re.findall(r"[a-z0-9'\-]+", phrase.lower())
    # "the back of the chair" names the chair. Keep the head noun, not the part.
    if 'of' in words:
        words = words[len(words) - 1 - words[::-1].index('of') + 1:]
    while words and words[0] in _LEADING:
        words.pop(0)
    while words and words[-1] in _LEADING:
        words.pop()
    # Keep names short; "the small wooden kitchen counter" -> "wooden kitchen counter".
    return ' '.join(words[-3:])


def _is_entity(name: str) -> bool:
    return name not in _JUNK and len(name) > 2 and not name.isdigit()


def extract(text: str) -> list[tuple[str, str, str]]:
    """Pull (subject, relation, object) triples out of a note.

    Chains are expanded: "keys on the counter next to the kettle" yields both
    (keys, on, counter) and (counter, next_to, kettle).
    """
    triples: list[tuple[str, str, str]] = []
    for sentence in _SENTENCE_SPLIT.split(text or ''):
        sentence = sentence.strip()
        if not sentence or re.match(r'^i (asked|said|requested)', sentence, re.I):
            continue  # a log of what the user said, not a fact about the world
        # Walk the prepositions left to right, carrying the previous object forward.
        matches = list(_RELATION_RE.finditer(sentence))
        if not matches:
            continue
        subject = _clean(sentence[:matches[0].start()])
        if not subject and _FIRST_PERSON.match(sentence):
            subject = USER  # "I was at the cafe" -> (you, at, cafe)
        for index, match in enumerate(matches):
            relation = _RELATION_BY_PHRASE[match.group(1).lower()]
            end = matches[index + 1].start() if index + 1 < len(matches) else len(sentence)
            tail = sentence[match.end():end]
            # Stop the object at a clause boundary so "counter, next to" doesn't swallow the comma.
            obj = _clean(_CLAUSE_SPLIT.split(tail.strip())[0])
            if _is_entity(subject) and _is_entity(obj) and subject != obj:
                triples.append((subject, relation, obj))
            subject = obj  # chain: the object becomes the next subject
    # De-duplicate, keeping order.
    seen: set[tuple[str, str, str]] = set()
    unique = []
    for triple in triples:
        if triple not in seen:
            seen.add(triple)
            unique.append(triple)
    return unique


def entities(text: str) -> list[str]:
    """Every entity named in a note, for looking up a starting point in the graph."""
    names: list[str] = []
    for subject, _, obj in extract(text):
        names += [subject, obj]
    seen: set[str] = set()
    return [n for n in names if not (n in seen or seen.add(n))]


def phrase(relation: str) -> str:
    """A relation spoken aloud."""
    return {
        'on': 'on', 'in': 'in', 'at': 'at', 'under': 'under', 'above': 'above',
        'near': 'near', 'next_to': 'next to', 'behind': 'behind', 'between': 'between',
        'in_front_of': 'in front of', 'left_of': 'to the left of', 'right_of': 'to the right of',
        'opposite': 'opposite', 'seen_at': 'seen at', 'seen_in': 'seen in',
    }.get(relation, relation.replace('_', ' '))
