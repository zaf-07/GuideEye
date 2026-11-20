"""Free-form commands, the conversation so far, and the detector's scan history."""
import asyncio
import json
import os
import unittest
from unittest import mock

from fastapi.testclient import TestClient

from backend.app.services import llm, vision
from backend.app.services.assistant import Assistant, contact_edit, route
from backend.app.services.memory import Memory
from backend.app.services.payments import Orders


def run(coroutine):
    return asyncio.run(coroutine)


def seen(label, position='ahead', distance=None):
    return {'label': label, 'position': position, 'area': 0.2, 'distance_m': distance}


class FakeDetector:
    def detect(self, image): return []


class Offline(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {'GEMINI_API_KEY': '', 'GROQ_API_KEY': '', 'MINIMAX_API_KEY': '',
                                               'STRIPE_SECRET_KEY': '', 'SUPERMEMORY_API_KEY': ''})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.memory = Memory(':memory:')
        self.assistant = Assistant(self.memory, Orders(), detector=FakeDetector())

    def ask(self, text, session='s', **more):
        return run(self.assistant.respond(session, text, **more))

    def names(self):
        return [contact['name'] for contact in self.memory.contacts()]


class ContactRequestTests(unittest.TestCase):
    def test_spoken_requests_are_recognised(self):
        self.assertEqual(contact_edit('can you go to my contact and change the name for Lee'),
                         {'kind': 'rename', 'name': 'Lee', 'new_name': '', 'phone': ''})
        self.assertEqual(contact_edit('Rename my contact Lee as Leo Kim please')['new_name'], 'Leo Kim')
        self.assertEqual(contact_edit("change Lee's number to +1 415 555 0100")['phone'], '14155550100')
        self.assertEqual(contact_edit('remove Lee from my contacts')['kind'], 'remove')
        self.assertEqual(contact_edit('who is in my contacts')['kind'], 'list')

    def test_other_requests_are_left_alone(self):
        for text, intent in {
            'change my home address to 12 Main Street': 'place_set',
            'set a timer for 5 minutes': 'timer',
            'delete my memory': 'forget',
            'call Lee': 'call',
            'add a contact named Sam': 'contact_add',
            'what is the name of this street': 'see',
            'remove the chair': 'see',
        }.items():
            self.assertIsNone(contact_edit(text), text)
            self.assertEqual(route(text), intent, text)


class ContactEditTests(Offline):
    def setUp(self):
        super().setUp()
        self.memory.add_contact('Lee', '+14155550100')
        self.memory.add_contact('Mom', '+14155550111')

    def test_the_request_from_the_demo_asks_for_the_new_name_then_renames(self):
        reply = self.ask('can you go to my contact and change the name for Lee', image=b'frame')
        self.assertEqual(reply['intent'], 'contact_edit_waiting')
        self.assertEqual(reply['say'], "What should Lee's new name be?")
        reply = self.ask('call him Leo')
        self.assertEqual(reply['intent'], 'contact_renamed')
        self.assertEqual(reply['say'], 'Done. Lee is now saved as Leo.')
        self.assertEqual(self.names(), ['Leo', 'Mom'])
        self.assertEqual(self.memory.find_contact('Leo')['phone'], '14155550100')

    def test_rename_in_one_sentence(self):
        reply = self.ask('rename Lee to Leo')
        self.assertEqual(reply['intent'], 'contact_renamed')
        self.assertEqual(self.names(), ['Leo', 'Mom'])

    def test_unknown_name_is_taken_as_the_new_name(self):
        reply = self.ask('change the name for Sam')
        self.assertIn('Which contact should I rename to Sam?', reply['say'])
        self.assertIn('Lee and Mom', reply['say'])
        reply = self.ask('Lee')
        self.assertEqual(reply['intent'], 'contact_renamed')
        self.assertEqual(self.names(), ['Mom', 'Sam'])

    def test_a_name_already_in_use_is_refused(self):
        reply = self.ask('rename Lee to Mom')
        self.assertIn('already have a contact called Mom', reply['say'])
        self.assertEqual(self.names(), ['Lee', 'Mom'])

    def test_removing_needs_a_yes(self):
        reply = self.ask('delete contact Lee')
        self.assertEqual(reply['confirm'], 'Remove Lee from your contacts?')
        self.assertEqual(self.names(), ['Lee', 'Mom'])
        self.assertEqual(self.ask('what')['intent'], 'contact_edit_waiting')
        self.assertEqual(self.names(), ['Lee', 'Mom'])
        self.assertEqual(self.ask('yes')['intent'], 'contact_removed')
        self.assertEqual(self.names(), ['Mom'])

    def test_no_cancels_and_changes_nothing(self):
        self.ask('delete contact Lee')
        self.assertEqual(self.ask('no')['intent'], 'contact_edit_cancel')
        self.assertEqual(self.names(), ['Lee', 'Mom'])
        self.assertEqual(self.ask('yes')['intent'], 'nothing_pending')

    def test_number_change_asks_for_a_missing_number(self):
        reply = self.ask('update the phone number for Lee')
        self.assertIn("Lee's new WhatsApp number", reply['say'])
        reply = self.ask('plus one four one five five five five zero one nine nine')
        self.assertEqual(reply['intent'], 'contact_updated')
        self.assertEqual(self.memory.find_contact('Lee')['phone'], '14155550199')

    def test_listing_contacts(self):
        self.assertEqual(self.ask('who is in my contacts')['say'], 'You have 2 contacts: Lee and Mom.')

    def test_another_request_leaves_the_half_finished_change(self):
        self.ask('rename Lee')
        reply = self.ask('set a timer for 5 minutes')
        self.assertEqual(reply['intent'], 'timer')
        self.assertEqual(self.names(), ['Lee', 'Mom'])

    def test_with_no_contacts_it_says_so(self):
        self.memory.remove_contact('Lee')
        self.memory.remove_contact('Mom')
        self.assertIn('no contacts yet', self.ask('rename Lee to Leo')['say'])


class ConversationTests(Offline):
    def setUp(self):
        super().setUp()
        self.memory.add_contact('Lee', '+14155550100')

    def test_turns_are_kept_per_session_and_capped(self):
        for index in range(12):
            self.ask(f'remember that box {index} is in the hall')
        lines = self.assistant.conversation('s').split('\n')
        self.assertEqual(len(lines), 16)
        self.assertIn('box 11', lines[-2])
        self.assertTrue(lines[-1].startswith('GuideEye: '))
        self.assertEqual(self.assistant.conversation('someone-else'), '')

    def test_an_old_conversation_is_dropped(self):
        self.ask('hello')
        with mock.patch('backend.app.services.assistant.time.time', return_value=1e12):
            self.assertEqual(self.assistant.conversation('s'), '')

    def test_him_is_the_contact_just_talked_about(self):
        self.ask('call Lee')
        self.ask('no')
        reply = self.ask('call him')
        self.assertEqual(reply['confirm'], 'Call Lee?')
        self.ask('no')
        reply = self.ask('rename him to Leo')
        self.assertEqual(reply['intent'], 'contact_renamed')

    def test_erasing_memory_also_drops_the_conversation(self):
        self.ask('hello')
        self.ask('forget everything')
        self.assertNotIn('hello', self.assistant.conversation('s'))


class UnderstandingTests(Offline):
    """The language model only rewrites a request; rules and yes-or-no gates still decide."""
    def setUp(self):
        super().setUp()
        self.memory.add_contact('Lee', '+14155550100')
        self.prompts = []

    def model(self, *answers):
        replies = list(answers)

        async def complete(parts, system='', json_mode=False, timeout=10.0):
            self.prompts.append(parts[-1]['text'])
            answer = replies.pop(0)
            return answer if isinstance(answer, str) else json.dumps(answer)
        patcher = mock.patch.dict(os.environ, {'GROQ_API_KEY': 'x'})
        patcher.start()
        self.addCleanup(patcher.stop)
        patcher = mock.patch.object(llm, 'complete', complete)
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_a_reworded_command_runs_but_still_asks_first(self):
        self.model({'action': 'command', 'command': 'rename contact Lee to Leo'})
        reply = self.ask('my friend Lee goes by Leo these days, fix that up')
        self.assertEqual(reply['confirm'], 'Rename Lee to Leo?')
        self.assertTrue(reply['inferred'])
        self.assertEqual(reply['heard'], 'my friend Lee goes by Leo these days, fix that up')
        self.assertEqual(self.names(), ['Lee'])
        self.assertEqual(self.ask('yes')['intent'], 'contact_renamed')
        self.assertEqual(self.names(), ['Leo'])

    def test_the_model_sees_contacts_and_earlier_turns(self):
        self.model({'action': 'answer', 'say': 'Sure.'}, {'action': 'answer', 'say': 'Okay.'})
        self.ask('I am meeting someone later')
        self.ask('it is going to be fun')
        self.assertIn('Saved contacts: Lee.', self.prompts[1])
        self.assertIn('User: I am meeting someone later\nGuideEye: Sure.', self.prompts[1])
        self.assertTrue(self.prompts[1].endswith('The person now says: it is going to be fun'))

    def test_the_model_cannot_erase_memory_or_answer_a_yes(self):
        self.memory.add_note('note', 'Keys are on the desk')
        self.model({'action': 'command', 'command': 'forget everything'}, 'I did not follow that.')
        reply = self.ask('tidy things up for me')
        self.assertNotEqual(reply['intent'], 'forget')
        self.assertTrue(self.memory.notes())

    def test_a_payment_worked_out_by_the_model_waits_for_yes(self):
        self.model({'action': 'command', 'command': 'buy coffee'})
        reply = self.ask('I could really use a coffee, sort that out')
        self.assertEqual(reply['intent'], 'pay_quote')
        self.assertTrue(reply['confirm'])

    def test_a_camera_question_still_reaches_the_camera(self):
        self.model({'action': 'look'})
        described = mock.AsyncMock(return_value={'text': 'The door is open.', 'provider': 'groq'})
        with mock.patch.object(vision, 'describe', described):
            reply = self.ask('is the door open', image=b'frame')
        self.assertEqual(reply['say'], 'The door is open.')

    def test_a_follow_up_question_carries_the_conversation_to_the_camera(self):
        self.model()
        described = mock.AsyncMock(return_value={'text': 'A red mug on the desk.', 'provider': 'groq'})
        with mock.patch.object(vision, 'describe', described):
            self.ask('what is in front of me', image=b'frame')
            self.ask('what colour is it', image=b'frame')
        question = described.await_args_list[1].args[2]
        self.assertTrue(question.startswith('what colour is it'))
        self.assertIn('GuideEye: A red mug on the desk.', question)

    def test_a_broken_answer_falls_back_to_chat(self):
        self.model('not json at all', 'Happy to help.')
        reply = self.ask('you are pretty useful')
        self.assertEqual((reply['intent'], reply['say']), ('chat', 'Happy to help.'))

    def test_a_recall_question_uses_memory(self):
        self.memory.add_note('note', 'Keys are on the desk')
        self.model({'action': 'recall', 'command': 'where are the keys'}, 'Your keys are on the desk.')
        reply = self.ask('and the keys, any idea')
        self.assertEqual((reply['intent'], reply['say']), ('recall', 'Your keys are on the desk.'))
        self.assertIn('Question: where are the keys', self.prompts[1])


class ScanHistoryTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {'GEMINI_API_KEY': '', 'GROQ_API_KEY': '', 'MINIMAX_API_KEY': '',
                                               'SUPERMEMORY_API_KEY': ''})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.memory = Memory(':memory:')

    def test_frames_a_moment_apart_are_one_scan(self):
        self.memory.record_detections([seen('chair', 'on the left'), seen('dining table')], now=1000)
        self.memory.record_detections([seen('chair')], now=1003)
        self.memory.record_detections([seen('laptop')], now=1006)
        scans = self.memory.scans()
        self.assertEqual(len(scans), 1)
        self.assertEqual([item['label'] for item in scans[0]['items']], ['chair', 'dining table', 'laptop'])
        self.assertEqual(scans[0]['items'][0]['position'], 'ahead')
        self.assertEqual((scans[0]['t'], scans[0]['until']), (1000, 1006))

    def test_an_unchanged_view_extends_the_scan_and_a_new_object_starts_one(self):
        self.memory.record_detections([seen('chair')], now=1000)
        self.memory.record_detections([seen('chair')], now=1090)
        self.assertEqual(len(self.memory.scans()), 1)
        self.memory.record_detections([seen('person', distance=1.44)], now=1150)
        scans = self.memory.scans()
        self.assertEqual(len(scans), 2)
        self.assertEqual(scans[0]['items'], [{'label': 'person', 'position': 'ahead', 'distance_m': 1.4}])

    def test_the_same_object_hours_later_or_elsewhere_is_a_new_scan(self):
        self.memory.record_detections([seen('chair')], now=1000, place='Main Library')
        self.memory.record_detections([seen('chair')], now=9000, place='Main Library')
        self.memory.record_detections([seen('chair')], now=9005, place='Cafe')
        self.assertEqual([scan['place'] for scan in self.memory.scans()], ['Cafe', 'Main Library', 'Main Library'])

    def test_history_is_capped(self):
        for index in range(450):
            self.memory.record_detections([seen(f'thing {index}')], now=1000 + index * 20)
        scans = self.memory.scans(1000)
        self.assertEqual(len(scans), 400)
        self.assertEqual(scans[0]['items'][0]['label'], 'thing 449')

    def test_recall_says_what_was_around_a_thing(self):
        self.memory.record_detections([seen('chair', 'on the left'), seen('dining table')], now=1000, place='Main Library')
        self.memory.record_detections([seen('person')], now=4000, place='Cafe')
        self.assertEqual(self.memory.local_answer('what was around the chair?', now=4600),
                         '1 hour ago near Main Library I saw a chair on the left, with a dining table ahead.')
        self.assertEqual(self.memory.local_answer('where did I see a table?', now=4600),
                         'I last saw a dining table ahead, 1 hour ago, near Main Library, with a chair on the left.')
        self.assertTrue(self.memory.local_answer('what have you seen?', now=4600).startswith(
            'Most recently, 10 minutes ago near Cafe, I saw a person ahead. Before that, 1 hour ago near Main Library'))

    def test_the_language_model_is_given_the_scans(self):
        self.memory.record_detections([seen('chair'), seen('laptop', 'on the right')], now=1000, place='Main Library')
        context = self.memory.context(now=1300)
        self.assertIn('- camera scan, 5 minutes ago near Main Library: a chair ahead and a laptop on the right', context)

    def test_erasing_memory_erases_the_scans(self):
        self.memory.record_detections([seen('chair')], now=1000)
        self.memory.clear()
        self.assertEqual(self.memory.scans(), [])

    def test_route_sends_history_questions_to_recall(self):
        for text in ('what was around the chair', 'what have you seen today', 'when did you last see my bag',
                     'what objects did you see'):
            self.assertEqual(route(text), 'recall', text)
        self.assertEqual(route('what is around me'), 'where_am_i')


class SightingsApiTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {'GEMINI_API_KEY': '', 'GROQ_API_KEY': '', 'MINIMAX_API_KEY': '',
                                               'SUPERMEMORY_API_KEY': '', 'MEMORY_DB': ':memory:'})
        patcher.start()
        self.addCleanup(patcher.stop)
        from backend.app import main
        self.main = main
        self.fresh = Memory(':memory:')
        for target in (main, main.assistant):
            patcher = mock.patch.object(target, 'memory', self.fresh)
            patcher.start()
            self.addCleanup(patcher.stop)
        self.client = TestClient(main.app)

    def test_a_phone_reports_what_its_detector_sees(self):
        body = {'detections': [{'label': 'Chair', 'position': 'On your left', 'distance_m': 2.5},
                               {'label': '<>', 'position': 'x'}, {'position': 'ahead'}]}
        self.assertEqual(self.client.post('/memory/sightings', json=body).json(), {'recorded': 1})
        scans = self.client.get('/memory').json()['scans']
        self.assertEqual(scans[0]['items'], [{'label': 'chair', 'position': 'on your left', 'distance_m': 2.5}])

    def test_the_assistant_takes_detections_with_a_request(self):
        seen_now = json.dumps([{'label': 'laptop', 'position': 'ahead', 'distance_m': 0.8}])
        reply = self.client.post('/assistant', data={'text': 'what have you seen', 'detections': seen_now}).json()
        self.assertEqual(reply['intent'], 'recall')
        self.assertIn('a laptop ahead, about 0.8 metres away', reply['say'])
        self.assertEqual(self.client.post('/assistant', data={'text': 'hello', 'detections': 'not json'}).status_code, 200)


if __name__ == '__main__':
    unittest.main()
