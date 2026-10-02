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

  function status(text: string): void {
    const node = document.getElementById("trial-status");
    if (node) node.textContent = text;
  }

  function sendChunk(): void {
    const text = pending.trim();
    pending = "";
    if (!text || !ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ action: "defense", payload: { author: "стример", text } }));
  }

  function startMic(): void {
    pending = "";
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
          pending += String(res[0].transcript) + " ";
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

  connect();
})();
