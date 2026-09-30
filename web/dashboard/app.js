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

  let ws = null;

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    ws = new WebSocket(protocol + "//" + location.host + "/ws");

    ws.onopen = () => {
      wsDot.className = "dot connected";
      wsLabel.textContent = "Подключено к серверу";
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
    ws.send(JSON.stringify({ action: action, payload: payload }));
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
    const voterId = "local_user_" + Math.floor(Math.random() * 100000);
    sendAction("vote", { voter: voterId, is_guilty: true });
  });

  btnVoteInnocent.addEventListener("click", () => {
    const voterId = "local_user_" + Math.floor(Math.random() * 100000);
    sendAction("vote", { voter: voterId, is_guilty: false });
  });

  btnCopyUrl.addEventListener("click", () => {
    obsUrlInput.select();
    navigator.clipboard.writeText(obsUrlInput.value).then(() => {
      btnCopyUrl.textContent = "Скопировано!";
      setTimeout(() => {
        btnCopyUrl.textContent = "Копировать";
      }, 2000);
    });
  });

  connect();
})();
