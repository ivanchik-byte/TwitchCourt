// Тактический пульт стримера: шкала терпения, быстрые плитки,
// активный суд с ручным вердиктом, лента событий с метками.
namespace Desk {
  export type ServerEvent =
    | { type: "state_change"; payload: StateChange }
    | { type: "voting_update"; payload: VotingUpdate }
    | { type: "verdict"; payload: Verdict }
    | { type: "donation"; payload: Donation }
    | { type: "suspicion"; payload: Suspicion }
    | { type: "panic"; payload: Record<string, unknown> }
    | { type: string; payload: Record<string, unknown> };

  export interface Donation {
    donor: string;
    amount: number;
    currency: string;
    message?: string;
    opens_trial: boolean;
  }

  export interface Suspicion {
    meter: number;
    milestone: number;
  }

  export interface StateChange {
    state: string;
    case_title?: string;
    defendant?: string;
    charge?: string;
    time_left_sec?: number;
  }

  export interface VotingUpdate {
    guilty_count: number;
    innocent_count: number;
    time_left_sec: number;
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
  const meterFill = el("meter-fill");
  const meterNum = el("meter-num");
  const secretInput = el("secret-input") as HTMLInputElement;
  const btnPanic = el("btn-panic");
  const btnGavel = el("btn-gavel");
  const deckStatus = el("deck-status");
  const trialBox = el("trial-box");
  const activeCaseTitle = el("active-case-title");
  const voteTimer = el("vote-timer");
  const voteGuiltyN = el("vote-guilty-n");
  const voteInnocentN = el("vote-innocent-n");
  const voteGuiltyBar = el("vote-guilty-bar");
  const voteInnocentBar = el("vote-innocent-bar");
  const btnForceGuilty = el("btn-force-guilty");
  const btnForceInnocent = el("btn-force-innocent");
  const trialStatus = el("trial-status");
  const eventFeed = el("event-feed");

  let ws: WebSocket | null = null;

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
    while (eventFeed.children.length > 30) {
      const last = eventFeed.lastChild;
      if (last) last.remove();
      else break;
    }
  }

  function renderMeter(meter: number): void {
    const clamped = Math.max(0, Math.min(100, meter));
    meterFill.style.width = clamped + "%";
    meterNum.textContent = clamped + "%";
    meterFill.classList.toggle("hot", clamped >= 60);
  }

  function pollStatus(): void {
    fetch("/api/status")
      .then((res) => res.json())
      .then((status: { meter?: number }) => {
        if (typeof status.meter === "number") renderMeter(status.meter);
      })
      .catch(() => undefined);
  }

  function showTrial(title: string): void {
    Desk.say(activeCaseTitle, title);
    trialBox.classList.remove("hidden");
  }

  function hideTrial(): void {
    trialBox.classList.add("hidden");
  }

  function connect(): void {
    ws = new WebSocket(Desk.socketUrl("/ws"));
    ws.onopen = () => {
      wsDot.className = "dot connected";
      Desk.say(wsLabel, "На связи");
      pollStatus();
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
          if (state === "idle") {
            hideTrial();
          } else if (state === "voting") {
            showTrial(String(msg.payload.case_title || "Идет голосование"));
          } else {
            const caseTitle = String(msg.payload.case_title || "");
            const defendant = String(msg.payload.defendant || "");
            showTrial(caseTitle ? caseTitle + " (" + defendant + ")" : "Идет заседание");
            if (caseTitle) feed("Открыто дело: " + caseTitle, "trial");
          }
          break;
        }
        case "donation": {
          const donor = String(msg.payload.donor || "Аноним");
          const amount = Number(msg.payload.amount || 0);
          const currency = String(msg.payload.currency || "");
          const line = "Донат " + donor + " · " + amount + (currency ? " " + currency : "");
          feed(msg.payload.opens_trial ? line + " — суд открыт" : line + " — в память", "donation");
          break;
        }
        case "suspicion": {
          const meter = Number(msg.payload.meter || 0);
          renderMeter(meter);
          feed("Папка дела №404: " + meter + "%", "trial");
          break;
        }
        case "voting_update": {
          const guilty = Number(msg.payload.guilty_count || 0);
          const innocent = Number(msg.payload.innocent_count || 0);
          Desk.say(voteTimer, String(msg.payload.time_left_sec));
          Desk.say(voteGuiltyN, String(guilty));
          Desk.say(voteInnocentN, String(innocent));
          const total = guilty + innocent;
          const share = total > 0 ? Math.round((guilty / total) * 100) : 50;
          voteGuiltyBar.style.width = share + "%";
          voteInnocentBar.style.width = 100 - share + "%";
          break;
        }
        case "verdict": {
          const parts = ["Вердикт: " + String(msg.payload.verdict || "")];
          const witnessCount = Number(msg.payload.witnesses || 0);
          if (witnessCount > 0) parts.push("свидетели +" + witnessCount);
          if (msg.payload.penalty) parts.push("наказание: " + String(msg.payload.penalty));
          if (msg.payload.twist) parts.push(String(msg.payload.twist));
          feed(parts.join(" · "), "verdict");
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

  document.querySelectorAll<HTMLButtonElement>(".tile").forEach((tile) => {
    tile.addEventListener("click", () => {
      post("/api/trial", {
        defendant: tile.getAttribute("data-defendant") || "Стример",
        crime: tile.getAttribute("data-crime") || "",
        context: tile.getAttribute("data-context") || "",
      }).then((ok) => {
        Desk.say(deckStatus, ok ? "Дело открыто." : "Суд занят или нет связи.");
      });
    });
  });

  btnGavel.addEventListener("click", () => {
    sendAction("animation", { name: "slam" });
    post("/api/say", { text: "Суд слушает!" }).then((ok) => {
      if (!ok) Desk.say(deckStatus, "Молоток не долетел: проверьте секрет.");
    });
  });

  btnPanic.addEventListener("click", () => sendAction("panic", {}));

  window.addEventListener("keydown", (event) => {
    if (event.key === "F12") {
      event.preventDefault();
      sendAction("panic", {});
    }
  });

  function forceVerdict(guilty: boolean): void {
    post("/api/verdict", { guilty }).then((ok) => {
      Desk.say(trialStatus, ok ? "Вердикт вынесен." : "Нет голосования или нет связи.");
    });
  }

  btnForceGuilty.addEventListener("click", () => forceVerdict(true));
  btnForceInnocent.addEventListener("click", () => forceVerdict(false));

  const backdrop = document.getElementById("bg-canvas") as HTMLCanvasElement | null;
  if (backdrop) Backdrop.mount(backdrop);
  const gooey = document.getElementById("gooey-nav");
  if (gooey) GooeyNav.mount(gooey);
  connect();
  window.setInterval(pollStatus, 2000);
})();
