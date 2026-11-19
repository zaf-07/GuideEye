"""The relationship graph and the Supermemory mirror."""
from __future__ import annotations

import asyncio
import time
import unittest
from unittest import mock

from backend.app.services import graph, supermemory
from backend.app.services.memory import Memory


class ExtractTests(unittest.TestCase):
    def test_pulls_a_simple_relationship(self):
        self.assertIn(('keys', 'on', 'kitchen counter'),
                      graph.extract('The keys are on the kitchen counter.'))

    def test_chains_relationships(self):
        triples = graph.extract('The keys are on the kitchen counter, next to the kettle.')
        self.assertEqual(triples, [('keys', 'on', 'kitchen counter'),
                                   ('kitchen counter', 'next_to', 'kettle')])

    def test_longest_preposition_wins(self):
        self.assertEqual(graph.extract('The chair is in front of the door.'),
                         [('chair', 'in_front_of', 'door')])

    def test_the_user_is_a_node(self):
        self.assertEqual(graph.extract('I was at Blue Bottle Coffee.'),
                         [(graph.USER, 'at', 'blue bottle coffee')])

    def test_ignores_the_log_of_requests(self):
        self.assertEqual(graph.extract('I asked where my keys are.'), [])

    def test_no_relationship_no_triples(self):
        self.assertEqual(graph.extract('Hello there.'), [])


class GraphMemoryTests(unittest.TestCase):
    def setUp(self):
        self.memory = Memory(':memory:')
        self.now = time.time()

    def test_a_note_builds_the_graph(self):
        self.memory.add_note('snapshot', 'The keys are on the kitchen counter, next to the kettle.')
        snapshot = self.memory.graph_snapshot()
        edges = {(e['subject'], e['relation'], e['object']) for e in snapshot['edges']}
        self.assertIn(('keys', 'on', 'kitchen counter'), edges)
        self.assertIn('kettle', {n['name'] for n in snapshot['nodes']})

    def test_walks_two_hops_out(self):
        self.memory.add_note('snapshot', 'The keys are on the kitchen counter, next to the kettle.')
        reached = {e['object'] for e in self.memory.neighbours('keys', depth=2)}
        self.assertIn('kettle', reached)  # only reachable through the counter

    def test_one_hop_stops_short(self):
        self.memory.add_note('snapshot', 'The keys are on the kitchen counter, next to the kettle.')
        reached = {e['object'] for e in self.memory.neighbours('keys', depth=1)}
        self.assertNotIn('kettle', reached)

    def test_graph_context_mentions_the_connection(self):
        self.memory.add_note('snapshot', 'The keys are on the kitchen counter, next to the kettle.')
        context = self.memory.graph_context('where did I leave my keys?')
        self.assertIn('keys is on kitchen counter', context)

    def test_offline_answer_falls_back_to_the_graph(self):
        # A note whose wording shares no keyword with the question.
        self.memory.add_note('snapshot', 'A worn leather wallet is on the hall shelf.')
        self.assertIn('hall shelf', self.memory.local_answer('where is the wallet'))

    def test_a_question_is_not_answered_with_itself(self):
        self.memory.add_note('snapshot', 'The keys are on the kitchen counter.')
        self.memory.add_note('asked', 'I asked where my keys are.')
        self.assertIn('kitchen counter', self.memory.local_answer('where are my keys'))

    def test_erasing_memory_erases_the_graph(self):
        self.memory.add_note('snapshot', 'The keys are on the kitchen counter.')
        self.memory.clear()
        self.assertEqual(self.memory.graph_snapshot()['edges'], [])
        self.assertEqual(self.memory.graph_snapshot()['nodes'], [])

    def test_repeated_sightings_do_not_duplicate_edges(self):
        for _ in range(3):
            self.memory.add_note('snapshot', 'The keys are on the kitchen counter.')
        self.assertEqual(len(self.memory.graph_snapshot()['edges']), 1)


class SupermemoryTests(unittest.TestCase):
    def setUp(self):
        self.memory = Memory(':memory:')

    def test_off_by_default(self):
        with mock.patch.dict('os.environ', {}, clear=False):
            import os
            os.environ.pop('SUPERMEMORY_API_KEY', None)
            self.assertFalse(supermemory.configured())
            self.assertFalse(self.memory.remote_status()['configured'])

    def test_paths_are_namespace_scoped(self):
        import os
        with mock.patch.dict(os.environ, {'SUPERMEMORY_NAMESPACE': 'wearer-7'}):
            self.assertEqual(supermemory.namespace(), 'wearer-7')
            self.assertEqual(supermemory.ingest_path(), '/ns/wearer-7/document')
            self.assertEqual(supermemory.search_path(), '/ns/wearer-7/search')

    def test_search_body_uses_the_v5_field_names(self):
        body = supermemory.search_body('where are my keys?', limit=5)
        self.assertEqual(body['query'], 'where are my keys?')
        self.assertNotIn('q', body)
        self.assertNotIn('containerTag', body)
        # rerank is a mode in v5, not a boolean.
        self.assertEqual(body['rerank'], 'order')

    def test_document_body_uses_the_v5_field_names(self):
        body = supermemory.document_body('The keys are on the counter.', 'snapshot', 1700000000.0)
        self.assertIn('date', body)
        self.assertIn('supportingContext', body)
        self.assertNotIn('documentDate', body)
        self.assertNotIn('entityContext', body)
        self.assertNotIn('containerTag', body)

    def test_parses_a_memory_result(self):
        parsed = supermemory.parse_results({'results': [
            {'memory': {'content': 'keys on the counter'}, 'score': 0.9,
             'metadata': {'kind': 'snapshot', 'recorded': '2026-01-01T00:00:00Z'}, 'id': 'm1'},
        ]})
        self.assertEqual(parsed[0]['text'], 'keys on the counter')
        self.assertEqual(parsed[0]['kind'], 'snapshot')

    def test_parses_a_chunk_only_result(self):
        # A result may carry a chunk instead of a memory; branch on presence.
        parsed = supermemory.parse_results({'results': [{'chunk': {'content': 'hall shelf'}, 'score': 0.5}]})
        self.assertEqual(parsed[0]['text'], 'hall shelf')

    def test_ignores_an_empty_result(self):
        self.assertEqual(supermemory.parse_results({'results': [{'score': 0.1}]}), [])

    def test_composed_note_spells_out_the_relationships(self):
        body = supermemory.compose(
            'The keys are on the counter.', 'snapshot', 1700000000.0, place='home',
            triples=[('keys', 'on', 'counter')],
        )
        self.assertIn('The keys are on the counter.', body)
        self.assertIn('Where: home.', body)
        self.assertIn('Relationship: keys -> on -> counter.', body)

    def test_a_failed_mirror_still_keeps_the_note(self):
        async def scenario():
            with mock.patch.dict('os.environ', {'SUPERMEMORY_API_KEY': 'test-key'}):
                with mock.patch.object(
                    supermemory, 'remember',
                    side_effect=supermemory.SupermemoryError('network down'),
                ):
                    self.memory.add_note('snapshot', 'The keys are on the counter.')
                    await self.memory.flush()
        asyncio.run(scenario())
        self.assertEqual(len(self.memory.notes()), 1)
        self.assertEqual(self.memory.remote_errors, 1)

    def test_requests_are_synced_by_default(self):
        # They are most of what GuideEye knows; holding them back left the
        # long-term memory permanently empty.
        async def scenario():
            with mock.patch.dict('os.environ', {'SUPERMEMORY_API_KEY': 'test-key'}):
                with mock.patch.object(supermemory, 'remember') as remember:
                    self.memory.add_note('asked', 'I asked for a coffee.')
                    await self.memory.flush()
                    remember.assert_called_once()
        asyncio.run(scenario())
        self.assertEqual(self.memory.remote_status()['skipped_requests'], 0)

    def test_requests_can_be_kept_local_and_are_counted(self):
        # Skipping must stay visible: a silent drop is indistinguishable from a
        # broken key when requests are the only notes being written.
        async def scenario():
            with mock.patch.dict('os.environ', {'SUPERMEMORY_API_KEY': 'test-key',
                                                'SUPERMEMORY_MIRROR_REQUESTS': 'false'}):
                with mock.patch.object(supermemory, 'remember') as remember:
                    self.memory.add_note('asked', 'I asked for a coffee.')
                    await self.memory.flush()
                    remember.assert_not_called()
        asyncio.run(scenario())
        with mock.patch.dict('os.environ', {'SUPERMEMORY_MIRROR_REQUESTS': 'false'}):
            status = self.memory.remote_status()
        self.assertEqual(status['skipped_requests'], 1)
        self.assertFalse(status['mirrors_requests'])

    def test_backfill_sends_everything_already_stored(self):
        # Notes written before a key was configured never left the device.
        self.memory.add_note('snapshot', 'A mug is on the desk.')
        self.memory.add_note('asked', 'I asked about the weather.')
        async def scenario():
            with mock.patch.dict('os.environ', {'SUPERMEMORY_API_KEY': 'test-key'}):
                with mock.patch.object(supermemory, 'remember') as remember:
                    result = await self.memory.sync_all()
                    self.assertEqual(remember.call_count, 2)
                    return result
        result = asyncio.run(scenario())
        self.assertEqual(result['sent'], 2)
        self.assertEqual(result['failed'], 0)

    def test_backfill_is_a_no_op_without_a_key(self):
        import os
        env = {k: v for k, v in os.environ.items() if k != 'SUPERMEMORY_API_KEY'}
        with mock.patch.dict('os.environ', env, clear=True):
            result = asyncio.run(self.memory.sync_all())
        self.assertFalse(result['configured'])
        self.assertEqual(result['sent'], 0)

    def test_counts_what_actually_synced(self):
        async def scenario():
            with mock.patch.dict('os.environ', {'SUPERMEMORY_API_KEY': 'test-key'}):
                with mock.patch.object(supermemory, 'remember'):
                    self.memory.add_note('snapshot', 'A mug is on the desk.')
                    await self.memory.flush()
        asyncio.run(scenario())
        self.assertEqual(self.memory.remote_status()['synced'], 1)

    def test_recall_survives_a_supermemory_outage(self):
        async def scenario():
            self.memory.add_note('snapshot', 'The keys are on the kitchen counter.')
            with mock.patch.dict('os.environ', {'SUPERMEMORY_API_KEY': 'test-key'}):
                with mock.patch.object(
                    supermemory, 'recall',
                    side_effect=supermemory.SupermemoryError('503'),
                ):
                    return await self.memory.recall('where are my keys?')
        answer = asyncio.run(scenario())
        self.assertIn('kitchen counter', answer['text'])
        self.assertIn('local', answer['sources'])


if __name__ == '__main__':
    unittest.main()
