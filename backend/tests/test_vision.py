import asyncio
import os
import unittest
from unittest import mock

from backend.app.services import vision


def det(label, x1, x2, conf=0.9, y1=0.2, y2=0.8):
    return vision.make_detection(label, conf, [x1, y1, x2, y2])


class VisionTests(unittest.TestCase):
    def test_ultralytics_prefixed_settings_configure_detector(self):
        with mock.patch.dict(os.environ, {
            'ULTRALYTICS_YOLO_MODEL': 'custom-yolo.pt',
            'ULTRALYTICS_YOLO_DEVICE': 'cpu',
        }, clear=False):
            self.assertEqual(vision.Detector._weights(), 'custom-yolo.pt')
            self.assertEqual(vision.setting('DEVICE'), 'cpu')

    def test_distance_is_only_kept_in_a_safe_metric_range(self):
        item = det('chair', 0.2, 0.5)
        vision.add_distance(item, 1.26)
        self.assertEqual(item['distance_m'], 1.3)
        self.assertIn('about 1.3 metres', vision.hazard_warnings([item])[0])
        distant = det('car', 0.2, 0.8)
        vision.add_distance(distant, 45)
        self.assertNotIn('distance_m', distant)

    def test_zone_names_follow_horizontal_position(self):
        self.assertEqual(vision.zone(0.1), 'on the left')
        self.assertEqual(vision.zone(0.3), 'ahead, left')
        self.assertEqual(vision.zone(0.5), 'ahead')
        self.assertEqual(vision.zone(0.7), 'ahead, right')
        self.assertEqual(vision.zone(0.95), 'on the right')

    def test_warning_names_position_and_never_distance(self):
        warnings = vision.hazard_warnings([det('chair', 0.2, 0.5)])
        self.assertEqual(warnings, ['Chair ahead, left.'])
        self.assertNotRegex(warnings[0], r'\d')

    def test_small_or_harmless_objects_do_not_warn(self):
        tiny_chair = det('chair', 0.50, 0.55, y1=0.5, y2=0.55)
        self.assertEqual(vision.hazard_warnings([tiny_chair, det('book', 0.2, 0.8)]), [])

    def test_warnings_are_largest_first_and_capped(self):
        found = [det('chair', 0.45, 0.55), det('person', 0.0, 0.9), det('car', 0.6, 1.0), det('bench', 0.0, 0.3), det('dog', 0.3, 0.6)]
        warnings = vision.hazard_warnings(found)
        self.assertEqual(len(warnings), vision.MAX_WARNINGS)
        self.assertTrue(warnings[0].startswith('Person'))

    def test_local_description(self):
        self.assertIn('do not recognise', vision.local_description([]))
        text = vision.local_description([det('person', 0.7, 0.9), det('person', 0.65, 0.85), det('chair', 0.2, 0.5)])
        self.assertIn('2 persons ahead, right', text)
        self.assertIn('a chair ahead, left', text)

    def test_first_working_provider_wins(self):
        async def good(*args): return 'A chair is ahead.'
        async def never(*args): raise AssertionError('should not be called')
        result = asyncio.run(vision.describe(b'', 'image/jpeg', '', [], providers=[('gemini', good), ('groq', never)]))
        self.assertEqual((result['provider'], result['text'], result['failed_providers']), ('gemini', 'A chair is ahead.', []))

    def test_falls_back_to_next_provider(self):
        async def broken(*args): raise TimeoutError()
        async def good(*args): return 'A door is ahead.'
        result = asyncio.run(vision.describe(b'', 'image/jpeg', '', [], providers=[('gemini', broken), ('groq', good)]))
        self.assertEqual(result['provider'], 'groq')
        self.assertEqual(result['failed_providers'], ['gemini: TimeoutError'])

    def test_falls_back_to_local_detector_when_cloud_is_down(self):
        async def broken(*args): raise ConnectionError()
        result = asyncio.run(vision.describe(b'', 'image/jpeg', '', [det('chair', 0.2, 0.5)], providers=[('gemini', broken), ('groq', broken)]))
        self.assertEqual(result['provider'], 'local')
        self.assertIn('a chair ahead, left', result['text'])
        self.assertEqual(len(result['failed_providers']), 2)


if __name__ == '__main__':
    unittest.main()
