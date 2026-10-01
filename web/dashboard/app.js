"use strict";
// Shared wire protocol, inlined per page so each bundle stays dependency-free.
var Tribunal;
(function (Tribunal) {
    function socketUrl(path) {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        return protocol + "//" + location.host + path;
    }
    Tribunal.socketUrl = socketUrl;
    function parseEvent(raw) {
        try {
            return JSON.parse(raw);
        }
        catch {
            return null;
        }
    }
    Tribunal.parseEvent = parseEvent;
    function splitList(value) {
        return value
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0);
    }
    Tribunal.splitList = splitList;
    function joinList(items) {
        return Array.isArray(items) ? items.join(", ") : "";
    }
    Tribunal.joinList = joinList;
})(Tribunal || (Tribunal = {}));
// Tribunal control desk: trial, memory, portrait and OBS views over one socket.
(function () {
    function el(id) {
        const node = document.getElementById(id);
        if (!node)
            throw new Error("missing node #" + id);
        return node;
    }
    const wsDot = el("ws-dot");
    const wsLabel = el("ws-label");
    const trialForm = el("trial-form");
    const defendantInput = el("defendant-input");
    const crimeInput = el("crime-input");
    const contextInput = el("context-input");
    const currentState = el("current-state");
    const activeCaseTitle = el("active-case-title");
    const statGuilty = el("stat-guilty");
    const statInnocent = el("stat-innocent");
    const btnVoteGuilty = el("btn-vote-guilty");
    const btnVoteInnocent = el("btn-vote-innocent");
    const btnPanic = el("btn-panic");
    const btnCopyUrl = el("btn-copy-url");
    const obsUrlInput = el("obs-url-input");
    const secretInput = el("secret-input");
    const profileForm = el("profile-form");
    const profileName = el("profile-name");
    const profileTitles = el("profile-titles");
    const profileTraits = el("profile-traits");
    const profileGags = el("profile-gags");
    const profileMercy = el("profile-mercy");
    const profileStatus = el("profile-status");
    const historyTrials = el("history-trials");
    const historyTop = el("history-top");
    let ws = null;
    const voterId = "local_user_" + Math.floor(Math.random() * 100000);
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
    function showView(name) {
        document.querySelectorAll(".desk-view").forEach((view) => {
            view.classList.toggle("hidden", view.dataset["view"] !== name);
        });
        document.querySelectorAll(".tab-btn").forEach((tab) => {
            tab.classList.toggle("active", tab.dataset["tab"] === name);
        });
    }
    function loadProfile() {
        fetch("/api/profile")
            .then((res) => res.json())
            .then((profile) => {
            profileName.value = profile.name || "";
            profileTitles.value = Tribunal.joinList(profile.titles);
            profileTraits.value = Tribunal.joinList(profile.traits);
            profileGags.value = Tribunal.joinList(profile.running_gags);
            profileMercy.value = profile.mercy || "";
        })
            .catch(() => undefined);
    }
    function loadHistory() {
        fetch("/api/history")
            .then((res) => res.json())
            .then((data) => {
            historyTrials.innerHTML = "";
            const trials = data.trials || [];
            if (trials.length === 0) {
                historyTrials.innerHTML = '<li class="history-empty">Пока пусто, проведите первый суд.</li>';
            }
            trials
                .slice()
                .reverse()
                .forEach((trial) => {
                const item = document.createElement("li");
                item.textContent =
                    trial.defendant + ": " + trial.crime + " = " + trial.verdict + " (" + trial.guilty + "-" + trial.innocent + ")";
                historyTrials.appendChild(item);
            });
            historyTop.innerHTML = "";
            const top = data.top || [];
            if (top.length === 0) {
                historyTop.innerHTML = '<li class="history-empty">Пока никто не отличился.</li>';
            }
            top.forEach((person) => {
                const item = document.createElement("li");
                item.textContent = person.name + ": !sue " + person.sue_calls + ", голосов " + person.votes;
                historyTop.appendChild(item);
            });
        })
            .catch(() => undefined);
    }
    function connect() {
        ws = new WebSocket(Tribunal.socketUrl("/ws"));
        ws.onopen = () => {
            wsDot.className = "dot connected";
            wsLabel.textContent = "Подключено к серверу";
            loadProfile();
            loadHistory();
        };
        ws.onclose = () => {
            wsDot.className = "dot disconnected";
            wsLabel.textContent = "Переподключение...";
            window.setTimeout(connect, 2000);
        };
        ws.onmessage = (event) => {
            const msg = Tribunal.parseEvent(event.data);
            if (!msg)
                return;
            if (msg.type === "state_change") {
                const state = msg.payload.state || "idle";
                currentState.textContent = state.toUpperCase();
                if (state === "idle") {
                    currentState.className = "state-badge";
                    activeCaseTitle.textContent = "Нет активного дела";
                    statGuilty.textContent = "0";
                    statInnocent.textContent = "0";
                }
                else {
                    currentState.className = "state-badge active";
                    if (msg.payload.case_title) {
                        activeCaseTitle.textContent = msg.payload.case_title + " (" + (msg.payload.defendant || "") + ")";
                    }
                }
            }
            else if (msg.type === "voting_update") {
                statGuilty.textContent = String(msg.payload.guilty_count);
                statInnocent.textContent = String(msg.payload.innocent_count);
            }
            else if (msg.type === "verdict") {
                activeCaseTitle.textContent = "Вердикт: " + msg.payload.verdict;
                loadHistory();
            }
            else if (msg.type === "panic") {
                currentState.textContent = "СБРОШЕНО";
                currentState.className = "state-badge";
            }
        };
    }
    document.querySelectorAll(".tab-btn").forEach((tab) => {
        tab.addEventListener("click", () => showView(tab.dataset["tab"] || "trial"));
    });
    trialForm.addEventListener("submit", (event) => {
        event.preventDefault();
        sendAction("start_trial", {
            defendant: defendantInput.value.trim(),
            crime: crimeInput.value.trim(),
            context: contextInput.value.trim(),
        });
    });
    btnPanic.addEventListener("click", () => sendAction("panic", {}));
    window.addEventListener("keydown", (event) => {
        if (event.key === "F12") {
            event.preventDefault();
            sendAction("panic", {});
        }
    });
    document.querySelectorAll(".btn-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
            crimeInput.value = chip.getAttribute("data-crime") || "";
        });
    });
    btnVoteGuilty.addEventListener("click", () => sendAction("vote", { voter: voterId, is_guilty: true }));
    btnVoteInnocent.addEventListener("click", () => sendAction("vote", { voter: voterId, is_guilty: false }));
    profileForm.addEventListener("submit", (event) => {
        event.preventDefault();
        fetch("/api/profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
                name: profileName.value.trim(),
                titles: Tribunal.splitList(profileTitles.value),
                traits: Tribunal.splitList(profileTraits.value),
                running_gags: Tribunal.splitList(profileGags.value),
                mercy: profileMercy.value.trim(),
            }),
        })
            .then((res) => {
            profileStatus.textContent = res.ok ? "Сохранено, суд запомнил." : "Не сохранено: проверьте секрет.";
        })
            .catch(() => {
            profileStatus.textContent = "Нет связи с сервером.";
        });
    });
    btnCopyUrl.addEventListener("click", () => {
        obsUrlInput.select();
        navigator.clipboard
            .writeText(obsUrlInput.value)
            .then(() => {
            btnCopyUrl.textContent = "Скопировано!";
            window.setTimeout(() => (btnCopyUrl.textContent = "Копировать"), 2000);
        })
            .catch(() => undefined);
    });
    showView("trial");
    connect();
})();
