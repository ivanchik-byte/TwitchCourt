(function() {
  const wsDot = document.getElementById("ws-dot");
  const wsLabel = document.getElementById("ws-label");
  const btnPanic = document.getElementById("btn-panic");
  const trialForm = document.getElementById("trial-form");
  const defendantInput = document.getElementById("defendant-input");
  const crimeInput = document.getElementById("crime-input");
  const contextInput = document.getElementById("context-input");
  const currentState = document.getElementById("current-state");
  const activeCaseTitle = document.getElementById("active-case-title");
  const statGuilty = document.getElementById("stat-guilty");
  const statInnocent = document.getElementById("stat-innocent");
  const btnVoteGuilty = document.getElementById("btn-vote-guilty");
  const btnVoteInnocent = document.getElementById("btn-vote-innocent");
  const btnCopyUrl = document.getElementById("btn-copy-url");
  const obsUrlInput = document.getElementById("obs-url-input");
  const secretInput = document.getElementById("secret-input");
  const profileForm = document.getElementById("profile-form");
  const profileName = document.getElementById("profile-name");
  const profileTitles = document.getElementById("profile-titles");
  const profileTraits = document.getElementById("profile-traits");
  const profileGags = document.getElementById("profile-gags");
  const profileMercy = document.getElementById("profile-mercy");
  const profileStatus = document.getElementById("profile-status");
  const historyTrials = document.getElementById("history-trials");
  const historyTop = document.getElementById("history-top");

  let ws = null;
  const voterId = "local_user_" + Math.floor(Math.random() * 100000);

  function secret() {
    return secretInput ? secretInput.value.trim() : "";
  }

  function authHeaders() {
    const s = secret();
    return s ? { "X-Tribunal-Secret": s } : {};
  }

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host + "/ws");

    ws.onopen = () => {
      wsDot.className = "dot connected";
      wsLabel.textContent = "Подключено к серверу";
      loadProfile();
      loadHistory();
    };

    ws.onclose = () => {
      wsDot.className = "dot disconnected";
      wsLabel.textContent = "Переподключение...";
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
    const body = payload || {};
    if (secret() && (action === "start_trial" || action === "panic")) {
      body.secret = secret();
    }
    ws.send(JSON.stringify({ action: action, payload: body }));
  }

  function splitList(value) {
    return value.split(",").map((s) => s.trim()).filter((s) => s.length > 0);
  }

  function joinList(arr) {
    return Array.isArray(arr) ? arr.join(", ") : "";
  }

  function loadProfile() {
    fetch("/api/profile").then((r) => r.json()).then((p) => {
      profileName.value = p.name || "";
      profileTitles.value = joinList(p.titles);
      profileTraits.value = joinList(p.traits);
      profileGags.value = joinList(p.running_gags);
      profileMercy.value = p.mercy || "";
    }).catch(() => {});
  }

  function loadHistory() {
    fetch("/api/history").then((r) => r.json()).then((h) => {
      const trials = h.trials || [];
      historyTrials.innerHTML = "";
      if (trials.length === 0) {
        historyTrials.innerHTML = '<li class="history-empty">Пока пусто, проведите первый суд.</li>';
      }
      trials.slice().reverse().forEach((t) => {
        const li = document.createElement("li");
        li.textContent = t.defendant + ": " + t.crime + " = " + t.verdict + " (" + t.guilty + "-" + t.innocent + ")";
        historyTrials.appendChild(li);
      });
      const top = h.top || [];
      historyTop.innerHTML = "";
      if (top.length === 0) {
        historyTop.innerHTML = '<li class="history-empty">Пока никто не отличился.</li>';
      }
      top.forEach((p) => {
        const li = document.createElement("li");
        li.textContent = p.name + ": !sue " + p.sue_calls + ", голосов " + p.votes;
        historyTop.appendChild(li);
      });
    }).catch(() => {});
  }

  function handleServerEvent(msg) {
    switch (msg.type) {
      case "state_change":
        const st = msg.payload.state || "idle";
        currentState.textContent = st.toUpperCase();
        if (st === "idle") {
          currentState.className = "state-badge";
          activeCaseTitle.textContent = "Нет активного дела";
          statGuilty.textContent = "0";
          statInnocent.textContent = "0";
        } else {
          currentState.className = "state-badge active";
          if (msg.payload.case_title) {
            activeCaseTitle.textContent = msg.payload.case_title + " (" + (msg.payload.defendant || "") + ")";
          }
        }
        break;

      case "voting_update":
        statGuilty.textContent = msg.payload.guilty_count;
        statInnocent.textContent = msg.payload.innocent_count;
        break;

      case "verdict":
        activeCaseTitle.textContent = "Вердикт: " + msg.payload.verdict;
        loadHistory();
        break;

      case "panic":
        currentState.textContent = "СБРОШЕНО";
        currentState.className = "state-badge";
        break;
    }
  }

  trialForm.addEventListener("submit", (e) => {
    e.preventDefault();
    sendAction("start_trial", {
      defendant: defendantInput.value.trim(),
      crime: crimeInput.value.trim(),
      context: contextInput.value.trim()
    });
  });

  btnPanic.addEventListener("click", () => {
    sendAction("panic", {});
  });

  window.addEventListener("keydown", (e) => {
    if (e.key === "F12") {
      e.preventDefault();
      sendAction("panic", {});
    }
  });

  document.querySelectorAll(".btn-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      crimeInput.value = chip.getAttribute("data-crime");
    });
  });

  btnVoteGuilty.addEventListener("click", () => {
    sendAction("vote", { voter: voterId, is_guilty: true });
  });

  btnVoteInnocent.addEventListener("click", () => {
    sendAction("vote", { voter: voterId, is_guilty: false });
  });

  profileForm.addEventListener("submit", (e) => {
    e.preventDefault();
    fetch("/api/profile", {
      method: "PUT",
      headers: Object.assign({ "Content-Type": "application/json" }, authHeaders()),
      body: JSON.stringify({
        name: profileName.value.trim(),
        titles: splitList(profileTitles.value),
        traits: splitList(profileTraits.value),
        running_gags: splitList(profileGags.value),
        mercy: profileMercy.value.trim()
      })
    }).then((r) => {
      profileStatus.textContent = r.ok ? "Сохранено, суд запомнил." : "Не сохранено: проверьте секрет.";
    }).catch(() => {
      profileStatus.textContent = "Нет связи с сервером.";
    });
  });

  btnCopyUrl.addEventListener("click", () => {    obsUrlInput.select();
    navigator.clipboard.writeText(obsUrlInput.value).then(() => {
      btnCopyUrl.textContent = "Скопировано!";
      setTimeout(() => {
        btnCopyUrl.textContent = "Копировать";
      }, 2000);
    });
  });

  connect();
})();
