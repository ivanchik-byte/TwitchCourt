// Канцелярия суда: новое дело + настройки. Один бандл без зависимостей.
namespace Desk {
  export type ServerEvent =
    | { type: "state_change"; payload: StateChange }
    | { type: "voting_update"; payload: VotingUpdate }
    | { type: "verdict"; payload: Verdict }
    | { type: "panic"; payload: Record<string, unknown> }
    | { type: string; payload: Record<string, unknown> };

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
    penalty?: string;
  }

  export interface CourtSettings {
    min_amounts: Record<string, number>;
    default_min: number;
    punishments: string[];
  }

  export interface StreamerProfile {
    name: string;
    titles?: string[];
    traits?: string[];
    running_gags?: string[];
    mercy?: string;
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
  const currentState = el("current-state");
  const activeCaseTitle = el("active-case-title");
  const secretInput = el("secret-input") as HTMLInputElement;
  const btnPanic = el("btn-panic");

  const trialForm = el("trial-form") as HTMLFormElement;
  const defendantInput = el("defendant-input") as HTMLInputElement;
  const crimeInput = el("crime-input") as HTMLInputElement;
  const contextInput = el("context-input") as HTMLTextAreaElement;

  const simForm = el("donate-sim-form") as HTMLFormElement;
  const simDonor = el("sim-donor") as HTMLInputElement;
  const simAmount = el("sim-amount") as HTMLInputElement;
  const simCurrency = el("sim-currency") as HTMLInputElement;
  const simMessage = el("sim-message") as HTMLInputElement;
  const donateStatus = el("donate-status");

  const settingsForm = el("settings-form") as HTMLFormElement;
  const minRub = el("min-rub") as HTMLInputElement;
  const minUsd = el("min-usd") as HTMLInputElement;
  const minEur = el("min-eur") as HTMLInputElement;
  const minBits = el("min-bits") as HTMLInputElement;
  const minDefault = el("min-default") as HTMLInputElement;
  const punishmentsInput = el("punishments-input") as HTMLTextAreaElement;
  const settingsStatus = el("settings-status");

  const profileForm = el("profile-form") as HTMLFormElement;
  const profileName = el("profile-name") as HTMLInputElement;
  const profileTitles = el("profile-titles") as HTMLInputElement;
  const profileTraits = el("profile-traits") as HTMLInputElement;
  const profileGags = el("profile-gags") as HTMLInputElement;
  const profileMercy = el("profile-mercy") as HTMLInputElement;
  const profileStatus = el("profile-status");

  let ws: WebSocket | null = null;

  function secret(): string {
    return secretInput.value.trim();
  }

  function authHeaders(): Record<string, string> {
    const value = secret();
    return value ? { "X-Tribunal-Secret": value } : {};
  }

  function sendAction(action: string, payload: Record<string, unknown>): void {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const body: Record<string, unknown> = { ...payload };
    if (secret() && (action === "start_trial" || action === "panic")) {
      body["secret"] = secret();
    }
    ws.send(JSON.stringify({ action, payload: body }));
  }

  function renderState(state: string, title: string): void {
    Desk.say(currentState, state.toUpperCase());
    currentState.classList.toggle("active", state !== "idle");
    Desk.say(activeCaseTitle, title);
  }

  function loadSettings(): void {
    fetch("/api/settings")
      .then((res) => res.json())
      .then((settings: Desk.CourtSettings) => {
        const mins = settings.min_amounts || {};
        const fallback = settings.default_min;
        minRub.value = String(mins["RUB"] ?? fallback ?? "");
        minUsd.value = String(mins["USD"] ?? fallback ?? "");
        minEur.value = String(mins["EUR"] ?? fallback ?? "");
        minBits.value = String(mins["BITS"] ?? fallback ?? "");
        minDefault.value = String(fallback ?? "");
        punishmentsInput.value = (settings.punishments || []).join("\n");
      })
      .catch(() => undefined);
  }

  function loadProfile(): void {
    fetch("/api/profile")
      .then((res) => res.json())
      .then((profile: Desk.StreamerProfile) => {
        profileName.value = profile.name || "";
        profileTitles.value = Desk.joinList(profile.titles);
        profileTraits.value = Desk.joinList(profile.traits);
        profileGags.value = Desk.joinList(profile.running_gags);
        profileMercy.value = profile.mercy || "";
      })
      .catch(() => undefined);
  }

  function connect(): void {
    ws = new WebSocket(Desk.socketUrl("/ws"));
    ws.onopen = () => {
      wsDot.className = "dot connected";
      Desk.say(wsLabel, "На связи");
      loadSettings();
      loadProfile();
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
            renderState(state, "Нет активного дела");
          } else {
            const caseTitle = String(msg.payload.case_title || "");
            const defendant = String(msg.payload.defendant || "");
            renderState(state, caseTitle ? caseTitle + " (" + defendant + ")" : "Идет заседание");
          }
          break;
        }
        case "verdict": {
          let title = "Вердикт: " + String(msg.payload.verdict || "");
          if (msg.payload.penalty) title += ". Наказание: " + String(msg.payload.penalty);
          renderState("verdict", title);
          break;
        }
        case "panic":
          renderState("idle", "Сброшено");
          break;
        default:
          break;
      }
    };
  }

  trialForm.addEventListener("submit", (event) => {
    event.preventDefault();
    sendAction("start_trial", {
      defendant: defendantInput.value.trim(),
      crime: crimeInput.value.trim(),
      context: contextInput.value.trim(),
    });
  });

  document.querySelectorAll<HTMLButtonElement>(".chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      crimeInput.value = chip.getAttribute("data-crime") || "";
    });
  });

  btnPanic.addEventListener("click", () => sendAction("panic", {}));

  window.addEventListener("keydown", (event) => {
    if (event.key === "F12") {
      event.preventDefault();
      sendAction("panic", {});
    }
  });

  simForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const amount = Number(simAmount.value);
    if (!Number.isFinite(amount) || amount <= 0) {
      Desk.say(donateStatus, "Сумма должна быть больше нуля.");
      return;
    }
    fetch("/api/donate", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        donor: simDonor.value.trim() || "Аноним",
        amount,
        currency: simCurrency.value.trim() || "RUB",
        message: simMessage.value.trim(),
      }),
    })
      .then((res) => {
        Desk.say(donateStatus, res.ok ? "Донат принят судом." : "Донат отклонен: проверьте секрет.");
      })
      .catch(() => {
        Desk.say(donateStatus, "Нет связи с сервером.");
      });
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
      punishments: Desk.splitLines(punishmentsInput.value),
    };
    if (fallback !== null) body["default_min"] = fallback;
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    })
      .then((res) => {
        Desk.say(settingsStatus, res.ok ? "Записано в реестр." : "Не записано: проверьте секрет.");
      })
      .catch(() => {
        Desk.say(settingsStatus, "Нет связи с сервером.");
      });
  });

  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        name: profileName.value.trim(),
        titles: Desk.splitList(profileTitles.value),
        traits: Desk.splitList(profileTraits.value),
        running_gags: Desk.splitList(profileGags.value),
        mercy: profileMercy.value.trim(),
      }),
    })
      .then((res) => {
        Desk.say(profileStatus, res.ok ? "Портрет обновлен." : "Не сохранено: проверьте секрет.");
      })
      .catch(() => {
        Desk.say(profileStatus, "Нет связи с сервером.");
      });
  });

  connect();
})();
