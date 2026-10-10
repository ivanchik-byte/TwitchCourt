(function () {
  function el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error("missing node #" + id);
    return node as T;
  }

  const img = el("judge") as HTMLImageElement;

  let bangTimer = 0;
  let talkTimer = 0;

  function startTalking(): void {
    img.classList.add("talking");
    window.clearTimeout(talkTimer);
    // no speech-end event on the socket: stop bouncing after 6s of silence
    talkTimer = window.setTimeout(stopTalking, 6000);
  }

  function stopTalking(): void {
    window.clearTimeout(talkTimer);
    img.classList.remove("talking");
  }

  function slam(): void {
    img.classList.remove("bang");
    void img.offsetWidth;
    img.classList.add("bang");
    window.clearTimeout(bangTimer);
    bangTimer = window.setTimeout(() => img.classList.remove("bang"), 700);
  }

  let failures = 0;

  function connect(): void {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(protocol + "//" + location.host + "/ws" + location.search);
    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: { type?: string; payload?: { name?: string; state?: string } };
      try {
        msg = JSON.parse(event.data) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === "subtitles" || msg.type === "audio_chunk") {
        startTalking();
      } else if (msg.type === "animation") {
        const name = (msg.payload && msg.payload.name) || "";
        if (name === "slam" || name === "desk_slam") slam();
      } else if (
        msg.type === "verdict" ||
        msg.type === "panic" ||
        (msg.type === "state_change" && msg.payload?.state === "idle")
      ) {
        stopTalking();
      }
    };
    ws.onopen = () => {
      failures = 0;
    };
    ws.onclose = () => {
      failures += 1;
      const delay = Math.min(2000 * 2 ** failures, 30000) + Math.floor(Math.random() * 500);
      window.setTimeout(connect, delay);
    };
  }

  connect();
})();
