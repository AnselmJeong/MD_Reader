#!/usr/bin/env python3
"""Line-delimited JSON sidecar for MD Reader local TTS."""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import queue
import sys
import threading
import time
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent
VOICES_DIR = Path(os.environ.get("MD_READER_TTS_VOICES_DIR", ROOT / "voices"))
DEFAULT_VOICE = os.environ.get("MD_READER_TTS_DEFAULT_VOICE")


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def check_environment() -> int:
    checks = {
        "RealtimeTTS": importlib.util.find_spec("RealtimeTTS") is not None,
        "neutts": importlib.util.find_spec("neutts") is not None,
    }
    voices = sorted(path.stem for path in VOICES_DIR.glob("*.wav") if path.with_suffix(".txt").exists())
    payload = {
        "type": "check",
        "python": sys.version.split()[0],
        "voicesDir": str(VOICES_DIR),
        "voices": voices,
        "checks": checks,
        "ok": all(checks.values()),
    }
    emit(payload)
    return 0 if payload["ok"] else 1


class TtsServer:
    def __init__(self) -> None:
        self.engine = None
        self.stream = None
        self.active_mode: str | None = None
        self.active_utterances: list[dict[str, Any]] = []
        self.command_queue: queue.Queue[dict[str, Any]] = queue.Queue()
        self.playback_thread: threading.Thread | None = None
        self.stop_requested = threading.Event()
        self.state = "idle"

    def ensure_stream(self) -> None:
        if self.stream is not None:
            return

        emit({"type": "status", "state": "initializing"})
        emit({
            "type": "status",
            "state": "downloading-model",
            "message": "NeuTTS-Air may download model files on first run.",
        })

        from RealtimeTTS import NeuTTSEngine, TextToAudioStream

        if not VOICES_DIR.exists():
            VOICES_DIR.mkdir(parents=True, exist_ok=True)

        self.engine = NeuTTSEngine(
            model="neutts-air",
            backbone_repo=os.environ.get("MD_READER_TTS_BACKBONE", "neuphonic/neutts-air"),
            codec_repo=os.environ.get("MD_READER_TTS_CODEC", "neuphonic/neucodec"),
            device=os.environ.get("MD_READER_TTS_DEVICE", "cpu"),
            voices_dir=str(VOICES_DIR),
            default_voice=DEFAULT_VOICE,
        )

        voices = []
        try:
            voices = [getattr(voice, "name", str(voice)) for voice in self.engine.get_voices()]
        except Exception:
            voices = []

        if DEFAULT_VOICE:
            self.engine.set_voice(DEFAULT_VOICE)
        elif voices:
            self.engine.set_voice(voices[0])

        self.stream = TextToAudioStream(
            self.engine,
            on_audio_stream_start=lambda: emit({"type": "status", "state": "playing", "mode": self.active_mode}),
            on_audio_stream_stop=lambda: emit({"type": "status", "state": "ended", "mode": self.active_mode}),
        )
        emit({"type": "status", "state": "ready", "voices": voices})

    def utterance_generator(self):
        for index, utterance in enumerate(self.active_utterances):
            if self.stop_requested.is_set():
                break
            emit({
                "type": "utterance-start",
                "id": utterance.get("id"),
                "index": index,
                "text": utterance.get("text", ""),
            })
            yield utterance.get("text", "") + "\n"

    def speak(self, command: dict[str, Any]) -> None:
        self.stop()
        self.ensure_stream()
        self.active_mode = command.get("mode") or "document"
        self.active_utterances = [
            item for item in command.get("utterances", [])
            if isinstance(item, dict) and str(item.get("text", "")).strip()
        ]
        if not self.active_utterances:
            emit({"type": "error", "message": "No readable text was provided for TTS."})
            return

        self.stop_requested.clear()
        self.state = "playing"

        def run() -> None:
            try:
                assert self.stream is not None
                self.stream.feed(self.utterance_generator())
                self.stream.play(
                    fast_sentence_fragment=True,
                    buffer_threshold_seconds=0.3,
                    minimum_sentence_length=8,
                )
                if not self.stop_requested.is_set():
                    emit({"type": "status", "state": "ended", "mode": self.active_mode})
            except Exception as error:
                emit({"type": "error", "message": str(error)})
            finally:
                self.state = "idle" if self.stop_requested.is_set() else "ended"

        self.playback_thread = threading.Thread(target=run, daemon=True)
        self.playback_thread.start()

    def pause(self) -> None:
        if self.stream is not None:
            self.stream.pause()
        self.state = "paused"
        emit({"type": "status", "state": "paused", "mode": self.active_mode})

    def resume(self) -> None:
        if self.stream is not None:
            self.stream.resume()
        self.state = "playing"
        emit({"type": "status", "state": "playing", "mode": self.active_mode})

    def stop(self) -> None:
        self.stop_requested.set()
        if self.stream is not None:
            try:
                self.stream.stop()
            except Exception:
                pass
        self.state = "stopped"
        emit({"type": "status", "state": "stopped", "mode": self.active_mode})

    def restart(self) -> None:
        if not self.active_utterances:
            emit({"type": "error", "message": "No active TTS session to restart."})
            return
        self.speak({"type": "speak", "mode": self.active_mode, "utterances": self.active_utterances})

    def status(self) -> None:
        emit({"type": "status", "state": self.state, "mode": self.active_mode})

    def shutdown(self) -> None:
        self.stop()
        if self.engine is not None:
            try:
                self.engine.shutdown()
            except Exception:
                pass

    def handle(self, command: dict[str, Any]) -> bool:
        kind = command.get("type")
        try:
            if kind == "speak":
                self.speak(command)
            elif kind == "pause":
                self.pause()
            elif kind == "resume":
                self.resume()
            elif kind == "stop":
                self.stop()
            elif kind == "restart":
                self.restart()
            elif kind == "status":
                self.status()
            elif kind == "shutdown":
                self.shutdown()
                return False
            else:
                emit({"type": "error", "message": f"Unknown TTS command: {kind}"})
        except Exception as error:
            emit({"type": "error", "message": str(error)})
        return True

    def run(self) -> int:
        emit({"type": "status", "state": "idle"})
        for line in sys.stdin:
            if not line.strip():
                continue
            try:
                command = json.loads(line)
            except json.JSONDecodeError as error:
                emit({"type": "error", "message": f"Invalid JSON command: {error}"})
                continue
            if not self.handle(command):
                break
        self.shutdown()
        return 0


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    if args.check:
        return check_environment()
    return TtsServer().run()


if __name__ == "__main__":
    raise SystemExit(main())
