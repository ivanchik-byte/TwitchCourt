"""Local Russian speech for TwitchCourt. Prepare with ./voice.sh silero."""

import io
import json
import os
from pathlib import Path
import sys
import threading
import wave
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

import torch

MODEL_URL = "https://models.silero.ai/models/tts/ru/v5_ru.pt"
SAMPLE_RATE = 48000
_model = None
_status = "loading"
_synthesis = threading.Lock()


def load_model(server):
    global _model, _status
    try:
        torch.set_num_threads(4)
        local = Path(__file__).resolve().with_name("v5_ru.pt")
        if not local.is_file():
            partial = local.with_suffix(".pt.part")
            torch.hub.download_url_to_file(MODEL_URL, str(partial))
            os.replace(partial, local)
        model = torch.package.PackageImporter(str(local)).load_pickle("tts_models", "model")
        model.to(torch.device("cpu"))
        model.apply_tts(text="Суд слушает.", speaker="aidar", sample_rate=SAMPLE_RATE)
        _model = model
        _status = "ready"
        print("Silero готов", flush=True)
    except Exception as error:
        _status = "error"
        print(f"Не удалось загрузить модель Silero: {error}", flush=True)
        server.shutdown()


def to_wav(samples):
    pcm = (samples.detach().cpu().numpy().clip(-1, 1) * 32767).astype("<i2")
    output = io.BytesIO()
    with wave.open(output, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(SAMPLE_RATE)
        wav.writeframes(pcm.tobytes())
    return output.getvalue()


class Handler(BaseHTTPRequestHandler):
    server_version = "TribunalSilero/2.0"

    def do_GET(self):
        if self.path != "/health":
            self.send_error(404)
            return
        body = json.dumps({"service": "tribunal-silero", "status": _status,
                           "voices": list(_model.speakers) if _model is not None else []}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != "/synthesize":
            self.send_error(404)
            return
        if _status != "ready":
            self.send_error(503, "model is not ready")
            return
        try:
            length = int(self.headers.get("Content-Length", 0))
            if length <= 0 or length > 16384:
                self.send_error(400, "invalid body size")
                return
            body = json.loads(self.rfile.read(length))
            text = body.get("text", "")
            speaker = body.get("speaker", "kseniya")
            if not isinstance(text, str) or not text.strip() or len(text) > 2000:
                self.send_error(400, "text must contain 1 to 2000 characters")
                return
            if speaker not in _model.speakers:
                self.send_error(400, "unknown speaker")
                return
            with _synthesis, torch.inference_mode():
                clip = _model.apply_tts(text=text, speaker=speaker, sample_rate=SAMPLE_RATE)
                wav = to_wav(clip)
        except (ValueError, TypeError, RuntimeError) as error:
            print(f"Ошибка синтеза Silero: {error}", flush=True)
            self.send_error(500, "synthesis failed")
            return
        self.send_response(200)
        self.send_header("Content-Type", "audio/wav")
        self.send_header("Content-Length", str(len(wav)))
        self.end_headers()
        self.wfile.write(wav)


if __name__ == "__main__":
    server = ThreadingHTTPServer(("127.0.0.1", 7892), Handler)
    threading.Thread(target=load_model, args=(server,), daemon=True).start()
    print("Silero: http://127.0.0.1:7892, загружается модель", flush=True)
    try:
        server.serve_forever()
    finally:
        server.server_close()
    if _status == "error":
        sys.exit(1)
