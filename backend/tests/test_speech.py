from __future__ import annotations

import asyncio
import os
import unittest
from unittest import mock

from backend.app.services import speech


class SpeechTests(unittest.TestCase):
    def test_configured_and_provider_browser(self):
        with mock.patch.dict(os.environ, {'MINIMAX_API_KEY': '', 'DEEPGRAM_API_KEY': '', 'ELEVENLABS_API_KEY': ''}):
            self.assertFalse(speech.configured())
            self.assertEqual(speech.provider(), 'browser')

    def test_configured_deepgram(self):
        with mock.patch.dict(os.environ, {'MINIMAX_API_KEY': '', 'DEEPGRAM_API_KEY': 'dg-test', 'ELEVENLABS_API_KEY': ''}):
            self.assertTrue(speech.configured())
            self.assertEqual(speech.provider(), 'deepgram')

    def test_configured_elevenlabs(self):
        with mock.patch.dict(os.environ, {'MINIMAX_API_KEY': '', 'DEEPGRAM_API_KEY': '', 'ELEVENLABS_API_KEY': 'el-test'}):
            self.assertTrue(speech.configured())
            self.assertEqual(speech.provider(), 'elevenlabs')

    def test_minimax_is_preferred_for_voice(self):
        with mock.patch.dict(os.environ, {
            'MINIMAX_API_KEY': 'mm-test',
            'DEEPGRAM_API_KEY': 'dg-test',
            'ELEVENLABS_API_KEY': 'el-test',
        }):
            self.assertTrue(speech.configured())
            self.assertEqual(speech.provider(), 'minimax')

    def test_minimax_audio_response_is_decoded(self):
        response = mock.Mock()
        response.raise_for_status.return_value = None
        response.json.return_value = {
            'base_resp': {'status_code': 0},
            'data': {'audio': '494433'},
        }
        client = mock.AsyncMock()
        client.__aenter__.return_value.post.return_value = response
        with mock.patch.dict(os.environ, {'MINIMAX_API_KEY': 'secret'}), \
             mock.patch('httpx.AsyncClient', return_value=client):
            self.assertEqual(asyncio.run(speech.synthesize('Guide me')), b'ID3')
