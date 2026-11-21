import unittest
from backend.app.planner import plan

class GuideEyeTests(unittest.TestCase):
    def test_journey_requires_confirmation(self):
        result=plan('In 30 minutes help me walk to Safeway');self.assertEqual(result['intent'],'schedule_journey');self.assertTrue(result['requires_confirmation']);self.assertEqual(result['delay_minutes'],30)
    def test_external_actions_require_confirmation(self):
        self.assertTrue(plan('call Alex')['requires_confirmation']);self.assertTrue(plan('read WhatsApp')['requires_confirmation'])
    def test_unknown_is_safe(self): self.assertEqual(plan('do anything')['intent'],'unknown')

if __name__=='__main__': unittest.main()
