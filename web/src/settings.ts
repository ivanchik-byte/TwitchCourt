namespace Settings {
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

(function () {
  function el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error("missing node #" + id);
    return node as T;
  }

  const srvDot = el("srv-dot");
  const srvLabel = el("srv-label");
  const secretInput = el("secret-input") as HTMLInputElement;

  function secret(): string {
    return secretInput.value.trim();
  }

  function authHeaders(): Record<string, string> {
    const value = secret();
    return value ? { "X-Tribunal-Secret": value } : {};
  }

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

  function say(node: HTMLElement, text: string): void {
    node.textContent = text;
  }

  function num(input: HTMLInputElement): number | null {
    const raw = input.value.trim();
    if (raw === "") return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
  }

  fetch("/api/status")
    .then((res) => {
      if (!res.ok) throw new Error("down");
      srvDot.className = "dot connected";
      say(srvLabel, "На связи");
    })
    .catch(() => {
      srvDot.className = "dot disconnected";
      say(srvLabel, "Нет связи");
    });

  fetch("/api/settings")
    .then((res) => res.json())
    .then((settings: Settings.CourtSettings) => {
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

  fetch("/api/profile")
    .then((res) => res.json())
    .then((profile: Settings.StreamerProfile) => {
      profileName.value = profile.name || "";
      profileTitles.value = Settings.joinList(profile.titles);
      profileTraits.value = Settings.joinList(profile.traits);
      profileGags.value = Settings.joinList(profile.running_gags);
      profileMercy.value = profile.mercy || "";
    })
    .catch(() => undefined);

  settingsForm.addEventListener("submit", (event) => {
    event.preventDefault();
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
      punishments: Settings.splitLines(punishmentsInput.value),
    };
    if (fallback !== null) body["default_min"] = fallback;
    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    })
      .then((res) => {
        say(settingsStatus, res.ok ? "Настройки сохранены." : "Ошибка: требуется секретный ключ.");
      })
      .catch(() => {
        say(settingsStatus, "Нет связи с сервером.");
      });
  });

  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({
        name: profileName.value.trim(),
        titles: Settings.splitList(profileTitles.value),
        traits: Settings.splitList(profileTraits.value),
        running_gags: Settings.splitList(profileGags.value),
        mercy: profileMercy.value.trim(),
      }),
    })
      .then((res) => {
        say(profileStatus, res.ok ? "Портрет сохранен." : "Ошибка: требуется секретный ключ.");
      })
      .catch(() => {
        say(profileStatus, "Нет связи с сервером.");
      });
  });

  const judgeForm = el("judge-form") as HTMLFormElement;
  const judgeState = el("judge-state") as HTMLSelectElement;
  const judgeFile = el("judge-file") as HTMLInputElement;
  const judgeStatus = el("judge-status");

  judgeForm.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!judgeFile.files || judgeFile.files.length === 0) {
      say(judgeStatus, "Выберите файл изображения.");
      return;
    }
    const data = new FormData();
    data.append("photo", judgeFile.files[0]);
    fetch("/api/judge/photo?state=" + encodeURIComponent(judgeState.value), {
      method: "POST",
      headers: { ...authHeaders() },
      body: data,
    })
      .then((res) => {
        say(judgeStatus, res.ok ? "Фото обновлено." : "Ошибка загрузки: проверьте файл и секретный ключ.");
      })
      .catch(() => {
        say(judgeStatus, "Нет связи с сервером.");
      });
  });


  function openView(name: string | null, syncHash = true): void {
    document.querySelectorAll<HTMLButtonElement>(".seg-card").forEach((btn) => {
      btn.classList.toggle("active", btn.getAttribute("data-view") === name);
    });
    document.querySelectorAll<HTMLElement>(".settings-view").forEach((view) => {
      view.classList.toggle("hidden", view.id !== name);
    });
    if (syncHash) {
      const hash = name ? "#/" + name.replace(/^view-/, "") : "";
      if (window.location.hash !== hash) {
        window.history.replaceState(null, "", hash === "" ? window.location.pathname : hash);
      }
    }
  }

  function viewFromHash(): string | null {
    const match = window.location.hash.match(/^#\/(court|donates|overlay)(\/.*)?$/);
    if (match) return "view-" + match[1];
    return "view-court";
  }

  document.querySelectorAll<HTMLButtonElement>(".seg-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-view");
      if (!target || btn.classList.contains("active")) return;
      openView(target);
    });
  });

  window.addEventListener("hashchange", () => {
    openView(viewFromHash(), false);
  });

  openView(viewFromHash(), false);

  const aiForm = el("ai-form") as HTMLFormElement;
  const aiProvider = el("ai-provider") as HTMLSelectElement;
  const aiModel = el("ai-model") as HTMLInputElement;
  const aiKey = el("ai-key") as HTMLInputElement;
  const aiTemp = el("ai-temp") as HTMLInputElement;
  const aiStatus = el("ai-status");

  interface AIStatus {
    provider?: string;
    model?: string;
    temperature?: number;
    has_key?: boolean;
    live?: boolean;
  }

  function renderAI(data: AIStatus): void {
    if (data.provider) aiProvider.value = data.provider;
    if (data.model) aiModel.value = data.model;
    if (typeof data.temperature === "number") aiTemp.value = String(data.temperature);
    if (typeof data.live === "boolean") {
      say(aiStatus, data.live ? "Мозг подключён, прокурор в эфире." : "Ключа нет — суд говорит заготовками (mock).");
    }
  }

  fetch("/api/ai")
    .then((res) => res.json())
    .then((data: AIStatus) => renderAI(data))
    .catch(() => undefined);

  aiForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const tempRaw = aiTemp.value.trim();
    const temp = tempRaw === "" ? null : Number(tempRaw);
    const body: Record<string, unknown> = {
      provider: aiProvider.value,
      model: aiModel.value.trim(),
      temperature: temp,
    };
    if (aiKey.value.trim() !== "") body["api_key"] = aiKey.value;
    if (typeof temp !== "number" || !Number.isFinite(temp)) delete body["temperature"];
    fetch("/api/ai", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) {
          say(aiStatus, "Ошибка: проверьте секретный ключ и провайдера.");
          return null;
        }
        return res.json() as Promise<AIStatus>;
      })
      .then((data) => {
        if (data) {
          renderAI(data);
          aiKey.value = "";
        }
      })
      .catch(() => {
        say(aiStatus, "Нет связи с сервером.");
      });
  });

  const backdrop = document.getElementById("bg-canvas") as HTMLCanvasElement | null;
  if (backdrop && typeof Backdrop !== "undefined") Backdrop.mount(backdrop);
  const gooey = document.getElementById("gooey-nav");
  if (gooey && typeof GooeyNav !== "undefined") GooeyNav.mount(gooey);
})();
