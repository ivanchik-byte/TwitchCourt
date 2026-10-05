// Invisible defense mic: while the court is in the defense window,
// the dashboard tab listens to the streamer via Web Speech API and
// streams final transcripts to the server. No UI of its own: status
// reuses the existing trial-status footnote when present.
(function () {
  const Impl = (window as unknown as { SpeechRecognition?: any }).SpeechRecognition ||
    (window as unknown as { webkitSpeechRecognition?: any }).webkitSpeechRecognition;

  let ws: WebSocket | null = null;
  let rec: any = null;
  let defending = false;
  let pending = "";
  let meterCtx: AudioContext | null = null;
  let meterAnalyser: AnalyserNode | null = null;
  let meterStream: MediaStream | null = null;
  let meterRaf = 0;

  function status(text: string): void {
    const node = document.getElementById("trial-status");
    if (node) node.textContent = text;
  }

  function transcript(text: string): void {
    const node = document.getElementById("mic-transcript");
    if (node) node.textContent = text;
  }

  function buildMeter(): void {
    const box = document.getElementById("mic-meter");
    if (!box || box.children.length > 0) return;
    for (let i = 0; i < 24; i++) {
      const seg = document.createElement("span");
      seg.className = "seg";
      box.appendChild(seg);
    }
  }

  function paintMeter(level: number): void {
    const box = document.getElementById("mic-meter");
    if (!box) return;
    const lit = Math.round(level * 24);
    const segs = box.children;
    for (let i = 0; i < segs.length; i++) {
      const seg = segs[i] as HTMLElement;
      seg.className = "seg" + (i < lit ? " on" + (i >= 19 ? " hot" : i >= 13 ? " warn" : "") : "");
    }
  }

  function meterTick(): void {
    if (!defending || !meterAnalyser) return;
    const data = new Uint8Array(meterAnalyser.frequencyBinCount);
    meterAnalyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    paintMeter(Math.min(1, Math.sqrt(sum / data.length) * 4));
    meterRaf = requestAnimationFrame(meterTick);
  }

  function startLevel(): void {
    try {
      const media = (navigator as any).mediaDevices;
      if (!media || !media.getUserMedia) return;
      media.getUserMedia({ audio: true }).then(
        (stream: MediaStream) => {
          if (!defending) {
            stream.getTracks().forEach((t) => t.stop());
            return;
          }
          try {
            const Impl =
              window.AudioContext ||
              (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
            meterCtx = new Impl();
            meterStream = stream;
            const source = meterCtx.createMediaStreamSource(stream);
            meterAnalyser = meterCtx.createAnalyser();
            meterAnalyser.fftSize = 512;
            source.connect(meterAnalyser);
            cancelAnimationFrame(meterRaf);
            meterRaf = requestAnimationFrame(meterTick);
          } catch {
            /* level meter unavailable, speech still works */
          }
        },
        () => undefined
      );
    } catch {
      /* no mic for levels */
    }
  }

  function stopLevel(): void {
    cancelAnimationFrame(meterRaf);
    paintMeter(0);
    if (meterStream) {
      meterStream.getTracks().forEach((t) => t.stop());
      meterStream = null;
    }
    if (meterCtx) {
      void meterCtx.close().catch(() => undefined);
      meterCtx = null;
    }
    meterAnalyser = null;
  }

  function sendChunk(): void {
    const text = pending.trim();
    pending = "";
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ action: "defense", payload: { author: "стример", text } }));
  }

  function startMic(): void {
    pending = "";
    transcript("");
    startLevel();
    if (!Impl) return;
    try {
      rec = new Impl();
    } catch {
      return;
    }
    rec.lang = "ru-RU";
    rec.continuous = true;
    rec.interimResults = false;
    rec.onresult = (event: any) => {
      for (let i = event.resultIndex; i < event.results.length; i++) {
        const res = event.results[i];
        if (res.isFinal) {
          const line = String(res[0].transcript);
          pending += line + " ";
          transcript(line);
          sendChunk();
        }
      }
    };
    // Chrome ends sessions on silence: resume while the window is open.
    rec.onend = () => {
      if (defending) {
        try {
          rec.start();
        } catch {
          /* mic locked, chat quotes cover the defense */
        }
      }
    };
    try {
      rec.start();
    } catch {
      rec = null;
      return;
    }
    status("Суд слушает защиту, говорите...");
  }

  function stopMic(): void {
    defending = false;
    stopLevel();
    if (rec) {
      try {
        rec.onend = null;
        rec.stop();
      } catch {
        /* already stopped */
      }
      rec = null;
    }
    sendChunk();
  }

  function connect(): void {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host + "/ws");
    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: { type?: string; payload?: { state?: string } };
      try {
        msg = JSON.parse(event.data) as typeof msg;
      } catch {
        return;
      }
      if (msg.type !== "state_change") return;
      const state = String((msg.payload && msg.payload.state) || "idle");
      if (state === "defense" && !defending) {
        defending = true;
        startMic();
      } else if (state !== "defense" && defending) {
        stopMic();
      }
    };
    ws.onclose = () => {
      window.setTimeout(connect, 2000);
    };
  }

  buildMeter();
  connect();
})();
