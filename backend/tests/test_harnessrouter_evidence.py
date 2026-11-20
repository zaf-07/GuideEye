from __future__ import annotations

import json
import os
import unittest
from unittest import mock

from backend.app.services import errand


class HarnessRouterEvidenceTests(unittest.TestCase):
    """Verifies that GuideEye conforms to the Universal Harness Protocol (UHP 2026-09-28)

    and that the currently configured harness is verifiable programmatically
    without external network flakiness.
    """

    def setUp(self):
        self.harness_id = json.loads(errand.CONFIG_FILE.read_text(encoding='utf-8'))['harness_id']
        self.fake_key = 'hr_live_test_dummy_key_for_uhp_verification_12345'

    def test_harness_configuration_and_id(self):
        """Verifies harnessrouter.json contains the registered Harness ID."""
        with mock.patch.dict(os.environ, {'HR_API_KEY': self.fake_key}):
            self.assertEqual(errand.harness_id(), self.harness_id)
            self.assertTrue(errand.configured())

    def test_uhp_protocol_headers(self):
        """Verifies UHP specification header (UHP-Version: 2026-09-28) and Bearer auth."""
        with mock.patch.dict(os.environ, {'HR_API_KEY': self.fake_key}):
            headers = errand._headers({'Extra-Header': 'TestValue'})
            self.assertEqual(headers.get('Authorization'), f'Bearer {self.fake_key}')
            self.assertEqual(headers.get('UHP-Version'), '2026-09-28')
            self.assertEqual(headers.get('Extra-Header'), 'TestValue')

    def test_uhp_answer_text_extraction(self):
        """Verifies parsing of the Universal Output message structure."""
        uhp_response = {
            'id': 'resp_chrn_94102',
            'status': 'completed',
            'output': [
                {
                    'type': 'message',
                    'role': 'assistant',
                    'content': [
                        {'type': 'output_text', 'text': 'This is your clinic bill for $42.50.'},
                        {'type': 'output_text', 'text': 'Pay by Friday.'},
                    ],
                }
            ],
        }
        text = errand.answer_text(uhp_response)
        self.assertEqual(text, 'This is your clinic bill for $42.50. Pay by Friday.')

    def test_uhp_summary_terminal_states(self):
        """Verifies terminal state transitions according to UHP spec."""
        for terminal in ('completed', 'failed', 'incomplete', 'cancelled'):
            resp = {'id': 'r1', 'status': terminal, 'output': []}
            summary = errand.summary(resp)
            self.assertTrue(summary['done'], f'{terminal} should mark task done')

        in_progress = {'id': 'r2', 'status': 'in_progress', 'output': []}
        self.assertFalse(errand.summary(in_progress)['done'])

    def test_golden_execution_trace_validation(self):
        """Verifies the golden trace document exists and contains required UHP protocol elements."""
        evidence_path = errand.CONFIG_FILE.parent / 'docs' / 'HARNESSROUTER_EXECUTION_EVIDENCE.md'
        self.assertTrue(evidence_path.exists(), 'HARNESSROUTER_EXECUTION_EVIDENCE.md must exist in docs/')
        content = evidence_path.read_text(encoding='utf-8')
        self.assertIn('chrn_', content)
        self.assertIn('UHP-Version: 2026-09-28', content)
        self.assertIn('https://api.harnessrouter.ai', content)
        self.assertIn('POST /v1/responses', content)
        self.assertIn('POST /v1/files', content)


if __name__ == '__main__':
    unittest.main()
