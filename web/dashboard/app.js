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
    function splitLines(value) {
        return value
            .split("\n")
            .map((part) => part.trim())
            .filter((part) => part.length > 0);
    }
    Tribunal.splitLines = splitLines;
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
// Studio desk: dispatcher, hardware keys, transcript, settings.
(function () {
    function el(id) {
        const node = document.getElementById(id);
        if (!node)
            throw new Error("missing node #" + id);
        return node;
    }
    const stageDot = el("stage-dot");
    const stageLabel = el("stage-label");
    const wsStatusText = el("ws-status-text");
    const btnPanic = el("btn-panic");
    const btnCopyObs = el("btn-copy-obs");
    const customTrialForm = el("custom-trial-form");
    const defendantInput = el("defendant-input");
    const crimeInput = el("crime-input");
    const contextInput = el("context-input");
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
    const canvas = el("audio-visualizer-canvas");
    const peakReadout = el("audio-peak-readout");
    const secretInput = el("secret-input");
    const minRub = el("min-rub");
    const minUsd = el("min-usd");
    const minEur = el("min-eur");
    const minDefault = el("min-default");
    const punishmentsInput = el("punishments-input");
    const settingsForm = el("court-settings-form");
    const settingsStatus = el("settings-status");
    const simForm = el("donate-sim-form");
    const simDonor = el("sim-donor");
    const simAmount = el("sim-amount");
    const simCurrency = el("sim-currency");
    const simMessage = el("sim-message");
    let ws = null;
    let speaking = false;
    const voterId = "desk_user_" + Math.floor(Math.random() * 100000);
    function secret() {
        return secretInput.value.trim();
    }
    function authHeaders() {
        const value = secret();
        return value ? { "X-Tribunal-Secret": value } : {};
    }
    class Visualizer {
        constructor(target) {
            this.target = target;
            this.bars = 36;
            this.phase = 0;
            this.width = 0;
            this.height = 110;
            const view = target.getContext("2d");
            if (!view)
                throw new Error("no 2d context");
            this.view = view;
            this.heights = new Float32Array(this.bars);
            this.caps = new Float32Array(this.bars);
            this.fit();
            window.addEventListener("resize", () => this.fit());
            this.loop();
        }
        fit() {
            const box = this.target.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            this.target.width = box.width * dpr;
            this.target.height = 110 * dpr;
            this.view.setTransform(dpr, 0, 0, dpr, 0, 0);
            this.width = box.width;
            this.height = 110;
        }
        loop() {
            this.render();
            requestAnimationFrame(() => this.loop());
        }
        render() {
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
                if (this.heights[i] > this.caps[i])
                    this.caps[i] = this.heights[i];
                else
                    this.caps[i] = Math.max(0, this.caps[i] - 0.8);
                if (this.heights[i] > peak)
                    peak = this.heights[i];
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
    function logTranscript(speaker, text, role) {
        const now = new Date();
        const pad = (n) => String(n).padStart(2, "0");
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
    function sendAction(action, payload) {
        if (!ws || ws.readyState !== WebSocket.OPEN)
            return;
        const body = { ...payload };
        if (secret() && (action === "start_trial" || action === "panic")) {
            body["secret"] = secret();
        }
        ws.send(JSON.stringify({ action, payload: body }));
    }
    function updateGauge(guilty, innocent, timeLeft) {
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
    function loadSettings() {
        fetch("/api/settings")
            .then((res) => res.json())
            .then((settings) => {
            const mins = settings.min_amounts || {};
            minRub.value = String(mins["RUB"] ?? settings.default_min ?? "");
            minUsd.value = String(mins["USD"] ?? settings.default_min ?? "");
            minEur.value = String(mins["EUR"] ?? settings.default_min ?? "");
            minDefault.value = String(settings.default_min ?? "");
            punishmentsInput.value = (settings.punishments || []).join("\n");
        })
            .catch(() => undefined);
    }
    function connect() {
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
        ws.onmessage = (event) => {
            const msg = Tribunal.parseEvent(event.data);
            if (!msg)
                return;
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
                    }
                    else {
                        stageDot.className = "dot active";
                        stageLabel.textContent = "В ЭФИРЕ";
                        activePhaseBadge.classList.add("active");
                        if (msg.payload.case_title) {
                            activeCaseName.textContent =
                                msg.payload.case_title + " (" + (msg.payload.defendant || "") + ")";
                            logTranscript("СУД", "Открыто заседание по делу: " + msg.payload.case_title + ". Обвинение: " + (msg.payload.charge || ""), "sys");
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
                        if (msg.type === "audio_chunk" && msg.payload.is_last)
                            speaking = false;
                    }, 1500);
                    break;
                case "voting_update":
                    updateGauge(msg.payload.guilty_count, msg.payload.innocent_count, msg.payload.time_left_sec);
                    break;
                case "verdict": {
                    let line = "ИТОГОВЫЙ ПРИГОВОР: " + msg.payload.verdict + ". (Голосов: " + msg.payload.guilty_votes + " из " + msg.payload.total_votes + ")";
                    if (msg.payload.penalty)
                        line += " Наказание: " + msg.payload.penalty;
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
    document.querySelectorAll(".incident-card").forEach((card) => {
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
            if (label)
                label.textContent = "СКОПИРОВАНО!";
            window.setTimeout(() => {
                btnCopyObs.style.background = "#0284c7";
                const restore = btnCopyObs.querySelector("span");
                if (restore)
                    restore.textContent = "OBS ССЫЛКА";
            }, 1500);
        })
            .catch(() => undefined);
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
        if (rub !== null)
            mins["RUB"] = rub;
        if (usd !== null)
            mins["USD"] = usd;
        if (eur !== null)
            mins["EUR"] = eur;
        const fallback = num(minDefault);
        const body = {
            min_amounts: mins,
            punishments: Tribunal.splitLines(punishmentsInput.value),
        };
        if (fallback !== null)
            body["default_min"] = fallback;
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
        if (!Number.isFinite(amount) || amount <= 0)
            return;
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
        }
        else if (event.key === "F9") {
            event.preventDefault();
            const cards = document.querySelectorAll(".incident-card");
            if (cards.length > 0)
                cards[0].click();
        }
    });
    connect();
})();
