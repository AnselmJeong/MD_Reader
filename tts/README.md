# MD Reader Realtime TTS

MD Reader uses a Python sidecar for local text-to-speech with RealtimeTTS, NeuTTSEngine, and NeuTTS-Air.

## Setup

```bash
brew install uv espeak-ng portaudio ffmpeg

cd /Volumes/Aquatope/_DEV_/MD_Reader
uv sync --directory tts
```

The `tts/pyproject.toml` file pins the TTS environment to Python 3.11-3.12 and installs both `realtimetts[all]` and `neutts[llama]`. `uv` creates and manages `tts/.venv` automatically.

NeuTTS also needs a reference voice. Add clean 3-15 second mono WAV files and exact transcripts with matching basenames:

```text
tts/voices/Ava.wav
tts/voices/Ava.txt
tts/voices/Christopher.wav
tts/voices/Christopher.txt
```

The app automatically uses:

- Backbone: `neuphonic/neutts-air-q8-gguf`
- Codec: `neuphonic/neucodec`
- Device: `cpu`
- Voice: the first valid voice pair in `tts/voices`, unless a development override selects another one

The first playback can take a while because the Q8 GGUF backbone and codec are downloaded from Hugging Face. In the packaged desktop app, the virtual environment and Hugging Face cache live under the app's user data folder, not inside the app bundle.

## Check

```bash
uv run --directory tts python reader_tts_server.py --check
```

Optional environment overrides:

```bash
MD_READER_TTS_DEFAULT_VOICE=jo uv run --directory tts python reader_tts_server.py --check
MD_READER_TTS_BACKBONE=neuphonic/neutts-air uv run --directory tts python reader_tts_server.py --check
```

These overrides are for development only. The desktop app sets its own TTS defaults when it starts, so normal users should not need shell `export` commands.
