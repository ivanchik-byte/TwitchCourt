"""Silero TTS v5 sidecar for Stream Tribunal.

Serves local neural Russian speech over HTTP so the Go server stays
dependency-free. Only torch (+stdlib) is required on top of Python.

Setup on the streamer PC (one time):
    pip install torch --index-url https://download.pytorch.org/whl/cpu
    pip install numpy
    python tools/silero_sidecar.py            # listens on 127.0.0.1:7892

Then set `tts.engine: silero` in config.yaml. The v5_ru.pt model
(~87 MB) downloads itself on first launch.

Protocol: POST /synthesize {"text": str, "speaker": str} -> WAV bytes.
Speakers: aidar, baya, kseniya, eugene, ... (29 total in v5).
Stress marks with "+" (вин+овен) pass through to the accentor.
"""

import io
import json
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch

MODEL_URL = "https://models.silero.ai/models/tts/ru/v5_ru.pt"
SAMPLE_RATE = 48000

_model = None


def get_model():
    global _model
    if _model is None:
        torch.set_num_threads(4)
        _model = torch.package.PackageImporter(_fetch()).load_pickle("tts_models", "model")
        _model.to(torch.device("cpu"))
        # Warm-up so the first live replica is not cold.
        _model.apply_tts(text="Суд слушает.", speaker="aidar", sample_rate=SAMPLE_RATE)
    return _model


def _fetch():
    import os

    local = os.path.join(os.path.dirname(os.path.abspath(__file__)), "v5_ru.pt")
    if not os.path.isfile(local):
        torch.hub.download_url_to_file(MODEL_URL, local)
    return local


def to_wav(samples) -> bytes:
    import numpy as np

    pcm = (samples.numpy() * 32767).astype("<i2")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())
    return buf.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "TribunalSilero/1.0"

    def log_message(self, *args):
        pass

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_error(404)
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            body = json.loads(self.rfile.read(length) or b"{}")
            text = str(body.get("text", ""))[:500]
            speaker = str(body.get("speaker", "aidar")) or "aidar"
            if not text.strip():
                self.send_error(400, "empty text")
                return
            audio = get_model().apply_tts(text=text, speaker=speaker, sample_rate=SAMPLE_RATE)
            wav = to_wav(audio)
        except Exception as exc:  # noqa: BLE001 - report back as 500
            self.send_error(500, str(exc)[:200])
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav)))
        self.end_headers()
        self.wfile.write(wav)


if __name__ == "__main__":
    get_model()
    server = ThreadingHTTPServer(("127.0.0.1", 7892), Handler)
    print("silero sidecar on http://127.0.0.1:7892")
    server.serve_forever()
