(function () {
  function el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error("missing node #" + id);
    return node as T;
  }

  const img = el("judge") as HTMLImageElement;

  let timer = 0;

  function setJudge(state: string, flashMs = 0): void {
    img.src = "/api/judge/photo?state=" + state + "&t=" + Date.now();
    img.classList.remove("bang");
    void img.offsetWidth;
    if (state === "gavel") img.classList.add("bang");
    window.clearTimeout(timer);
    if (flashMs > 0) {
      timer = window.setTimeout(() => {
        img.classList.remove("bang");
        img.src = "/api/judge/photo?state=normal&t=" + Date.now();
      }, flashMs);
    }
  }

  function connect(): void {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(protocol + "//" + location.host + "/ws");
    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: { type?: string; payload?: { name?: string } };
      try {
        msg = JSON.parse(event.data) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === "animation") {
        const name = (msg.payload && msg.payload.name) || "";
        if (name === "slam" || name === "desk_slam") setJudge("gavel", 900);
      } else if (msg.type === "verdict") {
        setJudge("angry", 2500);
      } else if (msg.type === "state_change" || msg.type === "panic") {
        setJudge("normal");
      }
    };
    ws.onclose = () => {
      window.setTimeout(connect, 2000);
    };
  }

  connect();
})();
