#!/bin/sh
set -eu

cd "$(dirname "$0")/.."
kit_commit='1e4291e2fa4896b1f603d3d4f0b009c483425da0'
if [ ! -d vexo-open-kit/.git ]; then
  git clone https://github.com/VexoAI-Org/vexo-open-kit.git vexo-open-kit
fi
git -C vexo-open-kit fetch --quiet origin "$kit_commit"
git -C vexo-open-kit checkout --quiet --detach "$kit_commit"
python3 -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install bleak pyserial av
printf '%s\n' 'Vexo Open kit ready. This project only connects to Vexo-HACK-20.'

