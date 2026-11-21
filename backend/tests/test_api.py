from __future__ import annotations

import importlib.util
import os
import unittest
from unittest import mock

try:
    from fastapi.testclient import TestClient
except ImportError:
    TestClient = None


@unittest.skipIf(TestClient is None, 'FastAPI is not installed')
class ApiTests(unittest.TestCase):
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

    def test_health(self):
        body = self.client.get('/health').json()
        self.assertEqual(body['status'], 'ok')
        self.assertFalse(body['raw_media_storage'])

    def test_automatic_scene_description_can_classify_without_detector_hints(self):
        detections = [{'label': 'cell phone', 'position': 'left', 'confidence': 0.8, 'box': [0, 0, 0.2, 0.2]}]
        answer = {'text': 'A shoe is on the left.', 'provider': 'gemini', 'failed_providers': []}
        with mock.patch.object(self.main, 'detect', return_value=detections), \
             mock.patch.object(self.main.memory, 'record_detections'), \
             mock.patch.object(self.main.vision, 'hazard_warnings', return_value=[]), \
             mock.patch.object(self.main.vision, 'describe', return_value=answer) as describe:
            response = self.client.post('/vision/analyze', data={'use_detector_hints': 'false'},
                                        files={'image': ('frame.jpg', b'frame', 'image/jpeg')})
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['description'], answer['text'])
        self.assertEqual(response.json()['detections'], detections)
        self.assertEqual(describe.call_args.args[3], [])

    def test_web_app_is_served(self):
        self.assertEqual(self.client.get('/').status_code, 200)
        self.assertEqual(self.client.get('/app.html').status_code, 200)

    def test_bridge_sign_accepts_three_camera_frames_and_returns_the_decoded_turn(self):
        with mock.patch.object(self.main.llm, 'configured', return_value=True), \
             mock.patch.object(self.main.bridge, 'read_sign', return_value={'text': 'hello', 'confidence': 0.95}) as read:
            response = self.client.post('/bridge/sign', files=[
                ('images', (f'frame-{index}.jpg', b'frame', 'image/jpeg')) for index in range(3)
            ])
        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()['text'], 'hello')
        self.assertEqual(len(read.call_args.args[0]), 3)

    def test_no_battery_is_reported_before_the_band_is_read(self):
        body = self.client.get('/wearable/status').json()
        self.assertFalse(body['connected'])
        self.assertIsNone(body['battery'])
        self.assertIsNone(body['firmware'])

    def test_payment_needs_a_spoken_yes(self):
        quote = self.client.post('/assistant', data={'text': 'Buy me a coffee', 'session': 'api-pay'}).json()
        self.assertEqual(quote['intent'], 'pay_quote')
        self.assertIsNone(quote['order'].get('status'))
        waiting = self.client.post('/assistant', data={'text': 'what is the weather', 'session': 'api-pay'}).json()
        self.assertEqual(waiting['intent'], 'pay_waiting')
        paid = self.client.post('/assistant', data={'text': 'yes', 'session': 'api-pay'}).json()
        self.assertEqual(paid['intent'], 'pay_confirm')
        self.assertEqual(paid['order']['status'], 'simulated')

    def test_qr_code_without_opencv_is_a_clear_503(self):
        response = self.client.get('/pay/qr.png', params={'item': 'Coffee', 'amount': 4.5})
        if importlib.util.find_spec('cv2') is None:
            self.assertEqual(response.status_code, 503)
            self.assertIn('OpenCV', response.json()['detail'])
        else:
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.headers['content-type'], 'image/png')

    def test_qr_code_rejects_bad_amounts(self):
        self.assertEqual(self.client.get('/pay/qr.png', params={'amount': 0}).status_code, 422)

    def test_listen_without_the_kit_explains_what_to_install(self):
        if self.main.BAND_KIT.is_dir():
            self.skipTest('The Vexo kit is installed; this would use the real band')
        response = self.client.post('/wearable/listen', json={'seconds': 1})
        self.assertEqual(response.status_code, 503)
        self.assertNotIn('ModuleNotFoundError', response.json()['detail'])

    def test_events_socket_acknowledges_and_closes_cleanly(self):
        with self.client.websocket_connect('/events') as socket:
            self.assertEqual(socket.receive_json()['event'], 'connected')
            socket.send_text('ping')
            self.assertEqual(socket.receive_json()['message'], 'ping')


if __name__ == '__main__':
    unittest.main()
