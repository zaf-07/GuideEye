from __future__ import annotations

import asyncio
import os
import unittest
from unittest import mock

from backend.app.services import bridge, llm, payments, vision
from backend.app.services.assistant import Assistant, route
from backend.app.services.memory import Memory, age
from backend.app.services.payments import Orders, PaymentError


def det(label, x1, x2):
    return vision.make_detection(label, 0.9, [x1, 0.2, x2, 0.8])


class FakeDetector:
    def __init__(self, detections): self.detections = detections
    def detect(self, image): return self.detections


def run(coroutine):
    return asyncio.run(coroutine)


class NoCloud(unittest.TestCase):
    """Every test runs offline: no cloud keys, no Stripe key."""
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {'GEMINI_API_KEY': '', 'GROQ_API_KEY': '', 'STRIPE_SECRET_KEY': ''})
        patcher.start()
        self.addCleanup(patcher.stop)


class RouteTests(unittest.TestCase):
    def test_intents(self):
        cases = {
            "What's in front of me?": 'see',
            'What does that sign say?': 'see',
            'Where did I leave my keys?': 'recall',
            'Where are my keys': 'recall',
            'What did that sign say?': 'recall',
            'Remember this': 'remember',
            'Buy me a coffee': 'pay_quote',
            'Forget everything': 'forget',
            'Start Bridge': 'bridge',
            'Call Alex': 'call',
            'Open WhatsApp': 'open_app',
            'yes': 'nothing_pending',
        }
        for text, intent in cases.items():
            self.assertEqual(route(text), intent, text)

    def test_only_yes_or_no_matters_while_an_order_is_pending(self):
        self.assertEqual(route('Yes, pay', True), 'pay_confirm')
        self.assertEqual(route('no thanks', True), 'pay_cancel')
        self.assertEqual(route('buy me a sandwich', True), 'pay_waiting')
        self.assertEqual(route('yesterday was nice', True), 'pay_waiting')


class MemoryTests(NoCloud):
    def test_age(self):
        self.assertEqual(age(5), 'just now')
        self.assertEqual(age(60), '1 minute ago')
        self.assertEqual(age(20 * 60), '20 minutes ago')
        self.assertEqual(age(3 * 3600), '3 hours ago')

    def test_remembers_latest_position_and_recalls_it(self):
        memory = Memory(':memory:')
        memory.record_detections([det('chair', 0.0, 0.3)], now=1000)
        memory.record_detections([det('chair', 0.7, 1.0)], now=1600)
        seen = memory.sightings()
        self.assertEqual((seen[0]['position'], seen[0]['times']), ('on the right', 2))
        self.assertEqual(memory.local_answer('Where is my chair?', now=1600 + 600), 'I last saw a chair on the right, 10 minutes ago.')

    def test_notes_answer_before_detector_sightings(self):
        memory = Memory(':memory:')
        memory.add_note('snapshot', 'Keys are on the kitchen counter next to the kettle.', now=1000)
        answer = run(memory.recall('Where did I leave my keys?'))
        self.assertEqual(answer['provider'], 'local')
        self.assertIn('kitchen counter', answer['text'])

    def test_unknown_things_are_not_invented(self):
        self.assertEqual(Memory(':memory:').local_answer('Where is my wallet?'), 'I have not seen that yet.')

    def test_clear_erases_everything(self):
        memory = Memory(':memory:')
        memory.add_note('snapshot', 'A red door.')
        memory.record_detections([det('chair', 0.4, 0.6)])
        memory.clear()
        self.assertEqual((memory.notes(), memory.sightings()), ([], []))


class PaymentTests(NoCloud):
    def test_quote_charges_nothing_and_confirm_pays_once(self):
        orders = Orders()
        order = orders.quote('s', 'buy me a coffee')
        self.assertEqual((order['item'], order['price']), ('one medium coffee', '$3.50'))
        receipt = run(orders.confirm('s'))
        self.assertEqual(receipt['mode'], 'simulated')
        with self.assertRaises(PaymentError):
            run(orders.confirm('s'))

    def test_unknown_item_is_never_quoted(self):
        self.assertIsNone(Orders().quote('s', 'buy me a helicopter'))

    def test_order_expires(self):
        orders = Orders()
        orders.quote('s', 'buy a tea', now=1000)
        self.assertIsNotNone(orders.pending('s', now=1000 + 30))
        self.assertIsNone(orders.pending('s', now=1000 + payments.ORDER_TTL_SECONDS + 1))

    def test_orders_are_per_session(self):
        orders = Orders()
        orders.quote('alice', 'buy a tea')
        self.assertIsNone(orders.pending('bob'))

    def test_only_test_keys_are_accepted(self):
        self.assertTrue(payments.is_test_key('sk_test_abc'))
        self.assertTrue(payments.is_test_key('rk_test_abc'))
        self.assertFalse(payments.is_test_key('sk_live_abc'))
        self.assertFalse(payments.is_test_key('rk_live_abc'))

    def test_live_stripe_key_is_refused(self):
        with mock.patch.dict(os.environ, {'STRIPE_SECRET_KEY': 'sk_live_not_a_real_key'}):
            with self.assertRaises(PaymentError):
                run(payments.charge({'id': 'x', 'item': 'tea', 'amount': 300, 'currency': 'usd'}))


class AssistantTests(NoCloud):
    def make(self, detections=()):
        self.memory = Memory(':memory:')
        return Assistant(self.memory, Orders(), FakeDetector(list(detections)))

    def test_payment_needs_a_spoken_yes(self):
        assistant = self.make()
        quote = run(assistant.respond('s', 'Buy me a latte'))
        self.assertEqual(quote['intent'], 'pay_quote')
        self.assertIn('$4.50', quote['say'])
        self.assertIn('Say yes', quote['say'])
        other = run(assistant.respond('s', 'what is in front of me'))
        self.assertEqual(other['intent'], 'pay_waiting')
        paid = run(assistant.respond('s', 'Yes'))
        self.assertEqual(paid['intent'], 'pay_confirm')
        self.assertIn('simulated', paid['say'])
        self.assertIn('latte', self.memory.notes()[0]['text'])

    def test_no_cancels_without_paying(self):
        assistant = self.make()
        run(assistant.respond('s', 'Buy me a coffee'))
        reply = run(assistant.respond('s', 'No'))
        self.assertEqual(reply['say'], 'Cancelled. Nothing was paid.')
        self.assertEqual(run(assistant.respond('s', 'yes'))['intent'], 'nothing_pending')

    def test_unknown_item_is_refused(self):
        reply = run(self.make().respond('s', 'Buy me a helicopter'))
        self.assertIsNone(reply['order'])
        self.assertIn('will not pay', reply['say'])

    def test_seeing_needs_a_camera_frame(self):
        self.assertIn('camera', run(self.make().respond('s', "What's in front of me?"))['say'])

    def test_call_requires_confirmation_and_returns_dial_url(self):
        assistant = self.make()
        self.memory.add_contact('Alex', '+14155550111')
        draft = run(assistant.respond('s', 'Call Alex'))
        self.assertEqual(draft['intent'], 'call')
        self.assertEqual(draft['confirm'], 'Call Alex?')
        called = run(assistant.respond('s', 'Yes'))
        self.assertEqual(called['open_url'], 'tel:14155550111')
        self.assertEqual(called['say'], 'Calling Alex.')

    def test_open_app_uses_allowlisted_url(self):
        reply = run(self.make().respond('s', 'Open WhatsApp'))
        self.assertEqual((reply['intent'], reply['open_url']), ('open_app', 'whatsapp://'))

    def test_see_then_recall_offline(self):
        assistant = self.make([det('chair', 0.2, 0.5)])
        seen = run(assistant.respond('s', "What's in front of me?", b'frame'))
        self.assertEqual((seen['provider'], seen['warnings']), ('local', ['Chair ahead, left.']))
        recalled = run(assistant.respond('s', 'Where is my chair?'))
        self.assertEqual(recalled['intent'], 'recall')
        self.assertIn('chair ahead, left', recalled['say'])

    def test_remember_then_forget(self):
        assistant = self.make([det('backpack', 0.4, 0.6)])
        saved = run(assistant.respond('s', 'Remember this', b'frame'))
        self.assertIn('backpack', saved['say'])
        self.assertEqual([n['kind'] for n in self.memory.notes()].count('snapshot'), 1)
        run(assistant.respond('s', 'Forget everything'))
        self.assertEqual(self.memory.notes(), [])


class BridgeTests(unittest.TestCase):
    def test_low_confidence_or_bad_output_is_dropped(self):
        self.assertEqual(bridge.parse_reading('{"text": "hello", "confidence": 0.9}'), {'text': 'hello', 'confidence': 0.9})
        self.assertEqual(bridge.parse_reading('{"text": "hello", "confidence": 0.3}')['text'], '')
        self.assertEqual(bridge.parse_reading('not json'), {'text': '', 'confidence': 0.0})

    def test_default_model_is_the_fast_one(self):
        with mock.patch.dict(os.environ, {'GEMINI_MODEL': ''}):
            os.environ.pop('GEMINI_MODEL')
            self.assertEqual(llm.model(), 'gemini-flash-lite-latest')


if __name__ == '__main__':
    unittest.main()
