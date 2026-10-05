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

  function connect(): void {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(protocol + "//" + location.host + "/ws");
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
    ws.onclose = () => {
      window.setTimeout(connect, 2000);
    };
  }

  connect();
})();
