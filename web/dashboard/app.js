(function() {
  const stageDot = document.getElementById("stage-dot");
  const stageLabel = document.getElementById("stage-label");
  const wsStatusText = document.getElementById("ws-status-text");
  const btnPanic = document.getElementById("btn-panic");
  const btnCopyObs = document.getElementById("btn-copy-obs");
  const obsHiddenUrl = document.getElementById("obs-hidden-url");

  const customTrialForm = document.getElementById("custom-trial-form");
  const defendantInput = document.getElementById("defendant-input");
  const crimeInput = document.getElementById("crime-input");
  const contextInput = document.getElementById("context-input");
  const quickCommandInput = document.getElementById("quick-command-input");

  const activeCaseName = document.getElementById("active-case-name");
  const activePhaseBadge = document.getElementById("active-phase-badge");
  const transcriptFeed = document.getElementById("transcript-feed");
  const btnClearTranscript = document.getElementById("btn-clear-transcript");

  const gaugeGuiltyPct = document.getElementById("gauge-guilty-pct");
  const gaugeGuiltyVotes = document.getElementById("gauge-guilty-votes");
  const gaugeInnocentPct = document.getElementById("gauge-innocent-pct");
  const gaugeInnocentVotes = document.getElementById("gauge-innocent-votes");
  const gaugeTimer = document.getElementById("gauge-timer");
  const gaugeFillGuilty = document.getElementById("gauge-fill-guilty");
  const gaugeFillInnocent = document.getElementById("gauge-fill-innocent");

  const keyObjection = document.getElementById("key-objection");
  const keySlam = document.getElementById("key-slam");
  const keyVerdict = document.getElementById("key-verdict");
  const keyReset = document.getElementById("key-reset");
  const btnVoteGuilty = document.getElementById("btn-vote-guilty");
  const btnVoteInnocent = document.getElementById("btn-vote-innocent");

  const canvas = document.getElementById("audio-visualizer-canvas");
  const peakReadout = document.getElementById("audio-peak-readout");

  let ws = null;
  let pingStart = 0;
  let isSpeaking = false;

  class AudioVisualizer {
    constructor(canvasElem) {
      this.canvas = canvasElem;
      this.ctx = canvasElem.getContext("2d");
      this.numBars = 36;
      this.barHeights = new Float32Array(this.numBars);
      this.peakCaps = new Float32Array(this.numBars);
      this.phase = 0;
      this.initSize();
      window.addEventListener("resize", () => this.initSize());
      this.animate();
    }

    initSize() {
      const rect = this.canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      this.canvas.width = rect.width * dpr;
      this.canvas.height = 110 * dpr;
      this.ctx.scale(dpr, dpr);
      this.w = rect.width;
      this.h = 110;
    }

    animate() {
      this.render();
      requestAnimationFrame(() => this.animate());
    }

    render() {
      this.phase += 0.08;
      const ctx = this.ctx;
      ctx.clearRect(0, 0, this.w, this.h);

      ctx.strokeStyle = "rgba(255, 255, 255, 0.04)";
      ctx.lineWidth = 1;
      for (let y = 25; y < this.h; y += 25) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(this.w, y);
        ctx.stroke();
      }

      const barWidth = (this.w - (this.numBars - 1) * 3) / this.numBars;
      const grad = ctx.createLinearGradient(0, this.h, 0, 0);
      grad.addColorStop(0, "#3b170b");
      grad.addColorStop(0.4, "#f59e0b");
      grad.addColorStop(0.85, "#dc2626");
      grad.addColorStop(1, "#f87171");

      const cadence = isSpeaking ? (Math.sin(this.phase * 0.7) * 0.5 + 0.5) : 0.08;
      let maxPeak = 0;

      for (let i = 0; i < this.numBars; i++) {
        const target = (Math.sin(i * 0.28 + this.phase * 1.5) * 0.5 + 0.5) * (this.h - 18) * cadence;
        this.barHeights[i] += (target - this.barHeights[i]) * 0.35;

        if (this.barHeights[i] > this.peakCaps[i]) {
          this.peakCaps[i] = this.barHeights[i];
        } else {
          this.peakCaps[i] = Math.max(0, this.peakCaps[i] - 0.8);
        }

        if (this.barHeights[i] > maxPeak) maxPeak = this.barHeights[i];

        const x = i * (barWidth + 3);
        const y = this.h - this.barHeights[i];

        ctx.fillStyle = grad;
        ctx.fillRect(x, y, barWidth, this.barHeights[i]);

        const capY = this.h - this.peakCaps[i] - 2;
        ctx.fillStyle = this.peakCaps[i] > this.h * 0.7 ? "#ef4444" : "#fbbf24";
        ctx.fillRect(x, Math.max(2, capY), barWidth, 2);
      }

      const dbVal = isSpeaking ? (-3.2 - Math.random() * 4).toFixed(1) : "-∞";
      peakReadout.textContent = `${dbVal} dBFS [${isSpeaking ? "ACTIVE" : "IDLE"}]`;
    }
  }

  const visualizer = new AudioVisualizer(canvas);

  function logTranscript(speaker, text, roleClass) {
    const now = new Date();
    const timeStr = "[" + String(now.getHours()).padStart(2, "0") + ":" +
                          String(now.getMinutes()).padStart(2, "0") + ":" +
                          String(now.getSeconds()).padStart(2, "0") + "]";

    const line = document.createElement("div");
    line.className = "feed-line";

    const ts = document.createElement("span");
    ts.className = "time-stamp";
    ts.textContent = timeStr + " ";

    const spk = document.createElement("span");
    spk.className = "speaker-tag " + (roleClass || "sys");
    spk.textContent = speaker + ": ";

    const txt = document.createElement("span");
    txt.className = "line-text";
    txt.textContent = text;

    line.appendChild(ts);
    line.appendChild(spk);
    line.appendChild(txt);

    transcriptFeed.appendChild(line);
    transcriptFeed.scrollTop = transcriptFeed.scrollHeight;
  }

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host + "/ws");

    ws.onopen = () => {
      wsStatusText.textContent = "WS: 12ms";
      logTranscript("СИСТЕМА", "Связь со студийным ядром Go установлена.", "sys");
    };

    ws.onclose = () => {
      wsStatusText.textContent = "WS: ОФФЛАЙН";
      stageDot.className = "dot idle";
      stageLabel.textContent = "РАЗРЫВ";
      setTimeout(connect, 2000);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        handleServerEvent(msg);
      } catch (err) {}
    };
  }

  function sendAction(action, payload) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ action: action, payload: payload }));
  }

  function handleServerEvent(msg) {
    switch (msg.type) {
      case "state_change":
        const st = msg.payload.state || "idle";
        activePhaseBadge.textContent = st.toUpperCase();
        if (st === "idle") {
          stageDot.className = "dot idle";
          stageLabel.textContent = "ОЖИДАНИЕ";
          activePhaseBadge.classList.remove("active");
          activeCaseName.textContent = "Нет активного слушания";
          isSpeaking = false;
        } else {
          stageDot.className = "dot active";
          stageLabel.textContent = "В ЭФИРЕ";
          activePhaseBadge.classList.add("active");
          if (msg.payload.case_title) {
            activeCaseName.textContent = msg.payload.case_title + " (" + (msg.payload.defendant || "") + ")";
            logTranscript("СУД", `Открыто заседание по делу: ${msg.payload.case_title}. Обвинение: ${msg.payload.charge || ""}`, "sys");
          }
        }
        break;

      case "subtitles":
        if (msg.payload.text) {
          isSpeaking = true;
          logTranscript(msg.payload.speaker || "ПРОКУРОР", msg.payload.text, "prosecutor");
          setTimeout(() => { isSpeaking = false; }, 3000);
        }
        break;

      case "audio_chunk":
        isSpeaking = true;
        setTimeout(() => {
          if (msg.payload.is_last) isSpeaking = false;
        }, 1500);
        break;

      case "voting_update":
        updateVotingGauge(msg.payload.guilty_count, msg.payload.innocent_count, msg.payload.time_left_sec);
        break;

      case "verdict":
        logTranscript("ВЕРДИКТ", `ИТОГОВЫЙ ПРИГОВОР: ${msg.payload.verdict}. (Голосов: ${msg.payload.guilty_votes} из ${msg.payload.total_votes})`, "verdict");
        break;

      case "panic":
        stageDot.className = "dot idle";
        stageLabel.textContent = "СБРОШЕНО";
        activePhaseBadge.textContent = "MUTED";
        activePhaseBadge.classList.remove("active");
        isSpeaking = false;
        logTranscript("СИСТЕМА", "Экстренный сброс сцены! Звук и оверлей заглушены.", "sys");
        break;
    }
  }

  function updateVotingGauge(guilty, innocent, timeLeft) {
    gaugeGuiltyVotes.textContent = `(${guilty} голосов)`;
    gaugeInnocentVotes.textContent = `(${innocent} голосов)`;

    const total = guilty + innocent;
    let gPct = 50;
    if (total > 0) {
      gPct = Math.round((guilty / total) * 100);
    }
    const iPct = 100 - gPct;

    gaugeGuiltyPct.textContent = gPct + "%";
    gaugeInnocentPct.textContent = iPct + "%";
    gaugeFillGuilty.style.width = gPct + "%";
    gaugeFillInnocent.style.width = iPct + "%";

    const secStr = String(timeLeft).padStart(2, "0");
    gaugeTimer.textContent = `00:${secStr}`;
  }

  customTrialForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendAction("start_trial", {
      defendant: defendantInput.value.trim(),
      crime: crimeInput.value.trim(),
      context: contextInput.value.trim()
    });
  });

  document.querySelectorAll(".incident-card").forEach((card) => {
    card.addEventListener("click", () => {
      sendAction("start_trial", {
        defendant: card.getAttribute("data-defendant"),
        crime: card.getAttribute("data-crime"),
        context: card.getAttribute("data-context")
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

  keyReset.addEventListener("click", () => {
    sendAction("panic", {});
  });

  btnPanic.addEventListener("click", () => {
    sendAction("panic", {});
  });

  btnVoteGuilty.addEventListener("click", () => {
    const voter = "sim_user_" + Math.floor(Math.random() * 9999);
    sendAction("vote", { voter: voter, is_guilty: true });
  });

  btnVoteInnocent.addEventListener("click", () => {
    const voter = "sim_user_" + Math.floor(Math.random() * 9999);
    sendAction("vote", { voter: voter, is_guilty: false });
  });

  btnClearTranscript.addEventListener("click", () => {
    transcriptFeed.innerHTML = "";
    logTranscript("СИСТЕМА", "Журнал стенограммы очищен.", "sys");
  });

  btnCopyObs.addEventListener("click", () => {
    navigator.clipboard.writeText("http://localhost:7890/overlay").then(() => {
      btnCopyObs.style.background = "#10b981";
      btnCopyObs.querySelector("span").textContent = "СКОПИРОВАНО!";
      setTimeout(() => {
        btnCopyObs.style.background = "#0284c7";
        btnCopyObs.querySelector("span").textContent = "OBS ССЫЛКА";
      }, 1500);
    });
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "F12") {
      e.preventDefault();
      sendAction("panic", {});
    } else if (e.key === "F9") {
      e.preventDefault();
      const cards = document.querySelectorAll(".incident-card");
      if (cards.length > 0) {
        cards[0].click();
      }
    }
  });

  connect();
})();
