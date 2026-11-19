#!/usr/bin/env python3
"""Interactive demonstration of the GuideEye Micro-Whisper navigation loop.

Simulates the exact timing using the Android phone's vibrator:
1. Instant phone tactile click / vibration (0 ms latency reflex trigger)
2. Immediate single-syllable directional whisper (300 ms)
"""
import subprocess
import time
import sys

STEPS = [
    ("CLICK", "Лево", "/System/Library/Sounds/Tink.aiff", 1.8),
    ("CLICK", "Прямо", "/System/Library/Sounds/Tink.aiff", 1.8),
    ("CLICK", "Право", "/System/Library/Sounds/Tink.aiff", 1.8),
    ("ALARM", "Стоп!", "/System/Library/Sounds/Basso.aiff", 1.0),
]

def run():
    print("\n" + "=" * 50)
    print("  GuideEye: Android Phone Haptic Navigation Demo")
    print("=" * 50)
    print("Наденьте наушники или включите звук на Mac.\n")
    time.sleep(1)

    for trigger, word, sound, delay in STEPS:
        if trigger == "ALARM":
            print(f"  [⚡⚡ ДВОЙНОЙ ИМПУЛЬС ТЕЛЕФОНА] --->  «{word}»")
            subprocess.Popen(["afplay", sound])
            subprocess.run(["say", "-v", "Milena", word])
        else:
            print(f"  [⚡ ИМПУЛЬС ТЕЛЕФОНА 80мс] --->  «{word}»")
            subprocess.Popen(["afplay", sound])
            time.sleep(0.08)
            subprocess.run(["say", "-v", "Milena", word])
        time.sleep(delay)

    print("\n" + "=" * 50)
    print("Готово. Заметьте: мозг тратит 0 секунд на расшифровку.")
    print("=" * 50 + "\n")

if __name__ == "__main__":
    run()
