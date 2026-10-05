namespace Settings {
  export interface CourtSettings {
    min_amounts: Record<string, number>;
    default_min: number;
    punishments: string[];
    judge_style?: string;
    defense_sec?: number;
    testimony_sec?: number;
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
  const judgeStyle = el("judge-style") as HTMLSelectElement;
  const defenseSec = el("defense-sec") as HTMLInputElement;
  const testimonySec = el("testimony-sec") as HTMLInputElement;
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
      if (settings.judge_style) judgeStyle.value = settings.judge_style;
      if (typeof settings.defense_sec === "number") defenseSec.value = String(settings.defense_sec);
      if (typeof settings.testimony_sec === "number") testimonySec.value = String(settings.testimony_sec);
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
    const defenseSecs = num(defenseSec);
    const testimonySecs = num(testimonySec);
    body["judge_style"] = judgeStyle.value;
    if (defenseSecs !== null) body["defense_sec"] = defenseSecs;
    if (testimonySecs !== null) body["testimony_sec"] = testimonySecs;
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

  const ttsForm = el("tts-form") as HTMLFormElement;
  const ttsEngine = el("tts-engine") as HTMLSelectElement;
  const ttsJudgeVoice = el("tts-judge-voice") as HTMLInputElement;
  const ttsJudgeRate = el("tts-judge-rate") as HTMLInputElement;
  const ttsVoice = el("tts-voice") as HTMLInputElement;
  const ttsSileroURL = el("tts-silero-url") as HTMLInputElement;
  const ttsSileroJudge = el("tts-silero-judge") as HTMLInputElement;
  const ttsStatus = el("tts-status");

  interface TTSStatus {
    engine?: string;
    voice?: string;
    rate?: string;
    volume?: string;
    pitch?: string;
    judge_voice?: string;
    judge_rate?: string;
    silero_url?: string;
    silero_judge?: string;
  }

  function renderTTS(data: TTSStatus): void {
    if (data.engine) ttsEngine.value = data.engine;
    if (data.judge_voice) ttsJudgeVoice.value = data.judge_voice;
    if (data.judge_rate) ttsJudgeRate.value = data.judge_rate;
    if (data.voice) ttsVoice.value = data.voice;
    if (data.silero_url) ttsSileroURL.value = data.silero_url;
    if (data.silero_judge) ttsSileroJudge.value = data.silero_judge;
  }

  fetch("/api/tts")
    .then((res) => res.json())
    .then((data: TTSStatus) => renderTTS(data))
    .catch(() => undefined);

  ttsForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const body: Record<string, unknown> = { engine: ttsEngine.value };
    const put = (key: string, input: HTMLInputElement): void => {
      if (input.value.trim() !== "") body[key] = input.value.trim();
    };
    put("judge_voice", ttsJudgeVoice);
    put("judge_rate", ttsJudgeRate);
    put("voice", ttsVoice);
    put("silero_url", ttsSileroURL);
    put("silero_judge", ttsSileroJudge);
    fetch("/api/tts", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) {
          say(ttsStatus, "Ошибка: проверьте секретный ключ и движок.");
          return null;
        }
        return res.json() as Promise<TTSStatus>;
      })
      .then((data) => {
        if (data) {
          renderTTS(data);
          say(ttsStatus, "Голос переключён на " + (data.engine || "?") + ".");
        }
      })
      .catch(() => {
        say(ttsStatus, "Нет связи с сервером.");
      });
  });

  const intForm = el("integrations-form") as HTMLFormElement;
  const intDA = el("int-da") as HTMLInputElement;
  const intDP = el("int-dp") as HTMLInputElement;
  const intTwToken = el("int-tw-token") as HTMLInputElement;
  const intTwChannel = el("int-tw-channel") as HTMLInputElement;
  const intTwClient = el("int-tw-client") as HTMLInputElement;
  const intTwBroadcaster = el("int-tw-broadcaster") as HTMLInputElement;
  const intStatus = el("integrations-status");

  interface IntegrationsStatus {
    donationalerts?: boolean;
    donatepay?: boolean;
    twitch?: boolean;
    channel?: string;
    nick?: string;
    client_id?: string;
    broadcaster_id?: string;
  }

  function renderIntegrations(data: IntegrationsStatus): void {
    if (data.channel) intTwChannel.value = data.channel;
    if (data.client_id) intTwClient.value = data.client_id;
    if (data.broadcaster_id) intTwBroadcaster.value = data.broadcaster_id;
    const on = (v?: boolean): string => (v ? "да" : "нет");
    say(
      intStatus,
      "Подключено — DA: " + on(data.donationalerts) + ", DP: " + on(data.donatepay) + ", Twitch: " + on(data.twitch) + "."
    );
  }

  fetch("/api/integrations")
    .then((res) => res.json())
    .then((data: IntegrationsStatus) => renderIntegrations(data))
    .catch(() => undefined);

  intForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const body: Record<string, unknown> = {};
    const put = (key: string, input: HTMLInputElement): void => {
      if (input.value.trim() !== "") body[key] = input.value.trim();
    };
    put("donationalerts_token", intDA);
    put("donatepay_key", intDP);
    put("twitch_token", intTwToken);
    put("channel", intTwChannel);
    put("client_id", intTwClient);
    put("broadcaster_id", intTwBroadcaster);
    fetch("/api/integrations", {
      method: "PUT",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify(body),
    })
      .then((res) => {
        if (!res.ok) {
          say(intStatus, "Ошибка: проверьте секретный ключ.");
          return null;
        }
        return res.json() as Promise<IntegrationsStatus>;
      })
      .then((data) => {
        if (data) {
          renderIntegrations(data);
          intDA.value = "";
          intDP.value = "";
          intTwToken.value = "";
        }
      })
      .catch(() => {
        say(intStatus, "Нет связи с сервером.");
      });
  });

  const backdrop = document.getElementById("bg-canvas") as HTMLCanvasElement | null;
  if (backdrop && typeof Backdrop !== "undefined") Backdrop.mount(backdrop);
  const gooey = document.getElementById("gooey-nav");
  if (gooey && typeof GooeyNav !== "undefined") GooeyNav.mount(gooey);

  const sfxList = document.getElementById("sfx-list");
  const judgeStates = document.getElementById("judge-states");

  interface SFXStatus {
    sfx?: Array<{ name: string; size: number }>;
    judge?: Record<string, boolean>;
  }

  function loadOverlayStatus(): void {
    fetch("/api/sfx")
      .then((res) => res.json())
      .then((data: SFXStatus) => {
        if (sfxList) {
          while (sfxList.firstChild) sfxList.firstChild.remove();
          const files = (data && data.sfx) || [];
          if (files.length === 0) {
            const empty = document.createElement("li");
            empty.className = "feed-empty";
            empty.textContent = "Сэмплов нет.";
            sfxList.appendChild(empty);
          }
          files.forEach((file) => {
            const item = document.createElement("li");
            item.textContent = file.name + " · " + Math.round(file.size / 1024) + " КБ";
            sfxList.appendChild(item);
          });
        }
        if (judgeStates) {
          while (judgeStates.firstChild) judgeStates.firstChild.remove();
          const states = ["normal", "angry", "gavel"];
          states.forEach((state) => {
            const item = document.createElement("li");
            const has = data && data.judge && data.judge[state];
            item.textContent = state + (has ? " · загружено" : " · базовый портрет");
            judgeStates.appendChild(item);
          });
        }
      })
      .catch(() => undefined);
  }

  loadOverlayStatus();
})();
