from __future__ import annotations

import os
import unittest
from unittest import mock

try:
    from fastapi.testclient import TestClient
except ImportError:
    TestClient = None


@unittest.skipIf(TestClient is None, 'FastAPI is not installed')
class RecallApiTests(unittest.TestCase):
    """The three routes the GuideEye app's memory layer calls.

    The app shipped calling these before they existed, so every memory written
    on a phone met a 404 and was swallowed by the caller's `.catch`. These
    tests exist so that cannot happen again quietly.
    """

    @classmethod
    def setUpClass(cls):
        with mock.patch.dict(os.environ, {'MEMORY_DB': ':memory:', 'BAND_AUTOCONNECT': 'false'}):
            from backend.app import main
            cls.main = main
            cls.context = TestClient(main.app)
            cls.client = cls.context.__enter__()

    @classmethod
    def tearDownClass(cls):
        cls.context.__exit__(None, None, None)

    def test_status_always_answers(self):
        body = self.client.get('/v1/recall/status').json()
        self.assertIn('configured', body)
        # A server without a key says so rather than looking healthy.
        if not body['configured']:
            self.assertTrue(body['reason'])

    def test_remember_stores_a_note_and_its_relations(self):
        response = self.client.post('/v1/recall/remember', json={
            'kind': 'object',
            'content': 'The blue backpack is leaning against the chair',
        })
        self.assertEqual(response.status_code, 200)
        body = response.json()
        self.assertTrue(body['noteId'])
        self.assertIn(body['status'], {'synced', 'local', 'failed', 'skipped'})
        relations = {(r['subject'], r['object']) for r in body['relations']}
        self.assertIn(('blue backpack', 'chair'), relations)

    def test_remember_reports_local_when_supermemory_is_absent(self):
        with mock.patch.object(self.main.supermemory, 'configured', return_value=False):
            body = self.client.post('/v1/recall/remember', json={
                'kind': 'note', 'content': 'A kettle sits on the worktop',
            }).json()
        self.assertEqual(body['status'], 'local')
        self.assertIsNone(body['namespace'])

    def test_supporting_context_is_kept_with_the_memory(self):
        self.client.post('/v1/recall/remember', json={
            'kind': 'person',
            'content': 'Priya waits by the lift',
            'supportingContext': 'Recorded by a GuideEye user who is blind.',
        })
        texts = ' '.join(note['text'] for note in self.main.memory.notes())
        self.assertIn('Priya waits by the lift', texts)
        self.assertIn('Recorded by a GuideEye user who is blind.', texts)

    def test_empty_query_returns_no_results_rather_than_an_error(self):
        response = self.client.post('/v1/recall/search', json={'query': '   '})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['results'], [])

    def test_search_without_supermemory_is_empty_not_a_failure(self):
        with mock.patch.object(self.main.supermemory, 'configured', return_value=False):
            response = self.client.post('/v1/recall/search', json={'query': 'backpack'})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['results'], [])

    def test_search_attaches_local_graph_edges_to_a_hit(self):
        self.client.post('/v1/recall/remember', json={
            'kind': 'object', 'content': 'The lamp is next to the sofa',
        })

        async def fake_recall(question, limit=8):
            return [{'text': 'The lamp is next to the sofa', 'kind': 'object',
                     'score': 0.9, 'when': None, 'id': 'abc', 'title': ''}]

        with mock.patch.object(self.main.supermemory, 'configured', return_value=True), \
             mock.patch.object(self.main.supermemory, 'recall', side_effect=fake_recall):
            body = self.client.post('/v1/recall/search', json={'query': 'lamp'}).json()

        self.assertEqual(len(body['results']), 1)
        hit = body['results'][0]
        self.assertEqual(hit['similarity'], 0.9)
        self.assertTrue(any('sofa' in rel['text'] for rel in hit['related']))

    def test_kinds_filter_excludes_other_kinds(self):
        async def fake_recall(question, limit=8):
            return [
                {'text': 'A hazard by the steps', 'kind': 'hazard', 'score': 0.8, 'when': None, 'id': '1', 'title': ''},
                {'text': 'A person called Sam', 'kind': 'person', 'score': 0.7, 'when': None, 'id': '2', 'title': ''},
            ]

        with mock.patch.object(self.main.supermemory, 'configured', return_value=True), \
             mock.patch.object(self.main.supermemory, 'recall', side_effect=fake_recall):
            body = self.client.post('/v1/recall/search', json={'query': 'steps', 'kinds': ['hazard']}).json()

        self.assertEqual([hit['kind'] for hit in body['results']], ['hazard'])


if __name__ == '__main__':
    unittest.main()
