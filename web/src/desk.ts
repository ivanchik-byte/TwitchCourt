namespace Desk {
  export type ServerEvent =
    | { type: "state_change"; payload: StateChange }
    | { type: "verdict"; payload: Verdict }
    | { type: "subtitles"; payload: Subtitles }
    | { type: "donation"; payload: Donation }
    | { type: "panic"; payload: Record<string, unknown> }
    | { type: string; payload: Record<string, unknown> };

  export interface Donation {
    donor: string;
    amount: number;
    currency: string;
    message?: string;
    opens_trial: boolean;
  }

  export interface StateChange {
    state: string;
    case_title?: string;
    defendant?: string;
    charge?: string;
    time_left_sec?: number;
  }

  export interface Subtitles {
    speaker: string;
    text: string;
  }

  export interface Verdict {
    verdict: string;
    guilty_votes: number;
    total_votes: number;
    witnesses?: number;
    penalty?: string;
    twist?: string;
  }

  export function socketUrl(path: string): string {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return protocol + "//" + location.host + path;
  }

  export function parseEvent(raw: string): ServerEvent | null {
    try {
      return JSON.parse(raw) as ServerEvent;
    } catch {
      return null;
    }
  }

  export function say(node: HTMLElement, text: string): void {
    node.textContent = text;
  }
}

(function () {
  function el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error("missing node #" + id);
    return node as T;
  }

  const wsDot = el("ws-dot");
  const wsLabel = el("ws-label");
  const secretInput = el("secret-input") as HTMLInputElement;
  const btnPanic = el("btn-panic");
  const btnGavel = el("btn-gavel");
  const deckStatus = el("deck-status");
  const eventFeed = el("stenogram");
  const phasePill = el("phase-pill");
  const phaseName = el("phase-name");
  const phaseTimer = el("phase-timer");
  const judgeLine = el("judge-line");
  const verdictLog = el("verdict-log");
  const dockCurrent = el("dock-current");
  const manualNick = el("manual-nick") as HTMLInputElement;
  const manualCrime = el("manual-crime") as HTMLInputElement;
  const btnManualTrial = el("btn-manual-trial");

  let ws: WebSocket | null = null;
  let phaseDeadline = 0;
  let phaseTick = 0;

  const phaseNames: Record<string, string> = {
    idle: "Зал пуст",
    indictment: "Обвинение",
    testimony: "Показания",
    defense: "Твоя защита",
    objection: "Протест",
    deliberation: "Совещание",
    verdict: "Приговор",
  };

  function stopTimer(): void {
    window.clearInterval(phaseTick);
    phaseTick = 0;
    phaseDeadline = 0;
    phaseTimer.textContent = "";
    phaseTimer.classList.remove("urgent");
  }

  function renderTimer(): void {
    if (!phaseDeadline) return;
    const left = Math.max(0, Math.round((phaseDeadline - Date.now()) / 1000));
    const pad = (n: number): string => String(n).padStart(2, "0");
    phaseTimer.textContent = pad(Math.floor(left / 60)) + ":" + pad(left % 60);
    phaseTimer.classList.toggle("urgent", left <= 5);
    if (left <= 0) stopTimer();
  }

  function renderPhase(state: string, timeLeft?: number): void {
    Desk.say(phasePill, phaseNames[state] || state);
    Desk.say(phaseName, phaseNames[state] || state);
    stopTimer();
    if (typeof timeLeft === "number" && timeLeft > 0 && state !== "idle") {
      phaseDeadline = Date.now() + timeLeft * 1000;
      renderTimer();
      phaseTick = window.setInterval(renderTimer, 500);
    }
  }

  function secret(): string {
    return secretInput.value.trim();
  }

  function authHeaders(): Record<string, string> {
    const value = secret();
    return value ? { "X-Tribunal-Secret": value } : {};
  }

  function post(path: string, body: Record<string, unknown>): Promise<boolean> {
    return fetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    })
      .then((res) => res.ok)
      .catch(() => false);
  }

  function sendAction(action: string, payload: Record<string, unknown>): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const body: Record<string, unknown> = { ...payload };
    if (secret() && (action === "start_trial" || action === "panic")) {
      body["secret"] = secret();
    }
    ws.send(JSON.stringify({ action, payload: body }));
  }

  function feed(text: string, tag: string): void {
    const empty = eventFeed.querySelector(".feed-empty");
    if (empty) empty.remove();
    const item = document.createElement("li");
    item.className = "feed-tag-" + tag;
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const stamp = document.createElement("span");
    stamp.className = "feed-time";
    stamp.textContent = "[" + pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds()) + "] ";
    item.appendChild(stamp);
    item.appendChild(document.createTextNode(text));
    eventFeed.prepend(item);
    while (eventFeed.children.length > 40) {
      const last = eventFeed.lastChild;
      if (last) last.remove();
      else break;
    }
  }

  function showTrial(title: string): void {
    Desk.say(dockCurrent, title);
  }

  function hideTrial(): void {
    Desk.say(dockCurrent, "Никого на скамье");
    renderPhase("idle");
  }

  function logVerdict(text: string): void {
    const empty = verdictLog.querySelector(".feed-empty");
    if (empty) empty.remove();
    const item = document.createElement("li");
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    item.textContent = "[" + pad(now.getHours()) + ":" + pad(now.getMinutes()) + "] " + text;
    verdictLog.prepend(item);
    while (verdictLog.children.length > 5) {
      const last = verdictLog.lastChild;
      if (last) last.remove();
      else break;
    }
  }

  function connect(): void {
    ws = new WebSocket(Desk.socketUrl("/ws"));
    ws.onopen = () => {
      wsDot.className = "dot connected";
      Desk.say(wsLabel, "На связи");
    };
    ws.onclose = () => {
      wsDot.className = "dot disconnected";
      Desk.say(wsLabel, "Переподключение...");
      window.setTimeout(connect, 2000);
    };
    ws.onmessage = (event: MessageEvent<string>) => {
      const msg = Desk.parseEvent(event.data);
      if (!msg) return;
      switch (msg.type) {
        case "state_change": {
          const state = String(msg.payload.state || "idle");
          const secs = typeof msg.payload.time_left_sec === "number" ? msg.payload.time_left_sec : undefined;
          renderPhase(state, secs);
          if (state === "idle") {
            hideTrial();
          } else {
            const defendant = String(msg.payload.defendant || "");
            if (defendant) showTrial("На скамье: " + defendant);
            const caseTitle = String(msg.payload.case_title || "");
            if (caseTitle) feed("Открыто дело: " + caseTitle, "trial");
          }
          break;
        }
        case "subtitles": {
          const speaker = String(msg.payload.speaker || "");
          const text = String(msg.payload.text || "");
          if (text) Desk.say(judgeLine, speaker ? speaker + ": " + text : text);
          break;
        }
        case "donation": {
          const donor = String(msg.payload.donor || "Аноним");
          const amount = Number(msg.payload.amount || 0);
          const currency = String(msg.payload.currency || "");
          const line = "Донат " + donor + " · " + amount + (currency ? " " + currency : "");
          feed(msg.payload.opens_trial ? line + " — суд открыт" : line + " — в копилку", "donation");
          break;
        }
        case "verdict": {
          const parts = ["Вердикт: " + String(msg.payload.verdict || "")];
          const witnessCount = Number(msg.payload.witnesses || 0);
          if (witnessCount > 0) parts.push("свидетели +" + witnessCount);
          if (msg.payload.penalty) parts.push("наказание: " + String(msg.payload.penalty));
          if (msg.payload.twist) parts.push(String(msg.payload.twist));
          feed(parts.join(" · "), "verdict");
          logVerdict(parts.join(" · "));
          break;
        }
        case "panic":
          hideTrial();
          feed("Суд сброшен вручную", "trial");
          break;
        default:
          break;
      }
    };
  }

  btnGavel.addEventListener("click", () => {
    sendAction("animation", { name: "slam" });
    post("/api/say", { text: "Суд слушает!" }).then((ok) => {
      Desk.say(deckStatus, ok ? "Суд слушает!" : "Команда отклонена: проверьте секретный ключ.");
    });
  });

  btnPanic.addEventListener("click", () => sendAction("panic", {}));

  window.addEventListener("keydown", (event) => {
    if (event.key === "F12") {
      event.preventDefault();
      sendAction("panic", {});
      return;
    }
    if (event.repeat || event.ctrlKey || event.metaKey || event.altKey) return;
    const target = event.target as HTMLElement | null;
    if (target && (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT")) return;
    switch (event.key) {
      case " ":
        event.preventDefault();
        btnGavel.click();
        break;
      case "1":
      case "2":
      case "3":
      case "4": {
        const chips = Array.from(document.querySelectorAll<HTMLButtonElement>("#punish-row .chip"));
        const chip = chips[Number(event.key) - 1];
        if (chip) chip.click();
        break;
      }
      case "r":
      case "R":
      case "к":
      case "К":
        pickSeat("");
        break;
      case "Tab":
        event.preventDefault();
        if (btnDockSkip) (btnDockSkip as HTMLButtonElement).click();
        break;
      default:
        break;
    }
  });

  document.querySelectorAll<HTMLButtonElement>("#article-row .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      manualCrime.value = chip.getAttribute("data-crime") || "";
      manualNick.focus();
    });
  });

  btnManualTrial.addEventListener("click", () => {
    const defendant = manualNick.value.trim();
    const crime = manualCrime.value.trim();
    if (!defendant || !crime) {
      Desk.say(deckStatus, "Впиши ник и статью.");
      return;
    }
    post("/api/trial", { defendant, crime, viewer: true }).then((ok) => {
      Desk.say(deckStatus, ok ? "Дело открыто." : "Суд занят или нет связи.");
    });
  });

  const backdrop = document.getElementById("bg-canvas") as HTMLCanvasElement | null;
  if (backdrop) Backdrop.mount(backdrop);
  const gooey = document.getElementById("gooey-nav");
  if (gooey) GooeyNav.mount(gooey);
  const teleLlm = document.getElementById("tele-llm");
  const teleTts = document.getElementById("tele-tts");
  const teleRtt = document.getElementById("tele-rtt");

  function loadTelemetry(): void {
    const t0 = performance.now();
    fetch("/api/status")
      .then(() => {
        if (teleRtt) teleRtt.textContent = Math.round(performance.now() - t0) + "ms";
      })
      .catch(() => undefined);
    fetch("/api/ai")
      .then((res) => res.json())
      .then((data: { provider?: string; model?: string; live?: boolean }) => {
        if (!teleLlm) return;
        const short = String(data.model || "").split("/").pop()?.split("-").slice(0, 2).join(" ") || "";
        teleLlm.textContent = data.live ? String(data.provider || "?") + " " + short : "mock";
      })
      .catch(() => undefined);
    fetch("/api/tts")
      .then((res) => res.json())
      .then((data: { engine?: string }) => {
        if (teleTts) teleTts.textContent = String(data.engine || "?");
      })
      .catch(() => undefined);
  }

  loadTelemetry();
  window.setInterval(loadTelemetry, 60000);
  connect();

  interface PoolSeat {
    Nick: string;
    Reason: string;
    JoinedAt: string;
  }

  interface DockState {
    pool?: PoolSeat[];
    defendant?: string;
    punishment?: { Kind: string; Secs: number };
  }

  const poolList = document.getElementById("dock-list");
  const dockStatus = document.getElementById("dock-status");
  const punishStatus = document.getElementById("punish-status");
  const btnDockRandom = document.getElementById("btn-dock-random");
  const btnDockSkip = document.getElementById("btn-dock-skip");

  function dockSay(text: string): void {
    if (dockStatus) dockStatus.textContent = text;
  }

  function punishLabel(p: { Kind: string; Secs: number }): string {
    switch (p.Kind) {
      case "pardon":
        return "Помилование";
      case "ban":
        return "Бан";
      default:
        return "Мут " + p.Secs + "с";
    }
  }

  function avatarColor(nick: string): string {
    let h = 0;
    for (let i = 0; i < nick.length; i++) h = (h * 31 + nick.charCodeAt(i)) % 360;
    return "hsl(" + h + ", 60%, 42%)";
  }

  function waitLabel(joined?: string): string {
    if (!joined) return "";
    const ms = Date.now() - Date.parse(joined);
    if (!isFinite(ms) || ms < 0) return "";
    const m = Math.floor(ms / 60000);
    if (m < 1) return "меньше минуты";
    if (m < 60) return m + " мин";
    return Math.floor(m / 60) + " ч " + (m % 60) + " мин";
  }

  function seatLine(seat: PoolSeat): HTMLElement {
    const item = document.createElement("li");
    item.className = "dock-seat";
    const av = document.createElement("span");
    av.className = "avatar";
    av.textContent = seat.Nick.slice(0, 1).toUpperCase();
    av.style.background = avatarColor(seat.Nick);
    item.appendChild(av);
    const body = document.createElement("span");
    body.textContent = seat.Nick + (seat.Reason ? " — «" + seat.Reason + "»" : "") + " · ждёт " + waitLabel(seat.JoinedAt);
    item.appendChild(body);
    const take = document.createElement("button");
    take.type = "button";
    take.className = "chip";
    take.textContent = "На скамью";
    take.addEventListener("click", () => pickSeat(seat.Nick));
    item.appendChild(document.createTextNode(" "));
    item.appendChild(take);
    return item;
  }
  function pickSeat(nick: string): void {
    fetch("/api/dock/pick", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(nick ? { nick } : {}),
    })
      .then((res) => {
        if (res.ok) loadDock();
        else dockSay("Суд занят или очередь пуста.");
      })
      .catch(() => dockSay("Нет связи с сервером."));
  }

  if (btnDockRandom) btnDockRandom.addEventListener("click", () => pickSeat(""));
  if (btnDockSkip) {
    btnDockSkip.addEventListener("click", () => {
      fetch("/api/dock/skip", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: "{}",
      })
        .then(() => loadDock())
        .catch(() => dockSay("Нет связи с сервером."));
    });
  }

  document.querySelectorAll<HTMLButtonElement>("#punish-row .chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      const kind = chip.getAttribute("data-kind") || "timeout";
      const secs = Number(chip.getAttribute("data-secs") || "90");
      fetch("/api/punish", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders() },
        body: JSON.stringify({ kind, secs }),
      })
        .then((res) => res.json())
        .then((data: { punishment?: { Kind: string; Secs: number } }) => {
          const p = data && data.punishment;
          if (punishStatus && p) {
            punishStatus.textContent = "Кара: " + punishLabel(p);
          }
        })
        .catch(() => undefined);
    });
  });

  function loadDock(): void {
    if (!poolList) return;
    fetch("/api/dock")
      .then((res) => res.json())
      .then((data: DockState) => {
        while (poolList.firstChild) poolList.firstChild.remove();
        const items = (data && data.pool) || [];
        if (data && data.defendant) {
          const now = document.createElement("li");
          now.textContent = "На скамье: " + data.defendant;
          poolList.appendChild(now);
        }
        if (items.length === 0) {
          const empty = document.createElement("li");
          empty.className = "feed-empty";
          empty.textContent = "Очередь пуста. Ждём !court.";
          poolList.appendChild(empty);
        }
        items.forEach((seat) => {
          poolList.appendChild(seatLine(seat));
        });
        const p = data && data.punishment;
        if (punishStatus && p) {
          punishStatus.textContent = "Кара: " + punishLabel(p);
        }
      })
      .catch(() => undefined);
  }

  loadDock();
  window.setInterval(loadDock, 3000);
})();
