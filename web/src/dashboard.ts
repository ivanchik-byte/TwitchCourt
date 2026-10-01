// Shared wire protocol, inlined per page so each bundle stays dependency-free.
namespace Tribunal {
  export type ServerEvent =
    | { type: "state_change"; payload: StateChange }
    | { type: "subtitles"; payload: Subtitles }
    | { type: "audio_chunk"; payload: AudioChunk }
    | { type: "animation"; payload: Animation }
    | { type: "voting_update"; payload: VotingUpdate }
    | { type: "verdict"; payload: Verdict }
    | { type: "panic"; payload: Record<string, unknown> };

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

  export interface AudioChunk {
    index: number;
    audio_base64: string;
    text: string;
    is_last: boolean;
  }

  export interface Animation {
    name: string;
    duration_ms?: number;
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
    penalty?: string;
  }

  export interface StreamerProfile {
    name: string;
    titles?: string[];
    traits?: string[];
    running_gags?: string[];
    mercy?: string;
  }

  export interface TrialRecord {
    defendant: string;
    crime: string;
    verdict: string;
    guilty: number;
    innocent: number;
  }

  export interface Accuser {
    name: string;
    sue_calls: number;
    votes: number;
  }

  export interface CourtSettings {
    min_amounts: Record<string, number>;
    default_min: number;
    punishments: string[];
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

  export function splitLines(value: string): string[] {
    return value
      .split("\n")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  export function splitList(value: string): string[] {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  export function joinList(items: string[] | undefined): string {
    return Array.isArray(items) ? items.join(", ") : "";
  }
}

// Studio desk: dispatcher, hardware keys, transcript, settings.
(function () {
  function el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error("missing node #" + id);
    return node as T;
  }

  const stageDot = el("stage-dot");
  const stageLabel = el("stage-label");
  const wsStatusText = el("ws-status-text");
  const btnPanic = el("btn-panic");
  const btnCopyObs = el("btn-copy-obs");

  const customTrialForm = el("custom-trial-form") as HTMLFormElement;
  const defendantInput = el("defendant-input") as HTMLInputElement;
  const crimeInput = el("crime-input") as HTMLInputElement;
  const contextInput = el("context-input") as HTMLTextAreaElement;

  const activeCaseName = el("active-case-name");
  const activePhaseBadge = el("active-phase-badge");
  const transcriptFeed = el("transcript-feed");
  const btnClearTranscript = el("btn-clear-transcript");

  const gaugeGuiltyPct = el("gauge-guilty-pct");
  const gaugeGuiltyVotes = el("gauge-guilty-votes");
  const gaugeInnocentPct = el("gauge-innocent-pct");
  const gaugeInnocentVotes = el("gauge-innocent-votes");
  const gaugeTimer = el("gauge-timer");
  const gaugeFillGuilty = el("gauge-fill-guilty");
  const gaugeFillInnocent = el("gauge-fill-innocent");

  const keyObjection = el("key-objection");
  const keySlam = el("key-slam");
  const keyVerdict = el("key-verdict");
  const keyReset = el("key-reset");
  const btnVoteGuilty = el("btn-vote-guilty");
  const btnVoteInnocent = el("btn-vote-innocent");

  const canvas = el("audio-visualizer-canvas") as HTMLCanvasElement;
  const peakReadout = el("audio-peak-readout");

  const secretInput = el("secret-input") as HTMLInputElement;
  const minRub = el("min-rub") as HTMLInputElement;
  const minUsd = el("min-usd") as HTMLInputElement;
  const minEur = el("min-eur") as HTMLInputElement;
  const minBits = el("min-bits") as HTMLInputElement;
  const minDefault = el("min-default") as HTMLInputElement;
  const punishmentsInput = el("punishments-input") as HTMLTextAreaElement;
  const settingsForm = el("court-settings-form") as HTMLFormElement;
  const settingsStatus = el("settings-status");
  const simForm = el("donate-sim-form") as HTMLFormElement;
  const simDonor = el("sim-donor") as HTMLInputElement;
  const simAmount = el("sim-amount") as HTMLInputElement;
  const simCurrency = el("sim-currency") as HTMLInputElement;
  const simMessage = el("sim-message") as HTMLInputElement;

  let ws: WebSocket | null = null;
  let speaking = false;
  const voterId = "desk_user_" + Math.floor(Math.random() * 100000);

  function secret(): string {
    return secretInput.value.trim();
  }

  function authHeaders(): Record<string, string> {
    const value = secret();
    return value ? { "X-Tribunal-Secret": value } : {};
  }

  class Visualizer {
    private view: CanvasRenderingContext2D;
    private bars = 36;
    private heights: Float32Array;
    private caps: Float32Array;
    private phase = 0;
    private width = 0;
    private height = 110;

    constructor(private target: HTMLCanvasElement) {
      const view = target.getContext("2d");
      if (!view) throw new Error("no 2d context");
      this.view = view;
      this.heights = new Float32Array(this.bars);
      this.caps = new Float32Array(this.bars);
      this.fit();
      window.addEventListener("resize", () => this.fit());
      this.loop();
    }

    fit(): void {
      const box = this.target.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.target.width = box.width * dpr;
      this.target.height = 110 * dpr;
      this.view.setTransform(dpr, 0, 0, dpr, 0, 0);
      this.width = box.width;
      this.height = 110;
    }

    loop(): void {
      this.render();
      requestAnimationFrame(() => this.loop());
    }

    render(): void {
      this.phase += 0.08;
      const view = this.view;
      view.clearRect(0, 0, this.width, this.height);
      view.strokeStyle = "rgba(255, 255, 255, 0.04)";
      view.lineWidth = 1;
      for (let y = 25; y < this.height; y += 25) {
        view.beginPath();
        view.moveTo(0, y);
        view.lineTo(this.width, y);
        view.stroke();
      }
      const barWidth = (this.width - (this.bars - 1) * 3) / this.bars;
      const grad = view.createLinearGradient(0, this.height, 0, 0);
      grad.addColorStop(0, "#3b170b");
      grad.addColorStop(0.4, "#f59e0b");
      grad.addColorStop(0.85, "#dc2626");
      grad.addColorStop(1, "#f87171");
      const cadence = speaking ? Math.sin(this.phase * 0.7) * 0.5 + 0.5 : 0.08;
      let peak = 0;
      for (let i = 0; i < this.bars; i++) {
        const target = (Math.sin(i * 0.28 + this.phase * 1.5) * 0.5 + 0.5) * (this.height - 18) * cadence;
        this.heights[i] += (target - this.heights[i]) * 0.35;
        if (this.heights[i] > this.caps[i]) this.caps[i] = this.heights[i];
        else this.caps[i] = Math.max(0, this.caps[i] - 0.8);
        if (this.heights[i] > peak) peak = this.heights[i];
        const x = i * (barWidth + 3);
        view.fillStyle = grad;
        view.fillRect(x, this.height - this.heights[i], barWidth, this.heights[i]);
        view.fillStyle = this.caps[i] > this.height * 0.7 ? "#ef4444" : "#fbbf24";
        view.fillRect(x, Math.max(2, this.height - this.caps[i] - 2), barWidth, 2);
      }
      void peak;
      peakReadout.textContent = speaking
        ? (-3.2 - Math.random() * 4).toFixed(1) + " dBFS [ACTIVE]"
        : "-∞ dBFS [IDLE]";
    }
  }

  new Visualizer(canvas);

  function logTranscript(speaker: string, text: string, role: string): void {
    const now = new Date();
    const pad = (n: number): string => String(n).padStart(2, "0");
    const line = document.createElement("div");
    line.className = "feed-line";
    const stamp = document.createElement("span");
    stamp.className = "time-stamp";
    stamp.textContent = "[" + pad(now.getHours()) + ":" + pad(now.getMinutes()) + ":" + pad(now.getSeconds()) + "] ";
    const tag = document.createElement("span");
    tag.className = "speaker-tag " + role;
    tag.textContent = speaker + ": ";
    const body = document.createElement("span");
    body.className = "line-text";
    body.textContent = text;
    line.appendChild(stamp);
    line.appendChild(tag);
    line.appendChild(body);
    transcriptFeed.appendChild(line);
    transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
  }

  function sendAction(action: string, payload: Record<string, unknown>): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const body: Record<string, unknown> = { ...payload };
    if (secret() && (action === "start_trial" || action === "panic")) {
      body["secret"] = secret();
    }
    ws.send(JSON.stringify({ action, payload: body }));
  }

  function updateGauge(guilty: number, innocent: number, timeLeft: number): void {
    gaugeGuiltyVotes.textContent = "(" + guilty + " голосов)";
    gaugeInnocentVotes.textContent = "(" + innocent + " голосов)";
    const total = guilty + innocent;
    const share = total > 0 ? Math.round((guilty / total) * 100) : 50;
    gaugeGuiltyPct.textContent = share + "%";
    gaugeInnocentPct.textContent = 100 - share + "%";
    gaugeFillGuilty.style.width = share + "%";
    gaugeFillInnocent.style.width = 100 - share + "%";
    gaugeTimer.textContent = "00:" + String(timeLeft).padStart(2, "0");
  }

  function loadSettings(): void {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((settings: Tribunal.CourtSettings) => {
        const mins = settings.min_amounts || {};
        minRub.value = String(mins["RUB"] ?? settings.default_min ?? "");
        minUsd.value = String(mins["USD"] ?? settings.default_min ?? "");
        minEur.value = String(mins["EUR"] ?? settings.default_min ?? "");
        minBits.value = String(mins["BITS"] ?? settings.default_min ?? "");
        minDefault.value = String(settings.default_min ?? "");
        punishmentsInput.value = (settings.punishments || []).join("\n");
      })
      .catch(() => undefined);
  }

  function connect(): void {
    ws = new WebSocket(Tribunal.socketUrl("/ws"));
    ws.onopen = () => {
      wsStatusText.textContent = "WS: ONLINE";
      logTranscript("СИСТЕМА", "Связь со студийным ядром Go установлена.", "sys");
      loadSettings();
    };
    ws.onclose = () => {
      wsStatusText.textContent = "WS: ОФФЛАЙН";
      stageDot.className = "dot idle";
      stageLabel.textContent = "РАЗРЫВ";
      window.setTimeout(connect, 2000);
    };
    ws.onmessage = (event: MessageEvent<string>) => {
      const msg = Tribunal.parseEvent(event.data);
      if (!msg) return;
      switch (msg.type) {
        case "state_change": {
          const state = msg.payload.state || "idle";
          activePhaseBadge.textContent = state.toUpperCase();
          if (state === "idle") {
            stageDot.className = "dot idle";
            stageLabel.textContent = "ОЖИДАНИЕ";
            activePhaseBadge.classList.remove("active");
            activeCaseName.textContent = "Нет активного слушания";
            speaking = false;
          } else {
            stageDot.className = "dot active";
            stageLabel.textContent = "В ЭФИРЕ";
            activePhaseBadge.classList.add("active");
            if (msg.payload.case_title) {
              activeCaseName.textContent =
                msg.payload.case_title + " (" + (msg.payload.defendant || "") + ")";
              logTranscript(
                "СУД",
                "Открыто заседание по делу: " + msg.payload.case_title + ". Обвинение: " + (msg.payload.charge || ""),
                "sys"
              );
            }
          }
          break;
        }
        case "subtitles":
          if (msg.payload.text) {
            speaking = true;
            logTranscript(msg.payload.speaker || "ПРОКУРОР", msg.payload.text, "prosecutor");
            window.setTimeout(() => (speaking = false), 3000);
          }
          break;
        case "audio_chunk":
          speaking = true;
          window.setTimeout(() => {
            if (msg.type === "audio_chunk" && msg.payload.is_last) speaking = false;
          }, 1500);
          break;
        case "voting_update":
          updateGauge(msg.payload.guilty_count, msg.payload.innocent_count, msg.payload.time_left_sec);
          break;
        case "verdict": {
          let line = "ИТОГОВЫЙ ПРИГОВОР: " + msg.payload.verdict + ". (Голосов: " + msg.payload.guilty_votes + " из " + msg.payload.total_votes + ")";
          if (msg.payload.penalty) line += " Наказание: " + msg.payload.penalty;
          logTranscript("ВЕРДИКТ", line, "verdict");
          break;
        }
        case "panic":
          stageDot.className = "dot idle";
          stageLabel.textContent = "СБРОШЕНО";
          activePhaseBadge.textContent = "MUTED";
          activePhaseBadge.classList.remove("active");
          speaking = false;
          logTranscript("СИСТЕМА", "Экстренный сброс сцены! Звук и оверлей заглушены.", "sys");
          break;
      }
    };
  }

  customTrialForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendAction("start_trial", {
      defendant: defendantInput.value.trim(),
      crime: crimeInput.value.trim(),
      context: contextInput.value.trim(),
    });
  });

  document.querySelectorAll<HTMLDivElement>(".incident-card").forEach((card) => {
    card.addEventListener("click", () => {
      sendAction("start_trial", {
        defendant: card.getAttribute("data-defendant"),
        crime: card.getAttribute("data-crime"),
        context: card.getAttribute("data-context"),
      });
    });
  });

  keyObjection.addEventListener("click", () => {
    sendAction("animation", { name: "objection" });
    logTranscript("МАКРОС", "Выкрик ПРОТЕСТУЮ! [OBJECTION]", "prosecutor");
  });

  keySlam.addEventListener("click", () => {
    sendAction("animation", { name: "slam" });
    logTranscript("МАКРОС", "Удар молотком по столу [DESK SLAM]", "sys");
  });

  keyVerdict.addEventListener("click", () => {
    logTranscript("МАКРОС", "Принудительный запуск вынесения вердикта", "sys");
  });

  keyReset.addEventListener("click", () => sendAction("panic", {}));
  btnPanic.addEventListener("click", () => sendAction("panic", {}));

  btnVoteGuilty.addEventListener("click", () => sendAction("vote", { voter: voterId, is_guilty: true }));
  btnVoteInnocent.addEventListener("click", () => sendAction("vote", { voter: voterId, is_guilty: false }));

  btnClearTranscript.addEventListener("click", () => {
    transcriptFeed.innerHTML = "";
    logTranscript("СИСТЕМА", "Журнал стенограммы очищен.", "sys");
  });

  btnCopyObs.addEventListener("click", () => {
    navigator.clipboard
      .writeText("http://localhost:7890/overlay")
      .then(() => {
        btnCopyObs.style.background = "#10b981";
        const label = btnCopyObs.querySelector("span");
        if (label) label.textContent = "СКОПИРОВАНО!";
        window.setTimeout(() => {
          btnCopyObs.style.background = "#0284c7";
          const restore = btnCopyObs.querySelector("span");
          if (restore) restore.textContent = "OBS ССЫЛКА";
        }, 1500);
      })
      .catch(() => undefined);
  });

  settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const num = (input: HTMLInputElement): number | null => {
      const raw = input.value.trim();
      if (raw === "") return null;
      const parsed = Number(raw);
      return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    };
    const mins: Record<string, number> = {};
    const rub = num(minRub);
    const usd = num(minUsd);
    const eur = num(minEur);
    const bits = num(minBits);
    if (rub !== null) mins["RUB"] = rub;
    if (usd !== null) mins["USD"] = usd;
    if (eur !== null) mins["EUR"] = eur;
    if (bits !== null) mins["BITS"] = bits;
    const fallback = num(minDefault);
    const body: Record<string, unknown> = {
      min_amounts: mins,
      punishments: Tribunal.splitLines(punishmentsInput.value),
    };
    if (fallback !== null) body["default_min"] = fallback;
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    })
      .then((res) => {
        settingsStatus.textContent = res.ok ? "Сохранено, суд запомнил." : "Не сохранено: проверьте секрет.";
      })
      .catch(() => {
        settingsStatus.textContent = "Нет связи с сервером.";
      });
  });

  simForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = Number(simAmount.value);
    if (!Number.isFinite(amount) || amount <= 0) return;
    fetch("/api/donate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        donor: simDonor.value.trim() || "Аноним",
        amount,
        currency: simCurrency.value.trim() || "RUB",
        message: simMessage.value.trim(),
      }),
    }).catch(() => undefined);
  });

  window.addEventListener("keydown", (event) => {
    if (event.key === "F12") {
      event.preventDefault();
      sendAction("panic", {});
    } else if (event.key === "F9") {
      event.preventDefault();
      const cards = document.querySelectorAll(".incident-card");
      if (cards.length > 0) (cards[0] as HTMLElement).click();
    }
  });

  connect();
})();
