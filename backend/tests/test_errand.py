from __future__ import annotations

import asyncio
import os
import unittest
from unittest import mock

from backend.app.services import errand
from backend.app.services.assistant import Assistant, route
from backend.app.services.memory import Memory
from backend.app.services.payments import Orders


def run(coroutine):
    return asyncio.run(coroutine)


class FakeErrands:
    ErrandError = errand.ErrandError

    def __init__(self, answers, ready=True):
        self.answers = list(answers)
        self.ready = ready
        self.started = []
        self.waited = []
        self.fail = False

    def configured(self):
        return self.ready

    def _task(self, status, text=''):
        return {'id': f'resp_{len(self.started)}', 'session_id': 'hsess1', 'status': status,
                'done': status != 'in_progress', 'text': text}

    async def start(self, text, user, image=None, mime='image/jpeg', previous=None):
        if self.fail:
            raise errand.ErrandError('unreachable')
        self.started.append({'text': text, 'user': user, 'image': image, 'previous': previous})
        return self._task('in_progress')

    async def wait(self, response_id, seconds):
        self.waited.append(seconds)
        status, text = self.answers.pop(0)
        return self._task(status, text)

    async def get(self, response_id):
        status, text = self.answers.pop(0)
        return self._task(status, text)


class ErrandTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {'GEMINI_API_KEY': '', 'GROQ_API_KEY': '', 'STRIPE_SECRET_KEY': '',
                                               'SUPERMEMORY_API_KEY': ''})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.memory = Memory(':memory:')

    def assistant(self, errands):
        return Assistant(self.memory, Orders(), errands=errands)

    def test_route_sends_documents_to_the_errand_agent(self):
        self.assertEqual(route('read this letter and tell me what to do'), 'errand')
        self.assertEqual(route('explain this discharge summary'), 'errand')
        self.assertEqual(route('look up when the pharmacy closes'), 'errand')
        self.assertEqual(route('can you explain this to me'), 'errand')
        self.assertEqual(route('read this and tell me what to do'), 'errand')
        self.assertEqual(route('what does this mean'), 'errand')
        self.assertEqual(route('can you read this'), 'see')
        self.assertEqual(route('what is in front of me'), 'see')
        self.assertEqual(route('buy me a coffee'), 'pay_quote')
        self.assertEqual(route('remember this letter is on the desk'), 'remember')

    def test_finished_errand_is_spoken_and_remembered(self):
        errands = FakeErrands([('completed', 'It is a clinic bill. Pay 40 dollars by Friday.')])
        reply = run(self.assistant(errands).respond('s1', 'Explain this bill', b'jpeg'))
        self.assertEqual(reply['intent'], 'errand')
        self.assertEqual(reply['say'], 'It is a clinic bill. Pay 40 dollars by Friday.')
        self.assertEqual(reply['errand'], {'id': 'resp_1', 'status': 'completed'})
        self.assertEqual(errands.started[0]['user'], 'guideeye-s1')
        self.assertEqual(errands.started[0]['image'], b'jpeg')
        self.assertTrue(any(note['kind'] == 'errand' for note in self.memory.notes()))

    def test_slow_errand_is_reported_then_checked(self):
        errands = FakeErrands([('in_progress', ''), ('completed', 'The letter asks you to renew by May.')])
        assistant = self.assistant(errands)
        first = run(assistant.respond('s1', 'Read this letter and tell me what to do'))
        self.assertIn('still working', first['say'])
        second = run(assistant.respond('s1', 'is my errand ready'))
        self.assertEqual(second['intent'], 'errand_status')
        self.assertEqual(second['say'], 'The letter asks you to renew by May.')
        self.assertEqual(len(errands.started), 1)

    def test_web_research_returns_control_after_eight_seconds(self):
        errands = FakeErrands([('in_progress', '')])
        reply = run(self.assistant(errands).respond('s1', 'What is the price of this object?'))
        self.assertEqual(reply['intent'], 'web_lookup')
        self.assertEqual(errands.waited, [8.0])
        self.assertIn('Search the public web', errands.started[0]['text'])
        self.assertIn('Stop immediately after one blocked page', errands.started[0]['text'])
        self.assertIn('automatically', reply['say'])

    def test_yes_continues_the_same_task_and_no_drops_it(self):
        errands = FakeErrands([('completed', 'I drafted a reply. Should I go ahead?'), ('completed', 'The draft is ready.')])
        assistant = self.assistant(errands)
        run(assistant.respond('s1', 'Read this letter and draft a reply'))
        reply = run(assistant.respond('s1', 'yes'))
        self.assertEqual(reply['intent'], 'errand_followup')
        self.assertEqual(errands.started[1]['previous']['id'], 'resp_1')
        self.assertEqual(errands.started[1]['previous']['session_id'], 'hsess1')
        other = FakeErrands([('completed', 'I filled in the form. Should I go ahead?')])
        assistant = self.assistant(other)
        run(assistant.respond('s2', 'Fill out this form'))
        self.assertEqual(run(assistant.respond('s2', 'no'))['intent'], 'errand_dismiss')
        self.assertEqual(len(other.started), 1)

    def test_failed_or_unconfigured_errand_never_pretends(self):
        reply = run(self.assistant(FakeErrands([], ready=False)).respond('s1', 'Explain this bill'))
        self.assertIn('not set up', reply['say'])
        reply = run(self.assistant(FakeErrands([('failed', '')])).respond('s1', 'Explain this bill'))
        self.assertIn('could not finish', reply['say'])
        broken = FakeErrands([])
        broken.fail = True
        self.assertIn('could not reach', run(self.assistant(broken).respond('s1', 'Explain this bill'))['say'])

    def test_answer_is_the_last_message_and_key_stays_out_of_summaries(self):
        response = {'id': 'resp_9', 'status': 'completed', 'metadata': {'session_id': 'hsess9'}, 'output': [
            {'type': 'message', 'content': [{'type': 'output_text', 'text': 'Working on it.'}]},
            {'type': 'function_call', 'name': 'read'},
            {'type': 'message', 'content': [{'type': 'output_text', 'text': 'Take one tablet daily.'}]}]}
        self.assertEqual(errand.summary(response), {'id': 'resp_9', 'session_id': 'hsess9', 'status': 'completed',
                                                    'done': True, 'text': 'Take one tablet daily.'})
        with mock.patch.dict(os.environ, {'HR_API_KEY': '', 'HR_HARNESS_ID': 'chrn_x'}):
            self.assertFalse(errand.configured())


if __name__ == '__main__':
    unittest.main()
