# MD Reader Realtime TTS

MD Reader uses a Python sidecar for local text-to-speech with RealtimeTTS, NeuTTSEngine, and NeuTTS-Air.

## Setup

```bash
brew install espeak-ng portaudio ffmpeg

cd /Volumes/Aquatope/_DEV_/MD_Reader
python3.11 -m venv tts/.venv
tts/.venv/bin/pip install -U pip
tts/.venv/bin/pip install -r tts/requirements.txt
```

Python 3.11 or 3.12 is recommended for this stack. If `python3.11` is not installed, install it first or point `MD_READER_TTS_PYTHON` at a compatible interpreter.

NeuTTS also needs a reference voice. Add a clean 3-15 second mono WAV file and an exact transcript with the same basename:

```text
tts/voices/default.wav
tts/voices/default.txt
```

The first playback can take a while because `neuphonic/neutts-air` and `neuphonic/neucodec` are downloaded from Hugging Face.

## Check

```bash
tts/.venv/bin/python tts/reader_tts_server.py --check
```

Optional environment overrides:

```bash
export MD_READER_TTS_PYTHON=/absolute/path/to/python
export MD_READER_TTS_DEFAULT_VOICE=default
export MD_READER_TTS_DEVICE=cpu
```
