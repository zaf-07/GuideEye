"""Phone frames arrive sideways and oversized; spoken requests arrive without a camera."""
import asyncio
import os
import unittest
from io import BytesIO
from unittest import mock

from PIL import Image

from backend.app.services import navigation, vision
from backend.app.services.assistant import Assistant, route, spoken_fact
from backend.app.services.memory import Memory
from backend.app.services.payments import Orders


def run(coroutine):
    return asyncio.run(coroutine)


def phone_photo(width=400, height=200, orientation=6) -> bytes:
    """A frame as a phone stores it: sensor-landscape pixels plus an EXIF rotation note."""
    frame = Image.new('RGB', (width, height), (10, 20, 30))
    frame.paste((250, 0, 0), (0, 0, width // 4, height))  # red band on the stored left edge
    exif = Image.Exif()
    exif[0x0112] = orientation
    out = BytesIO()
    frame.save(out, 'JPEG', quality=90, exif=exif)
    return out.getvalue()


class FrameTests(unittest.TestCase):
    def test_sideways_photo_is_turned_upright(self):
        body, mime = vision.normalize_image(phone_photo())
        frame = Image.open(BytesIO(body))
        self.assertEqual(mime, 'image/jpeg')
        self.assertEqual(frame.size, (200, 400))
        self.assertEqual(frame.getexif().get(0x0112, 1), 1)
        # Orientation 6 turns the stored left edge into the top of the picture.
        top, bottom = frame.getpixel((100, 20)), frame.getpixel((100, 380))
        self.assertGreater(top[0], 200)
        self.assertLess(bottom[0], 60)

    def test_large_photo_is_shrunk_and_small_upright_jpeg_is_left_alone(self):
        big = BytesIO()
        Image.new('RGB', (4032, 3024), (40, 40, 40)).save(big, 'JPEG')
        body, _ = vision.normalize_image(big.getvalue())
        self.assertEqual(max(Image.open(BytesIO(body)).size), vision.MAX_FRAME_SIDE)
        small = BytesIO()
        Image.new('RGB', (640, 480), (40, 40, 40)).save(small, 'JPEG')
        self.assertEqual(vision.normalize_image(small.getvalue())[0], small.getvalue())

    def test_png_becomes_jpeg_and_unreadable_bytes_pass_through(self):
        png = BytesIO()
        Image.new('RGBA', (50, 50), (1, 2, 3, 255)).save(png, 'PNG')
        body, mime = vision.normalize_image(png.getvalue(), 'image/png')
        self.assertEqual((mime, Image.open(BytesIO(body)).format), ('image/jpeg', 'JPEG'))
        self.assertEqual(vision.normalize_image(b'not an image', 'image/png'), (b'not an image', 'image/png'))

    def test_describing_uses_a_smaller_picture_than_reading(self):
        seen = []

        async def provider(image, mime, question, detections):
            seen.append(max(Image.open(BytesIO(image)).size))
            return 'A desk.'

        big = BytesIO()
        Image.new('RGB', (1600, 1200), (40, 40, 40)).save(big, 'JPEG')
        run(vision.describe(big.getvalue(), 'image/jpeg', '', [], providers=[('groq', provider)]))
        run(vision.describe(big.getvalue(), 'image/jpeg', '', [], providers=[('groq', provider)], max_side=vision.MAX_FRAME_SIDE))
        self.assertEqual(seen, [vision.DESCRIBE_SIDE, 1600])

    def test_failed_model_with_nothing_detected_says_the_check_failed(self):
        async def broken(*args):
            raise ConnectionError()

        result = run(vision.describe(b'', 'image/jpeg', '', [], providers=[('groq', broken)]))
        self.assertEqual(result['text'], vision.CLOUD_FAILED)
        self.assertNotIn('do not recognise', result['text'])
        # With no model configured at all, the detector's own sentence still stands.
        self.assertIn('do not recognise', run(vision.describe(b'', 'image/jpeg', '', [], providers=[]))['text'])

    def test_rate_limit_is_retried_only_when_the_wait_is_short(self):
        def error(status, headers=None):
            response = mock.Mock(status_code=status, headers=headers or {})
            return mock.Mock(response=response)

        self.assertEqual(vision._retry_delay(error(429, {'retry-after': '1'})), 1.0)
        self.assertIsNone(vision._retry_delay(error(429, {'retry-after': '30'})))
        self.assertIsNone(vision._retry_delay(error(429)))
        self.assertIsNone(vision._retry_delay(error(400)))
        self.assertEqual(vision._retry_delay(error(503)), 0.4)
        self.assertEqual(vision._retry_delay(mock.Mock(response=None)), 0.4)


class RequestTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {'GEMINI_API_KEY': '', 'GROQ_API_KEY': '', 'MINIMAX_API_KEY': '',
                                               'STRIPE_SECRET_KEY': '', 'SUPERMEMORY_API_KEY': ''})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.memory = Memory(':memory:')
        self.assistant = Assistant(self.memory, Orders())

    def test_a_spoken_fact_is_remembered_without_the_camera(self):
        self.assertEqual(spoken_fact('Remember that my keys are on the kitchen table.'), 'my keys are on the kitchen table')
        self.assertEqual(spoken_fact('remember this'), '')
        self.assertEqual(spoken_fact('remember where I parked'), '')
        self.assertEqual(spoken_fact('remember this letter is on the desk'), '')
        reply = run(self.assistant.respond('s1', 'Remember that my keys are on the kitchen table'))
        self.assertEqual(reply['intent'], 'remember')
        self.assertIn('my keys are on the kitchen table', reply['say'])
        answer = run(self.assistant.respond('s1', 'Where did I leave my keys?'))
        self.assertIn('kitchen table', answer['say'])
        # "Remember this" is still a camera request.
        self.assertIn('camera', run(self.assistant.respond('s1', 'Remember this'))['say'])

    def test_what_did_i_ask_lists_recent_requests_without_a_language_model(self):
        run(self.assistant.respond('s1', 'Set a timer for ten minutes'))
        run(self.assistant.respond('s1', 'Buy me a coffee'))
        run(self.assistant.respond('s1', 'no'))
        answer = run(self.assistant.respond('s1', 'What did I ask you?'))
        self.assertIn('Buy me a coffee', answer['say'])
        self.assertIn('Set a timer for ten minutes', answer['say'])

    def test_finding_a_nearby_place_is_navigation_not_a_camera_request(self):
        self.assertEqual(route('find a pharmacy open now'), 'navigate')
        self.assertEqual(route('is there a cafe nearby'), 'navigate')
        self.assertEqual(route('where is the bathroom'), 'navigate')
        self.assertEqual(route('find out when the pharmacy closes'), 'errand')
        self.assertEqual(navigation.destination_query('find a pharmacy open now'), ('pharmacy', 'pharmacy'))
        self.assertEqual(navigation.destination_query('take me to the nearest supermarket please'), ('supermarket', 'supermarket'))
        self.assertEqual(navigation.destination_query('take me to 450 Serra Mall')[0], '450 serra mall')

    def test_an_unmatched_request_is_not_answered_with_turn_the_camera_on(self):
        reply = run(self.assistant.respond('s1', 'something is broken'))
        self.assertEqual(reply['intent'], 'unknown')
        self.assertNotIn('camera', reply['say'])
        # A request about what is in view still asks for the camera.
        self.assertIn('camera', run(self.assistant.respond('s1', 'what is in front of me'))['say'])

    def test_an_unmatched_request_is_answered_when_a_model_is_available(self):
        from backend.app.services import llm

        async def answer(parts, system='', **_):
            return 'What happened when it broke?'

        with mock.patch.dict(os.environ, {'GROQ_API_KEY': 'x'}), mock.patch.object(llm, 'complete', answer):
            reply = run(self.assistant.respond('s1', 'something is broken'))
        self.assertEqual((reply['intent'], reply['say']), ('chat', 'What happened when it broke?'))

    def test_an_empty_view_does_not_become_a_memory(self):
        note = run(self.memory.snapshot(b'', 'image/jpeg', ''))
        self.assertEqual(note['text'], '')
        self.assertEqual(self.memory.notes(), [])
        kept = run(self.memory.snapshot(b'', 'image/jpeg', 'I can see a chair ahead.'))
        self.assertEqual(kept['text'], 'I can see a chair ahead.')

    def test_a_failed_address_lookup_is_not_saved_as_a_place(self):
        async def no_address(lat, lon):
            return ''

        with mock.patch.object(navigation, 'address', no_address):
            reply = run(self.assistant.respond('s1', 'Where am I?', location=(37.4, -122.1)))
        self.assertIn('could not look up', reply['say'])
        self.assertFalse(any(note['kind'] == 'place' for note in self.memory.notes()))


if __name__ == '__main__':
    unittest.main()
