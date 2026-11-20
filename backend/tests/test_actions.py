from __future__ import annotations

import asyncio
import os
import unittest
from unittest import mock

from backend.app.services import bridge, checkout
from backend.app.services.assistant import Assistant, message_body, route
from backend.app.services.memory import Memory
from backend.app.services.payments import Orders

HOME = (37.7606, -122.3866)


def run(coroutine):
    return asyncio.run(coroutine)


async def place(lat, lon):
    return '20th Street, Dogpatch'


class Offline(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {'GEMINI_API_KEY': '', 'GROQ_API_KEY': '', 'STRIPE_SECRET_KEY': ''})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.memory = Memory(':memory:')

    def assistant(self, frame=None):
        async def read_frame(image, mime):
            return frame
        return Assistant(self.memory, Orders(), place_name=place, read_frame=read_frame)


class PaymentCodeTests(unittest.TestCase):
    def test_parse_payment_codes(self):
        self.assertEqual(checkout.parse_payment_code(checkout.payment_code('Iced Latte', 5.25)), ('Iced Latte', 525))
        self.assertEqual(checkout.parse_payment_code('{"item": "Sandwich", "amount": 8.5}'), ('Sandwich', 850))
        self.assertEqual(checkout.parse_payment_code('Coffee $4.50'), ('Coffee', 450))

    def test_unrelated_codes_are_not_payments(self):
        for text in ['', 'https://example.com/menu', 'hello world', '{"item": "x", "amount": 0}', 'Table 12']:
            self.assertIsNone(checkout.parse_payment_code(text), text)

    def test_qr_round_trip(self):
        try:
            import cv2  # noqa: F401
        except ImportError:
            self.skipTest('OpenCV is not installed')
        code = checkout.payment_code('Coffee', 4.5)
        self.assertEqual(checkout.read_qr(checkout.make_qr_png(code)), code)
        self.assertEqual(checkout.read_qr(b'not an image'), '')


class ScanPayTests(Offline):
    def test_routing(self):
        self.assertEqual(route('Pay this'), 'scan_pay')
        self.assertEqual(route('Scan the code and pay'), 'scan_pay')
        self.assertEqual(route('Buy me a coffee'), 'pay_quote')

    def test_scanned_code_still_needs_a_yes(self):
        assistant = self.assistant(('Coffee', 450, 'qr'))
        quote = run(assistant.respond('s', 'Pay this', b'frame'))
        self.assertEqual(quote['confirm'], 'Pay $4.50 for Coffee?')
        self.assertIn('Say yes to pay', quote['say'])
        paid = run(assistant.respond('s', 'Yes'))
        self.assertEqual(paid['intent'], 'pay_confirm')
        self.assertIn('I paid $4.50 for Coffee', paid['say'])

    def test_unreadable_frame_or_no_camera_pays_nothing(self):
        self.assertIn('Nothing was paid', run(self.assistant(None).respond('s', 'Pay this', b'frame'))['say'])
        self.assertIn('need the camera', run(self.assistant(('Coffee', 450, 'qr')).respond('s', 'Pay this'))['say'])

    def test_spending_limit(self):
        reply = run(self.assistant(('Television', 89900, 'price')).respond('s', 'Buy this', b'frame'))
        self.assertIn('over your $50.00 limit', reply['say'])
        self.assertIsNone(reply['order'])


class MessageTests(Offline):
    def test_contacts(self):
        self.assertEqual(self.memory.add_contact('Mom', '+1 (415) 555-0100'), {'name': 'Mom', 'phone': '14155550100'})
        self.assertEqual(self.memory.find_contact('tell mom where I am')['name'], 'Mom')
        self.assertIsNone(self.memory.find_contact('tell my moment'))
        with self.assertRaises(ValueError):
            self.memory.add_contact('Bad', '12')
        self.memory.clear()
        self.assertEqual(len(self.memory.contacts()), 1)  # erasing memory keeps contacts
        self.memory.remove_contact('mom')
        self.assertEqual(self.memory.contacts(), [])

    def test_routing_and_body(self):
        self.assertEqual(route('Tell Mom where I am'), 'message')
        self.assertEqual(route('Tell me what is in front of me'), 'see')
        self.assertEqual(message_body('Text Alex saying I am running late.'), 'I am running late')
        self.assertEqual(message_body('Tell Mom where I am'), '')

    def test_location_message_needs_contact_location_and_yes(self):
        assistant = self.assistant()
        self.assertIn('contacts', run(assistant.respond('s', 'Tell Mom where I am', location=HOME))['say'])
        self.memory.add_contact('Mom', '+14155550100')
        self.assertIn('need your location', run(assistant.respond('s', 'Tell Mom where I am'))['say'])
        draft = run(assistant.respond('s', 'Tell Mom where I am', location=HOME))
        self.assertEqual(draft['confirm'], 'Send to Mom on WhatsApp?')
        self.assertIn('I am near 20th Street, Dogpatch.', draft['say'])
        self.assertIsNone(draft['open_url'])  # nothing leaves before the yes
        sent = run(assistant.respond('s', 'Yes'))
        self.assertEqual(sent['intent'], 'message_confirm')
        self.assertTrue(sent['open_url'].startswith('https://wa.me/14155550100?text=I%20am%20near'))
        self.assertIn('maps.google.com', sent['open_url'])

    def test_with_a_message_service_yes_sends_directly(self):
        sent = []
        async def send(phone, text):
            sent.append((phone, text))
        self.memory.add_contact('Mom', '+14155550100')
        assistant = Assistant(self.memory, Orders(), place_name=place, send_whatsapp=send)
        with mock.patch.dict(os.environ, {'TWILIO_ACCOUNT_SID': 'AC_test', 'TWILIO_AUTH_TOKEN': 'token'}):
            run(assistant.respond('s', 'Text Mom saying I am on my way'))
            self.assertEqual(sent, [])  # still nothing before the yes
            reply = run(assistant.respond('s', 'Yes'))
        self.assertEqual(sent, [('14155550100', 'I am on my way')])
        self.assertEqual((reply['say'], reply['open_url']), ('Sent to Mom on WhatsApp.', None))

    def test_desktop_sending_is_opt_in_and_falls_back(self):
        pressed = []
        async def desktop(phone, text):
            pressed.append(phone)
            return len(pressed) == 1  # the second attempt finds no WhatsApp window
        self.memory.add_contact('Mom', '+14155550100')
        assistant = Assistant(self.memory, Orders(), place_name=place, send_desktop=desktop)
        from backend.app.services import messaging
        with mock.patch.object(messaging, 'desktop_enabled', return_value=True), \
             mock.patch.dict(os.environ, {'TWILIO_ACCOUNT_SID': '', 'TWILIO_AUTH_TOKEN': ''}):
            run(assistant.respond('s', 'Text Mom saying hello'))
            self.assertEqual(pressed, [])  # nothing before the yes
            sent = run(assistant.respond('s', 'Yes'))
            self.assertEqual((sent['say'], sent['open_url']), ('Sent to Mom on WhatsApp.', None))
            run(assistant.respond('s', 'Text Mom saying hello again'))
            fallback = run(assistant.respond('s', 'Yes'))
            self.assertTrue(fallback['open_url'].startswith('https://wa.me/14155550100'))

    def test_dictated_message_and_cancel(self):
        self.memory.add_contact('Alex', '+14155550111')
        assistant = self.assistant()
        draft = run(assistant.respond('s', 'Text Alex saying I am running late'))
        self.assertIn('Message to Alex: I am running late', draft['say'])
        cancelled = run(assistant.respond('s', 'No'))
        self.assertEqual((cancelled['intent'], cancelled['say']), ('message_cancel', 'Cancelled. Nothing was sent.'))
        self.assertEqual(run(assistant.respond('s', 'Yes'))['intent'], 'nothing_pending')


class WhereAndMemoryTests(Offline):
    def test_where_am_i_without_location(self):
        self.assertEqual(route('Where am I?'), 'where_am_i')
        self.assertEqual(route("What's around me?"), 'where_am_i')
        self.assertIn('do not have your location', run(self.assistant().respond('s', 'Where am I?'))['say'])

    def test_requests_and_places_are_remembered(self):
        run(self.assistant().respond('s', 'Buy me a coffee'))
        self.assertTrue(self.memory.visit('20th Street, Dogpatch'))
        self.assertFalse(self.memory.visit('20th Street, Dogpatch'))
        notes = [note['text'] for note in self.memory.notes()]
        self.assertIn('I was at 20th Street, Dogpatch.', notes)
        self.assertIn('I asked: "Buy me a coffee"', notes)
        self.assertEqual(route('Where was I today?'), 'recall')
        self.assertEqual(route('What did I ask you?'), 'recall')


class SignVocabularyTests(unittest.TestCase):
    def test_only_known_confident_signs_pass(self):
        self.assertEqual(bridge.parse_reading('{"text": "Thank You", "confidence": 0.9}')['text'], 'thank you')
        self.assertEqual(bridge.parse_reading('{"text": "i love you", "confidence": 0.8}')['text'], 'I love you')
        self.assertEqual(bridge.parse_reading('{"text": "banana", "confidence": 0.95}')['text'], '')
        self.assertEqual(bridge.parse_reading('{"text": "hello", "confidence": 0.4}')['text'], '')

    def test_focused_asl_vocabulary_accepts_requested_signs(self):
        for word in ('I / me', 'want', 'water', 'you', 'like', 'eat', 'apple', 'today', 'my', 'friend',
                     'go', 'school', 'tomorrow', 'we', 'play', 'basketball', 'please', 'help', 'find', 'book'):
            self.assertEqual(bridge.parse_reading(f'{{"text": "{word}", "confidence": 0.9}}')['text'], word)

    def test_cloud_reader_refuses_a_single_or_duplicate_frame(self):
        single = run(bridge.read_sign([(b'one-frame', 'image/jpeg')]))
        duplicate = run(bridge.read_sign([(b'same-frame', 'image/jpeg'), (b'same-frame', 'image/jpeg')]))
        self.assertEqual(single['text'], '')
        self.assertEqual(duplicate['text'], '')
        self.assertEqual(single['reason'], 'multiple_distinct_frames_required')

    def test_focused_asl_sequences_translate_in_asl_order(self):
        examples = {
            ('I / me', 'want', 'water'): 'I want water.',
            ('you', 'like', 'eat', 'apple'): 'Do you like eating apples?',
            ('today', 'my', 'friend', 'go', 'school'): 'My friend is going to school today.',
            ('tomorrow', 'we', 'play', 'basketball'): 'We’ll play basketball tomorrow.',
            ('please', 'help', 'I / me', 'find', 'book'): 'Please help me find the book.',
        }
        for signs, expected in examples.items():
            self.assertEqual(bridge.translate_sequence(list(signs)), expected)
        self.assertEqual(bridge.translate_sequence(['water', 'want']), '')


if __name__ == '__main__':
    unittest.main()
