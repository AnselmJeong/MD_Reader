#!/usr/bin/env python3
"""Line-delimited JSON sidecar for MD Reader local TTS."""

from __future__ import annotations

import argparse
import contextlib
import importlib
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
REF_CACHE_DIR = Path(os.environ.get("MD_READER_TTS_REF_CACHE_DIR", ROOT / ".cache" / "reference-codes"))
DEFAULT_BACKBONE = "neuphonic/neutts-air-q8-gguf"
DEFAULT_CODEC = "neuphonic/neucodec-onnx-decoder"
ENCODER_CODEC = "neuphonic/neucodec"


def choose_default_voice() -> str | None:
    configured = os.environ.get("MD_READER_TTS_DEFAULT_VOICE")
    if configured:
        return configured
    voices = sorted(path.stem for path in VOICES_DIR.glob("*.wav") if path.with_suffix(".txt").exists())
    return voices[0] if voices else None


def emit(event: dict[str, Any]) -> None:
    print(json.dumps(event, ensure_ascii=False), flush=True)


def can_import(module_name: str, attr_name: str | None = None) -> bool:
    try:
        module = importlib.import_module(module_name)
        if attr_name:
            getattr(module, attr_name)
        return True
    except Exception:
        return False


def check_environment() -> int:
    checks = {
        "neutts": can_import("neutts", "NeuTTS"),
        "neucodec": can_import("neucodec", "NeuCodec"),
        "onnxruntime": can_import("onnxruntime"),
        "pyaudio": can_import("pyaudio"),
    }
    voices = sorted(path.stem for path in VOICES_DIR.glob("*.wav") if path.with_suffix(".txt").exists())
    payload = {
        "type": "check",
        "python": sys.version.split()[0],
        "voicesDir": str(VOICES_DIR),
        "referenceCacheDir": str(REF_CACHE_DIR),
        "voices": voices,
        "checks": checks,
        "ok": all(checks.values()),
    }
    emit(payload)
    return 0 if payload["ok"] else 1


class TtsServer:
    def __init__(self) -> None:
        self.tts = None
        self.reference_encoder = None
        self.py_audio = None
        self.audio_stream = None
        self.voice_cache: dict[str, tuple[Any, str]] = {}
        self.active_mode: str | None = None
        self.active_utterances: list[dict[str, Any]] = []
        self.current_index = 0
        self.playback_thread: threading.Thread | None = None
        self.generation_lock = threading.Lock()
        self.playback_generation = 0
        self.stop_requested = threading.Event()
        self.pause_requested = threading.Event()
        self.state = "idle"

    def ensure_stream(self) -> None:
        if self.tts is not None:
            return

        emit({"type": "status", "state": "initializing"})
        emit({
            "type": "status",
            "state": "downloading-model",
            "message": "Loading TTS model...",
        })

        import pyaudio
        from neutts import NeuTTS

        if not VOICES_DIR.exists():
            VOICES_DIR.mkdir(parents=True, exist_ok=True)

        default_voice = choose_default_voice()
        backbone_repo = os.environ.get("MD_READER_TTS_BACKBONE", DEFAULT_BACKBONE)
        codec_repo = os.environ.get("MD_READER_TTS_CODEC", DEFAULT_CODEC)
        device = os.environ.get("MD_READER_TTS_DEVICE", "cpu")

        emit({
            "type": "status",
            "state": "downloading-model",
            "message": f"Loading {backbone_repo} and {codec_repo}.",
        })
        with contextlib.redirect_stdout(sys.stderr):
            self.tts = NeuTTS(
                backbone_repo=backbone_repo,
                backbone_device=device,
                codec_repo=codec_repo,
                codec_device=device,
            )
        self.py_audio = pyaudio.PyAudio()
        voices = self.available_voices()
        emit({
            "type": "status",
            "state": "ready",
            "voices": voices,
            "voice": default_voice or (voices[0] if voices else None),
            "backbone": backbone_repo,
        })

    def available_voices(self) -> list[str]:
        return sorted(path.stem for path in VOICES_DIR.glob("*.wav") if path.with_suffix(".txt").exists())

    def load_voice(self, voice: str | None) -> tuple[Any, str, str]:
        voices = self.available_voices()
        selected = voice if voice in voices else choose_default_voice()
        if not selected:
            raise RuntimeError(f"No valid TTS voice pairs were found in {VOICES_DIR}.")
        if selected not in self.voice_cache:
            wav_path = VOICES_DIR / f"{selected}.wav"
            text_path = VOICES_DIR / f"{selected}.txt"
            ref_text = text_path.read_text(encoding="utf-8").strip()
            if not ref_text:
                raise RuntimeError(f"TTS voice transcript is empty: {text_path}")
            emit({
                "type": "status",
                "state": "initializing",
                "message": f"Preparing reference voice: {selected}",
            })
            ref_codes = self.load_reference_codes(selected, wav_path)
            self.voice_cache[selected] = (ref_codes, ref_text)
        ref_codes, ref_text = self.voice_cache[selected]
        return ref_codes, ref_text, selected

    def load_reference_codes(self, voice: str, wav_path: Path) -> Any:
        import torch

        REF_CACHE_DIR.mkdir(parents=True, exist_ok=True)
        cache_path = REF_CACHE_DIR / f"{voice}.pt"
        if cache_path.exists():
            emit({
                "type": "status",
                "state": "initializing",
                "message": f"Loading cached reference voice: {voice}",
            })
            return torch.load(cache_path, map_location="cpu")

        if self.reference_encoder is None:
            from neucodec import NeuCodec

            emit({
                "type": "status",
                "state": "initializing",
                "message": "Encoding reference voice for first use. This uses the full codec once.",
            })
            with contextlib.redirect_stdout(sys.stderr):
                self.reference_encoder = NeuCodec.from_pretrained(ENCODER_CODEC)
                self.reference_encoder.eval().to(os.environ.get("MD_READER_TTS_DEVICE", "cpu"))

        with contextlib.redirect_stdout(sys.stderr):
            import librosa
            import torch

            wav, _ = librosa.load(wav_path, sr=16000, mono=True)
            wav_tensor = torch.from_numpy(wav).float().unsqueeze(0).unsqueeze(0)
            with torch.no_grad():
                ref_codes = self.reference_encoder.encode_code(audio_or_path=wav_tensor).squeeze(0).squeeze(0)
        torch.save(ref_codes, cache_path)
        return ref_codes

    def wait_while_paused(self) -> None:
        while self.pause_requested.is_set() and not self.stop_requested.is_set():
            time.sleep(0.05)

    def write_audio(self, audio: Any) -> None:
        import numpy as np

        if self.audio_stream is None:
            return

        samples = np.asarray(audio, dtype=np.float32).reshape(-1)
        chunk_size = 24_000
        for offset in range(0, len(samples), chunk_size):
            if self.stop_requested.is_set():
                break
            self.wait_while_paused()
            if self.stop_requested.is_set():
                break
            self.audio_stream.write(samples[offset:offset + chunk_size].tobytes())

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
        start_index = int(command.get("startIndex") or 0)
        start_index = max(0, min(start_index, len(self.active_utterances) - 1))
        self.current_index = start_index

        self.stop_requested.clear()
        self.pause_requested.clear()
        self.playback_generation += 1
        generation = self.playback_generation
        self.state = "playing"

        def run() -> None:
            try:
                import pyaudio

                assert self.tts is not None
                assert self.py_audio is not None
                ref_codes, ref_text, selected_voice = self.load_voice(str(command.get("voice") or ""))
                emit({"type": "status", "state": "playing", "mode": self.active_mode, "voice": selected_voice})
                self.audio_stream = self.py_audio.open(
                    format=pyaudio.paFloat32,
                    channels=1,
                    rate=24_000,
                    output=True,
                )
                audio_queue: queue.Queue[tuple[int, dict[str, Any] | None, Any]] = queue.Queue(maxsize=2)

                emit({
                    "type": "status",
                    "state": "initializing",
                    "mode": self.active_mode,
                    "message": f"Generating audio for segment {start_index + 1}/{len(self.active_utterances)}",
                })

                def generate_audio() -> None:
                    try:
                        assert self.tts is not None
                        for index, utterance in enumerate(self.active_utterances[start_index:], start=start_index):
                            if self.stop_requested.is_set() or generation != self.playback_generation:
                                break
                            text = str(utterance.get("text", "")).strip()
                            with self.generation_lock:
                                if self.stop_requested.is_set() or generation != self.playback_generation:
                                    break
                                with contextlib.redirect_stdout(sys.stderr):
                                    audio = self.tts.infer(text, ref_codes, ref_text)
                            if self.stop_requested.is_set() or generation != self.playback_generation:
                                break
                            while not self.stop_requested.is_set() and generation == self.playback_generation:
                                try:
                                    audio_queue.put((index, utterance, audio), timeout=0.1)
                                    break
                                except queue.Full:
                                    continue
                    except Exception as error:
                        try:
                            audio_queue.put((-1, None, error), timeout=0.1)
                        except queue.Full:
                            pass
                    finally:
                        try:
                            audio_queue.put((-2, None, None), timeout=0.1)
                        except queue.Full:
                            pass

                producer = threading.Thread(target=generate_audio, daemon=True)
                producer.start()

                while not self.stop_requested.is_set():
                    try:
                        index, utterance, audio = audio_queue.get(timeout=0.1)
                    except queue.Empty:
                        continue
                    if index == -2:
                        break
                    if index == -1:
                        raise audio
                    if utterance is None:
                        continue
                    if self.stop_requested.is_set():
                        break
                    self.current_index = index
                    text = str(utterance.get("text", "")).strip()
                    emit({
                        "type": "utterance-start",
                        "id": utterance.get("id"),
                        "index": index,
                        "text": text,
                    })
                    emit({
                        "type": "status",
                        "state": "playing",
                        "mode": self.active_mode,
                        "message": f"Playing segment {index + 1}/{len(self.active_utterances)}",
                    })
                    self.write_audio(audio)
                    emit({"type": "utterance-end", "id": utterance.get("id"), "index": index})
                    if not self.stop_requested.is_set():
                        self.current_index = min(index + 1, len(self.active_utterances) - 1)
                if not self.stop_requested.is_set():
                    emit({"type": "status", "state": "ended", "mode": self.active_mode})
            except Exception as error:
                emit({"type": "error", "message": str(error)})
            finally:
                if self.audio_stream is not None:
                    try:
                        self.audio_stream.stop_stream()
                        self.audio_stream.close()
                    except Exception:
                        pass
                    self.audio_stream = None
                self.state = "stopped" if self.stop_requested.is_set() else "ended"

        self.playback_thread = threading.Thread(target=run, daemon=True)
        self.playback_thread.start()

    def pause(self) -> None:
        self.pause_requested.set()
        self.state = "paused"
        emit({"type": "status", "state": "paused", "mode": self.active_mode})

    def resume(self) -> None:
        if self.state == "stopped" and self.active_utterances:
            self.speak({
                "type": "speak",
                "mode": self.active_mode,
                "utterances": self.active_utterances,
                "startIndex": self.current_index,
            })
            return
        self.pause_requested.clear()
        self.state = "playing"
        emit({"type": "status", "state": "playing", "mode": self.active_mode})

    def stop(self) -> None:
        self.playback_generation += 1
        self.stop_requested.set()
        self.pause_requested.clear()
        self.state = "stopped"
        emit({"type": "status", "state": "stopped", "mode": self.active_mode})

    def restart(self) -> None:
        if not self.active_utterances:
            emit({"type": "error", "message": "No active TTS session to restart."})
            return
        self.stop()
        self.current_index = 0
        emit({"type": "status", "state": "stopped", "mode": self.active_mode, "message": "Rewound to beginning"})

    def status(self) -> None:
        emit({"type": "status", "state": self.state, "mode": self.active_mode})

    def shutdown(self) -> None:
        self.stop()
        if self.py_audio is not None:
            try:
                self.py_audio.terminate()
            except Exception:
                pass
            self.py_audio = None
        self.reference_encoder = None

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
