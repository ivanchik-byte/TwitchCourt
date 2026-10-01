"use strict";
// Канцелярия суда: новое дело + настройки. Один бандл без зависимостей.
var Desk;
(function (Desk) {
    function socketUrl(path) {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        return protocol + "//" + location.host + path;
    }
    Desk.socketUrl = socketUrl;
    function parseEvent(raw) {
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    Desk.parseEvent = parseEvent;
    function splitLines(value) {
        return value
            .split("\n")
            .map((part) => part.trim())
            .filter((part) => part.length > 0);
    }
    Desk.splitLines = splitLines;
    function splitList(value) {
        return value
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0);
    }
    Desk.splitList = splitList;
    function joinList(items) {
        return Array.isArray(items) ? items.join(", ") : "";
    }
    Desk.joinList = joinList;
    function say(node, text) {
        node.textContent = text;
    }
    Desk.say = say;
})(Desk || (Desk = {}));
(function () {
    function el(id) {
        const node = document.getElementById(id);
        if (!node)
            throw new Error("missing node #" + id);
        return node;
    }
    const wsDot = el("ws-dot");
    const wsLabel = el("ws-label");
    const currentState = el("current-state");
    const activeCaseTitle = el("active-case-title");
    const secretInput = el("secret-input");
    const btnPanic = el("btn-panic");
    const trialForm = el("trial-form");
    const defendantInput = el("defendant-input");
    const crimeInput = el("crime-input");
    const contextInput = el("context-input");
    const simForm = el("donate-sim-form");
    const simDonor = el("sim-donor");
    const simAmount = el("sim-amount");
    const simCurrency = el("sim-currency");
    const simMessage = el("sim-message");
    const donateStatus = el("donate-status");
    const settingsForm = el("settings-form");
    const minRub = el("min-rub");
    const minUsd = el("min-usd");
    const minEur = el("min-eur");
    const minBits = el("min-bits");
    const minDefault = el("min-default");
    const punishmentsInput = el("punishments-input");
    const settingsStatus = el("settings-status");
    const profileForm = el("profile-form");
    const profileName = el("profile-name");
    const profileTitles = el("profile-titles");
    const profileTraits = el("profile-traits");
    const profileGags = el("profile-gags");
    const profileMercy = el("profile-mercy");
    const profileStatus = el("profile-status");
    let ws = null;
    function secret() {
        return secretInput.value.trim();
    }
    function authHeaders() {
        const value = secret();
        return value ? { "X-Tribunal-Secret": value } : {};
    }
    function sendAction(action, payload) {
        if (!ws || ws.readyState !== WebSocket.OPEN)
            return;
        const body = { ...payload };
        if (secret() && (action === "start_trial" || action === "panic")) {
            body["secret"] = secret();
        }
        ws.send(JSON.stringify({ action, payload: body }));
    }
    function renderState(state, title) {
        Desk.say(currentState, state.toUpperCase());
        currentState.classList.toggle("active", state !== "idle");
        Desk.say(activeCaseTitle, title);
    }
    function loadSettings() {
        fetch("/api/settings")
            .then((res) => res.json())
            .then((settings) => {
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
    function loadProfile() {
        fetch("/api/profile")
            .then((res) => res.json())
            .then((profile) => {
            profileName.value = profile.name || "";
            profileTitles.value = Desk.joinList(profile.titles);
            profileTraits.value = Desk.joinList(profile.traits);
            profileGags.value = Desk.joinList(profile.running_gags);
            profileMercy.value = profile.mercy || "";
        })
            .catch(() => undefined);
    }
    function connect() {
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
        ws.onmessage = (event) => {
            const msg = Desk.parseEvent(event.data);
            if (!msg)
                return;
            switch (msg.type) {
                case "state_change": {
                    const state = String(msg.payload.state || "idle");
                    if (state === "idle") {
                        renderState(state, "Нет активного дела");
                    }
                    else {
                        const caseTitle = String(msg.payload.case_title || "");
                        const defendant = String(msg.payload.defendant || "");
                        renderState(state, caseTitle ? caseTitle + " (" + defendant + ")" : "Идет заседание");
                    }
                    break;
                }
                case "verdict": {
                    let title = "Вердикт: " + String(msg.payload.verdict || "");
                    if (msg.payload.penalty)
                        title += ". Наказание: " + String(msg.payload.penalty);
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
    document.querySelectorAll(".chip").forEach((chip) => {
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
        const num = (input) => {
            const raw = input.value.trim();
            if (raw === "")
                return null;
            const parsed = Number(raw);
            return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
        };
        const mins = {};
        const rub = num(minRub);
        const usd = num(minUsd);
        const eur = num(minEur);
        const bits = num(minBits);
        if (rub !== null)
            mins["RUB"] = rub;
        if (usd !== null)
            mins["USD"] = usd;
        if (eur !== null)
            mins["EUR"] = eur;
        if (bits !== null)
            mins["BITS"] = bits;
        const fallback = num(minDefault);
        const body = {
            min_amounts: mins,
            punishments: Desk.splitLines(punishmentsInput.value),
        };
        if (fallback !== null)
            body["default_min"] = fallback;
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
