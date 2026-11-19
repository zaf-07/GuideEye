"""Bridge: experimental sign reading.

A few camera frames in time order are sent to the vision model, which is asked
for a short English reading and its own confidence. Low-confidence readings are
dropped rather than spoken. This is a demo of the idea, not sign-language
translation: it will miss and misread signs.
"""
import json

from . import llm

MIN_CONFIDENCE = 0.6
MAX_FRAMES = 3

# A fixed, task-specific vocabulary is substantially safer than open-ended
# guessing. These are individual ASL concepts, not a general translator.
VOCABULARY = {
    'I / me': 'index finger points to the signer’s chest',
    'want': 'both hands start near the chest and pull inward with curved fingers',
    'water': 'three middle fingers extended in a W handshape tap the chin',
    'you': 'index finger points outward toward the listener',
    'like': 'thumb and middle finger touch near the chest, then move outward',
    'eat': 'fingertips bunched together tap the mouth',
    'apple': 'a bent index finger twists against the cheek',
    'today': 'an index finger makes a small circle, then points down',
    'my': 'an open palm touches the chest',
    'friend': 'two hooked index fingers link together',
    'go': 'two flat hands point forward and move away from the signer',
    'school': 'two flat hands clap together twice',
    'tomorrow': 'a thumb moves forward from the cheek',
    'we': 'an index finger sweeps in an arc from one shoulder to the other',
    'play': 'Y handshapes shake side to side',
    'basketball': 'both cupped hands mime bouncing or holding a basketball',
    'please': 'a flat hand circles on the chest',
    'help': 'a thumbs-up fist rests on the open palm of the other hand and lifts upward',
    'find': 'a bent V handshape moves downward and closes around an imagined object',
    'book': 'palms together open like a book',
    # Keep the previously shipped demo signs accepted for compatibility.
    'hello': 'open hand at the forehead moving outward, like a salute',
    'thank you': 'flat hand touching the chin, then moving forward and down',
    'yes': 'a fist nodding up and down at the wrist',
    'no': 'index and middle finger snapping shut against the thumb',
    'sorry': 'a fist circling on the chest',
    'I love you': 'thumb, index finger and little finger extended, other fingers folded',
    'good': 'flat hand from the chin moving down into the other open palm',
    'stop': 'the edge of one flat hand chopping down onto the other open palm',
    'thumbs up': 'a fist with the thumb pointing up',
    'peace': 'index and middle fingers raised in a V',
}

# ASL uses its own grammar. Keep these phrase mappings explicit rather than
# pretending that English word order is a universal translation rule.
PHRASE_TRANSLATIONS = {
    ('I / me', 'want', 'water'): 'I want water.',
    ('you', 'like', 'eat', 'apple'): 'Do you like eating apples?',
    ('today', 'my', 'friend', 'go', 'school'): 'My friend is going to school today.',
    ('tomorrow', 'we', 'play', 'basketball'): 'We’ll play basketball tomorrow.',
    ('please', 'help', 'I / me', 'find', 'book'): 'Please help me find the book.',
}


def translate_sequence(signs: list[str]) -> str:
    """Translate a supported sequence of recognized ASL concepts to English.

    Unknown or incomplete sequences deliberately return an empty string; the
    caller should retain the individual recognized signs instead of inventing
    a sentence.
    """
    normalized = []
    known = {word.lower(): word for word in VOCABULARY}
    aliases = {'i': 'I / me', 'me': 'I / me', 'help-me': 'help', 'help me': 'help'}
    for sign in signs:
        word = str(sign).strip().lower()
        normalized.append(aliases.get(word, known.get(word, '')))
    return PHRASE_TRANSLATIONS.get(tuple(normalized), '')

SIGN_PROMPT = (
    'The images are consecutive camera frames, in time order, of a person who may be making a hand sign '
    'in American Sign Language. Choose the ONE sign from this list that best matches, or none:\n'
    + '\n'.join(f'- "{word}": {how}' for word, how in VOCABULARY.items())
    + '\nReply with JSON only: {"text": "<exactly one phrase from the list, or empty>", "confidence": <0 to 1>}. '
    'If no hands are raised, nobody is signing, or nothing on the list clearly matches, '
    'use an empty text and a low confidence. Never guess.'
)


def parse_reading(raw: str) -> dict:
    """Validate the model's JSON and drop anything below the confidence bar."""
    try:
        data = json.loads(raw)
        text = str(data.get('text', '')).strip()[:120]
        known = {word.lower(): word for word in VOCABULARY}
        text = known.get(text.lower().strip('"'), '')
        confidence = max(0.0, min(1.0, float(data.get('confidence', 0))))
    except (ValueError, TypeError, AttributeError):
        return {'text': '', 'confidence': 0.0}
    if confidence < MIN_CONFIDENCE:
        text = ''
    return {'text': text, 'confidence': round(confidence, 2)}


async def read_sign(frames: list[tuple[bytes, str]]) -> dict:
    parts = [llm.image_part(image, mime) for image, mime in frames[:MAX_FRAMES]]
    parts.append({'text': SIGN_PROMPT})
    try:
        reading = parse_reading(await llm.complete(parts, json_mode=True, timeout=8.0))
        reading['provider'] = 'cloud'
    except Exception as error:
        reading = {'text': '', 'confidence': 0.0, 'provider': None, 'error': type(error).__name__}
    reading['experimental'] = True
    return reading
