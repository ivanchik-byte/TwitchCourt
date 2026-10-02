// Страница настроек: пороги донатов, наказания, портрет. Без сокетов.
namespace Settings {
  export interface CourtSettings {
    min_amounts: Record<string, number>;
    default_min: number;
    punishments: string[];
    minecraft_log?: string;
    minecraft_nicks?: string[];
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
      if (settings.minecraft_log && !logPathInput.value) {
        logPathInput.value = settings.minecraft_log;
        updatePathStatus(settings.minecraft_log, true);
      }
      if (Array.isArray(settings.minecraft_nicks) && settings.minecraft_nicks.length > 0 && mcNicks.length === 0) {
        mcNicks = settings.minecraft_nicks;
        renderNickTags();
      }
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
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
      .then((res) => {
        say(settingsStatus, res.ok ? "Записано в реестр." : "Не записано: нужен секрет.");
      })
      .catch(() => {
        say(settingsStatus, "Нет связи с сервером.");
      });
  });

  profileForm.addEventListener("submit", (event) => {
    event.preventDefault();
    fetch("/api/profile", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: profileName.value.trim(),
        titles: Settings.splitList(profileTitles.value),
        traits: Settings.splitList(profileTraits.value),
        running_gags: Settings.splitList(profileGags.value),
        mercy: profileMercy.value.trim(),
      }),
    })
      .then((res) => {
        say(profileStatus, res.ok ? "Портрет обновлен." : "Не сохранено: нужен секрет.");
      })
      .catch(() => {
        say(profileStatus, "Нет связи с сервером.");
      });
  });

  // Настройка игры Minecraft и автопоиск latest.log
  const cardMinecraft = el("card-minecraft");
  const modalMinecraft = el("modal-minecraft");
  const btnCloseModal = el("mc-modal-close");
  const btnDismissMc = el("mc-btn-dismiss");
  const btnSaveMc = el("mc-btn-save");

  const tagCloud = el("mc-tag-cloud");
  const nickInput = el("mc-nick-input") as HTMLInputElement;
  const btnAddNick = el("mc-btn-add-nick");
  const btnAddStreamer = el("mc-btn-add-streamer");
  const nicksCounter = el("mc-nicks-counter");
  const cardNicksMeta = el("mc-meta-nicks");

  const logPathInput = el("mc-log-path-input") as HTMLInputElement;
  const btnAutodetect = el("mc-btn-autodetect");
  const pathStatus = el("mc-path-status");
  const detectNote = el("mc-detect-note");
  const cardPathMeta = el("mc-meta-path");
  const cardBadge = el("mc-card-badge");

  const btnTestTrial = el("mc-btn-test-trial");
  const testStatus = el("mc-test-status");

  let mcNicks: string[] = [];
  try {
    const rawNicks = localStorage.getItem("st_mc_nicks");
    if (rawNicks) {
      const parsed = JSON.parse(rawNicks);
      if (Array.isArray(parsed)) mcNicks = parsed;
    }
  } catch {}

  try {
    const savedPath = localStorage.getItem("st_mc_path");
    if (savedPath) {
      logPathInput.value = savedPath;
    }
  } catch {}

  function renderNickTags(): void {
    tagCloud.innerHTML = "";
    if (mcNicks.length === 0) {
      const emptySpan = document.createElement("span");
      emptySpan.className = "tag-empty";
      emptySpan.textContent = "Список пуст (суд реагирует на гибель любого игрока)";
      tagCloud.appendChild(emptySpan);
      nicksCounter.textContent = "Все игроки";
      cardNicksMeta.textContent = "Ники: все игроки";
      return;
    }

    nicksCounter.textContent = mcNicks.length + " ник(а)";
    cardNicksMeta.textContent = "Ники: " + mcNicks.join(", ");

    mcNicks.forEach((nick) => {
      const chip = document.createElement("span");
      chip.className = "tag-chip";
      chip.textContent = nick;

      const removeBtn = document.createElement("button");
      removeBtn.type = "button";
      removeBtn.className = "tag-chip-remove";
      removeBtn.setAttribute("aria-label", "Удалить ник " + nick);
      removeBtn.textContent = "✕";
      removeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        mcNicks = mcNicks.filter((n) => n !== nick);
        try {
          localStorage.setItem("st_mc_nicks", JSON.stringify(mcNicks));
        } catch {}
        renderNickTags();
      });

      chip.appendChild(removeBtn);
      tagCloud.appendChild(chip);
    });
  }

  function addNick(nick: string): void {
    const trimmed = nick.trim();
    if (!trimmed) return;
    if (!mcNicks.includes(trimmed)) {
      mcNicks.push(trimmed);
      try {
        localStorage.setItem("st_mc_nicks", JSON.stringify(mcNicks));
      } catch {}
      renderNickTags();
    }
    nickInput.value = "";
  }

  btnAddNick.addEventListener("click", () => addNick(nickInput.value));
  nickInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      addNick(nickInput.value);
    }
  });

  btnAddStreamer.addEventListener("click", () => {
    const streamer = profileName.value.trim() || "Стример";
    addNick(streamer);
  });

  function updatePathStatus(path: string, found: boolean): void {
    if (!path) {
      pathStatus.textContent = "Не указан";
      pathStatus.className = "modal-badge-status";
      cardPathMeta.textContent = "Лог: автопоиск";
      cardBadge.textContent = "Настроить";
      return;
    }
    const filename = path.replace(/\\/g, "/").split("/").pop() || path;
    cardPathMeta.textContent = "Лог: " + filename;
    if (found) {
      pathStatus.textContent = "Файл найден";
      pathStatus.className = "modal-badge-status status-found";
      cardBadge.textContent = "Активен";
    } else {
      pathStatus.textContent = "Путь сохранен";
      pathStatus.className = "modal-badge-status";
      cardBadge.textContent = "Настроен";
    }
  }

  btnAutodetect.addEventListener("click", () => {
    detectNote.textContent = "Ищем файлы latest.log...";
    detectNote.className = "modal-note";
    fetch("/api/game/minecraft/detect")
      .then((res) => res.json())
      .then((data: { found?: boolean; path?: string; candidates?: string[] }) => {
        if (data.path) {
          logPathInput.value = data.path;
          try {
            localStorage.setItem("st_mc_path", data.path);
          } catch {}
          updatePathStatus(data.path, !!data.found);
          if (data.found) {
            detectNote.textContent = "Лог найден: " + data.path;
            detectNote.className = "modal-note note-ok";
          } else {
            detectNote.textContent = "Предложен путь: " + data.path + " (создастся при запуске)";
            detectNote.className = "modal-note";
          }
        } else {
          detectNote.textContent = "Стандартный путь не найден. Выбери шаблон или укажи вручную.";
          detectNote.className = "modal-note note-err";
        }
      })
      .catch(() => {
        detectNote.textContent = "Ошибка связи с сервером при автопоиске.";
        detectNote.className = "modal-note note-err";
      });
  });

  document.querySelectorAll<HTMLButtonElement>(".btn-preset").forEach((btn) => {
    btn.addEventListener("click", () => {
      const presetPath = btn.getAttribute("data-path");
      if (presetPath) {
        logPathInput.value = presetPath;
        try {
          localStorage.setItem("st_mc_path", presetPath);
        } catch {}
        updatePathStatus(presetPath, false);
        detectNote.textContent = "Выбран шаблон: " + presetPath;
        detectNote.className = "modal-note";
      }
    });
  });

  btnTestTrial.addEventListener("click", () => {
    testStatus.textContent = "Отправка тестового дела...";
    const targetDefendant = mcNicks.length > 0 ? mcNicks[0] : (profileName.value.trim() || "Стример");
    fetch("/api/trial", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        defendant: targetDefendant,
        crime: "Купание в лаве с полным инвентарем",
        context: "Тестовый запуск из меню Minecraft",
      }),
    })
      .then((res) => {
        if (res.ok) {
          testStatus.textContent = "Суд открыт для игрока " + targetDefendant + "!";
        } else {
          testStatus.textContent = "Суд занят или уже идет другое дело.";
        }
      })
      .catch(() => {
        testStatus.textContent = "Нет связи с сервером.";
      });
  });

  function openMinecraftModal(syncHash = true): void {
    modalMinecraft.classList.remove("hidden");
    cardMinecraft.setAttribute("aria-expanded", "true");
    try {
      localStorage.setItem("st_mc_modal", "open");
    } catch {}
    if (syncHash && window.location.hash !== "#/games/minecraft") {
      window.history.replaceState(null, "", "#/games/minecraft");
    }
  }

  function closeMinecraftModal(syncHash = true): void {
    modalMinecraft.classList.add("hidden");
    cardMinecraft.setAttribute("aria-expanded", "false");
    try {
      localStorage.setItem("st_mc_modal", "closed");
    } catch {}
    if (syncHash && window.location.hash === "#/games/minecraft") {
      window.history.replaceState(null, "", "#/games");
    }
  }

  cardMinecraft.addEventListener("click", () => openMinecraftModal(true));
  cardMinecraft.addEventListener("keydown", (e) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      openMinecraftModal(true);
    }
  });

  btnCloseModal.addEventListener("click", () => closeMinecraftModal(true));
  btnDismissMc.addEventListener("click", () => closeMinecraftModal(true));

  modalMinecraft.addEventListener("click", (e) => {
    if (e.target === modalMinecraft) {
      closeMinecraftModal(true);
    }
  });

  btnSaveMc.addEventListener("click", () => {
    const path = logPathInput.value.trim();
    try {
      localStorage.setItem("st_mc_path", path);
      localStorage.setItem("st_mc_nicks", JSON.stringify(mcNicks));
    } catch {}

    fetch("/api/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        minecraft_log: path,
        minecraft_nicks: mcNicks,
      }),
    })
      .then((res) => {
        if (res.ok) {
          updatePathStatus(path, path.length > 0);
          detectNote.textContent = "Настройки сохранены.";
          detectNote.className = "modal-note note-ok";
          setTimeout(() => closeMinecraftModal(true), 500);
        } else {
          detectNote.textContent = "Ошибка сохранения на сервере.";
          detectNote.className = "modal-note note-err";
        }
      })
      .catch(() => {
        updatePathStatus(path, false);
        detectNote.textContent = "Сохранено локально (нет связи с сервером).";
        detectNote.className = "modal-note";
        setTimeout(() => closeMinecraftModal(true), 500);
      });
  });

  renderNickTags();
  updatePathStatus(logPathInput.value, logPathInput.value.length > 0);

  window.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (!modalMinecraft.classList.contains("hidden")) closeMinecraftModal(true);
    }
  });

  // Синхронизация вкладок и хэша URL
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
    const match = window.location.hash.match(/^#\/(court|games|donates|overlay)(\/.*)?$/);
    return match ? "view-" + match[1] : null;
  }

  function shouldOpenMinecraftModal(): boolean {
    if (window.location.hash === "#/games/minecraft") return true;
    try {
      const saved = localStorage.getItem("st_mc_modal");
      if (saved === "open" && window.location.hash.startsWith("#/games")) {
        return true;
      }
    } catch {}
    return false;
  }

  document.querySelectorAll<HTMLButtonElement>(".seg-card").forEach((btn) => {
    btn.addEventListener("click", () => {
      const target = btn.getAttribute("data-view");
      if (!target) return;
      const isOpen = btn.classList.contains("active");
      if (isOpen) {
        closeMinecraftModal(false);
        openView(null);
      } else {
        openView(target);
      }
    });
  });

  window.addEventListener("hashchange", () => {
    const view = viewFromHash();
    openView(view, false);
    if (window.location.hash === "#/games/minecraft") {
      openMinecraftModal(false);
    } else if (!window.location.hash.startsWith("#/games")) {
      closeMinecraftModal(false);
    }
  });

  const initialView = viewFromHash();
  const mcModalOpen = shouldOpenMinecraftModal();
  if (mcModalOpen) {
    openView("view-games", false);
    openMinecraftModal(window.location.hash !== "#/games/minecraft");
  } else {
    openView(initialView, false);
  }

  const backdrop = document.getElementById("bg-canvas") as HTMLCanvasElement | null;
  if (backdrop && typeof Backdrop !== "undefined") Backdrop.mount(backdrop);
  const gooey = document.getElementById("gooey-nav");
  if (gooey && typeof GooeyNav !== "undefined") GooeyNav.mount(gooey);
})();
