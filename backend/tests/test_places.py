from __future__ import annotations

import asyncio
import os
import unittest
from unittest import mock

from backend.app.services.assistant import Assistant, route
from backend.app.services.memory import Memory
from backend.app.services.navigation import Navigator
from backend.app.services.payments import Orders

HERE = (37.7606, -122.3866)
HOME = {'label': '161, Mission Falls Lane, Fremont', 'lat': 37.4845, 'lon': -121.9273}


def run(coroutine):
    return asyncio.run(coroutine)


async def geocode(text, lat=None, lon=None):
    return None if 'nowhere' in text.lower() else HOME


async def fake_place(term, lat, lon):
    return None


async def fake_route(lat, lon, dest_lat, dest_lon):
    return {'distance_m': 1000, 'duration_s': 720, 'steps': [
        {'say': 'Head south on 3rd Street for 500 feet.', 'lat': lat, 'lon': lon, 'distance_m': 1000},
        {'say': 'You have arrived.', 'lat': dest_lat, 'lon': dest_lon, 'distance_m': 0},
    ]}


class PlaceTests(unittest.TestCase):
    def setUp(self):
        patcher = mock.patch.dict(os.environ, {'GEMINI_API_KEY': '', 'GROQ_API_KEY': '', 'MINIMAX_API_KEY': ''})
        patcher.start()
        self.addCleanup(patcher.stop)
        self.memory = Memory(':memory:')
        self.assistant = Assistant(self.memory, Orders(), navigator=Navigator(fake_place, fake_route), geocode=geocode)

    def ask(self, text, **kwargs):
        return run(self.assistant.respond('s', text, **kwargs))

    def test_routing(self):
        self.assertEqual(route('My home address is San Francisco Bay University'), 'place_set')
        self.assertEqual(route('Can you change my home address to San Francisco Bay University?'), 'place_set')
        self.assertEqual(route('Set my work address to 1 Market Street San Francisco'), 'place_set')
        self.assertEqual(route('I live at 161 Mission Falls Lane Fremont'), 'place_set')
        self.assertEqual(route('Can you please change my home address?'), 'place_set')
        self.assertEqual(route('Take me home'), 'place_go')
        self.assertEqual(route('Get directions home, please'), 'place_go')
        self.assertEqual(route('Take me to the nearest supermarket'), 'navigate')
        self.assertEqual(route('Write to Tom saying I am late'), 'message')
        self.assertEqual(route('Send a message to Tom saying hello'), 'message')
        self.assertEqual(route('Tell me what is in front of me'), 'see')

    def test_home_must_be_set_first(self):
        self.assertIn('do not know your home address', self.ask('Take me home', location=HERE)['say'])

    def test_nothing_is_saved_until_the_user_says_yes(self):
        offer = self.ask('My home address is 161 Mission Falls Lane Fremont', location=HERE)
        self.assertIn('I found 161, Mission Falls Lane, Fremont', offer['say'])
        self.assertEqual(offer['confirm'], 'Save 161, Mission Falls Lane, Fremont as your home?')
        self.assertIsNone(self.memory.place('home'))
        saved = self.ask('Yes')
        self.assertEqual(saved['intent'], 'place_saved')
        self.assertIn('Saved. Your home is 161, Mission Falls Lane, Fremont', saved['say'])
        self.assertEqual(self.memory.place('home')['lat'], HOME['lat'])
        going = self.ask('Get directions home, please', location=HERE)
        self.assertTrue(going['navigating'])

    def test_ask_first_then_say_the_address(self):
        question = self.ask('Can you please change my home address?')
        self.assertIn('What is your home address?', question['say'])
        offer = self.ask('161 Mission Falls Lane, Fremont')          # the next sentence is the address
        self.assertIn('I found 161, Mission Falls Lane, Fremont', offer['say'])
        self.assertEqual(self.ask('yes')['intent'], 'place_saved')

    def test_wrong_result_can_be_corrected_by_saying_it_again(self):
        self.ask('Change my home address to San Bay University')
        self.assertIsNone(self.memory.place('home'))
        again = self.ask('No')
        self.assertIn('Say the address again', again['say'])
        offer = self.ask('Mission Falls Lane Fremont')                # a correction, not a new request
        self.assertEqual(offer['intent'], 'place_set')
        self.assertIn('Should I save it as your home?', offer['say'])
        self.ask('Yes')
        self.assertIsNotNone(self.memory.place('home'))
        # the conversation is over: the next sentence is an ordinary request again
        self.assertEqual(self.ask('Buy me a coffee')['intent'], 'pay_quote')

    def test_saying_the_address_again_instead_of_yes_replaces_the_offer(self):
        self.ask('Change my home address to somewhere')
        offer = self.ask('161 Mission Falls Lane Fremont')
        self.assertIn('I found', offer['say'])
        self.assertIsNone(self.memory.place('home'))

    def test_unknown_address_is_not_saved_and_can_be_cancelled(self):
        reply = self.ask('My home address is nowhere street 99999')
        self.assertIn('could not find', reply['say'])
        cancelled = self.ask('Cancel')
        self.assertEqual(cancelled['intent'], 'place_cancel')
        self.assertIn('unchanged', cancelled['say'])
        self.assertIsNone(self.memory.place('home'))

    def test_another_request_leaves_the_address_conversation(self):
        self.ask('Change my home address')
        reply = self.ask('Buy me a coffee')                 # not an address: do it, and drop the conversation
        self.assertEqual(reply['intent'], 'pay_quote')
        self.ask('No')
        self.assertEqual(self.ask('Remember this')['intent'], 'remember')

    def test_stray_fragments_are_not_looked_up_as_addresses(self):
        self.ask('Change my home address')
        for fragment in ('can you please', 'get the', 'now now'):
            reply = self.ask(fragment)
            self.assertNotIn('I found', reply['say'])
        self.assertEqual(reply['intent'], 'place_cancel')    # three misses: give up politely
        self.assertIsNone(self.memory.place('home'))

    def test_address_misheard_as_mattress(self):
        offer = self.ask('Now change my home mattress to 161 Mission Falls Lane Fremont')
        self.assertIn('I found 161, Mission Falls Lane, Fremont', offer['say'])

    def test_my_address_without_the_word_home(self):
        self.assertEqual(route('change my address'), 'place_set')
        self.assertEqual(route('Hello. Changing my address to San Francisco'), 'place_set')
        self.assertIn('What is your home address?', self.ask('change my address')['say'])
        offer = self.ask('to 161 Mission Falls Lane, Fremont')       # "to" leads in, it is not part of the address
        self.assertIn('I found 161, Mission Falls Lane, Fremont', offer['say'])
        self.ask('Cancel'); self.ask('Cancel')
        offer = self.ask('My address is 161 Mission Falls Lane Fremont')
        self.assertEqual(offer['confirm'], 'Save 161, Mission Falls Lane, Fremont as your home?')

    def test_the_rest_of_a_cut_off_address_is_added_to_it(self):
        asked = []

        async def remember(text, lat=None, lon=None):
            asked.append(text)
            return HOME

        assistant = Assistant(self.memory, Orders(), geocode=remember)
        run(assistant.respond('s', 'Please change my home address to San Francisco Bay'))
        run(assistant.respond('s', 'University'))            # the pause cut the name in two
        self.assertEqual(asked[-1], 'San Francisco Bay University')
        run(assistant.respond('s', '161 Mission Falls Lane Fremont'))   # a full address replaces it
        self.assertEqual(asked[-1], '161 Mission Falls Lane Fremont')

    def test_a_message_that_mentions_home_is_still_a_message(self):
        self.memory.add_contact('Tim', '+14155550100')
        self.memory.add_contact('Zack', '+14155550101')
        self.memory.save_place('home', 'Somewhere', 37.5, -121.9)
        draft = self.ask('Nice. Nice. Now message Zach that I am going home right now.', location=HERE)
        self.assertEqual(draft['intent'], 'message')
        self.assertEqual(draft['confirm'], 'Send to Zack on WhatsApp?')
        self.assertIn('I am going home right now', draft['say'])
        self.ask('No')
        location = self.ask('Send my location team.', location=HERE)       # "team" is how "Tim" is often heard
        self.assertEqual(location['confirm'], 'Send to Tim on WhatsApp?')
        self.ask('No')
        self.assertEqual(self.ask('Take me home', location=HERE)['intent'], 'place_go')   # no contact named: directions

    def test_chatter_around_an_address_is_dropped(self):
        from backend.app.services.assistant import spoken_place
        self.assertEqual(spoken_place('Yeah. Yeah. Search it. Francisco Bay University, Fremont, Mission Falls Lane. Should be there.'),
                         'Francisco Bay University, Fremont, Mission Falls Lane')
        self.assertEqual(spoken_place('161 Mission Falls Lane, Fremont'), '161 Mission Falls Lane, Fremont')

    def test_yes_anywhere_in_a_short_reply_confirms_the_address(self):
        self.ask('Change my home address to 161 Mission Falls Lane Fremont')
        saved = self.ask('change it yes change it')
        self.assertEqual(saved['intent'], 'place_saved')

    def test_work_address(self):
        self.ask('Set my work address to 1 Market Street San Francisco')
        self.ask('Yes')
        self.assertIsNotNone(self.memory.place('work'))

    def test_a_name_the_map_gets_wrong_is_looked_up_as_an_address(self):
        calls = []

        async def map_search(text, lat=None, lon=None):
            calls.append(text)
            if 'Mission Falls' in text:
                return {'label': '161, Mission Falls Lane, Fremont', 'lat': 37.4845, 'lon': -121.9273}
            return {'label': 'UCSF Mission Bay, Nelson Rising Lane', 'lat': 37.7687, 'lon': -122.3922}  # sounds alike, wrong

        async def lookup(place):
            return '161 Mission Falls Lane, Fremont, CA'

        assistant = Assistant(self.memory, Orders(), geocode=map_search, lookup_address=lookup)
        offer = run(assistant.respond('s', 'Change my home address to San Francisco Bay University'))
        self.assertIn('San Francisco Bay University (161, Mission Falls Lane, Fremont)', offer['say'])
        run(assistant.respond('s', 'Yes'))
        self.assertAlmostEqual(self.memory.place('home')['lat'], 37.4845)
        # A real street address is trusted as it is, with no second lookup.
        calls.clear()
        run(assistant.respond('s', 'My home address is 161 Mission Falls Lane Fremont'))
        self.assertEqual(len(calls), 1)

    def test_misheard_names_still_reach_the_right_contact(self):
        self.memory.add_contact('Tim', '+14155550100')
        self.memory.add_contact('Zack', '+14155550101')
        self.assertEqual(self.memory.find_contact('tell my team where I am')['name'], 'Tim')
        self.assertEqual(self.memory.find_contact('text zach saying hello')['name'], 'Zack')
        self.assertEqual(self.memory.find_contact('Tell Tim I am late')['name'], 'Tim')
        self.assertIsNone(self.memory.find_contact('read the text you can see'))
        self.assertIsNone(self.memory.find_contact('what is in front of me'))

    def test_loose_phrasing_through_a_noisy_microphone(self):
        self.memory.add_contact('Tim', '+14155550100')
        draft = self.ask('Hell, my team friend. My friend teams. Tell my team where I am', location=HERE)
        self.assertEqual(draft['intent'], 'message')
        self.assertEqual(draft['confirm'], 'Send to Tim on WhatsApp?')
        self.assertEqual(self.ask('No')['intent'], 'message_cancel')
        self.assertEqual(self.ask('Read the text you can see')['intent'], 'see')

    def test_unknown_person_lists_the_contacts(self):
        self.memory.add_contact('Tim', '+14155550100')
        self.assertIn('Your contacts are Tim.', self.ask('Tell Barbara where I am', location=HERE)['say'])

    def test_places_survive_erasing_memory(self):
        self.memory.save_place('home', 'Somewhere', 1.0, 2.0)
        self.memory.clear()
        self.assertEqual(len(self.memory.places()), 1)
        self.memory.remove_place('home')
        self.assertEqual(self.memory.places(), [])


if __name__ == '__main__':
    unittest.main()
