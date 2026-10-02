(function () {
  function el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error("missing node #" + id);
    return node as T;
  }

  function say(node: HTMLElement, text: string): void {
    node.textContent = text;
  }

  const currentState = el("current-state");
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

  function socketUrl(path: string): string {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return protocol + "//" + location.host + path;
  }

  function connect(): void {
    ws = new WebSocket(socketUrl("/ws"));
    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: { type?: string; payload?: { state?: string } };
      try {
        msg = JSON.parse(event.data) as typeof msg;
      } catch {
        return;
      }
      if (msg.type === "state_change") {
        const state = String((msg.payload && msg.payload.state) || "idle");
        currentState.textContent = state.toUpperCase();
        currentState.classList.toggle("active", state !== "idle");
      }
    };
    ws.onclose = () => {
      window.setTimeout(connect, 2000);
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
      say(donateStatus, "Сумма должна быть больше нуля.");
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
        say(donateStatus, res.ok ? "Тестовый донат отправлен." : "Ошибка: проверьте секретный ключ.");
      })
      .catch(() => {
        say(donateStatus, "Нет связи с сервером.");
      });
  });

  const backdrop = document.getElementById("bg-canvas") as HTMLCanvasElement | null;
  if (backdrop && typeof Backdrop !== "undefined") Backdrop.mount(backdrop);
  const gooey = document.getElementById("gooey-nav");
  if (gooey && typeof GooeyNav !== "undefined") GooeyNav.mount(gooey);
  connect();

  interface UnbanRequest {
    ID: string;
    UserID: string;
    UserLogin: string;
    UserName: string;
    Text: string;
    CreatedAt: string;
  }

  const unbanList = document.getElementById("unban-list");

  function resolveUnban(id: string, approve: boolean): void {
    fetch("/api/unban/resolve", {
      method: "POST",
      headers: { "Content-Type": "application/json", ...authHeaders() },
      body: JSON.stringify({ id, approve }),
    })
      .then((res) => {
        if (res.ok) loadUnban();
      })
      .catch(() => undefined);
  }

  function loadUnban(): void {
    if (!unbanList) return;
    fetch("/api/unban")
      .then((res) => res.json())
      .then((data: { requests?: UnbanRequest[] }) => {
        while (unbanList.firstChild) unbanList.firstChild.remove();
        const items = (data && data.requests) || [];
        if (items.length === 0) {
          const empty = document.createElement("li");
          empty.className = "feed-empty";
          empty.textContent = "Заявок нет. Нужен токен модератора в конфиге.";
          unbanList.appendChild(empty);
          return;
        }
        items.forEach((req) => {
          const item = document.createElement("li");
          const name = document.createElement("strong");
          name.textContent = req.UserName || req.UserLogin || req.UserID;
          item.appendChild(name);
          item.appendChild(document.createTextNode(": " + (req.Text || "без текста")));
          const row = document.createElement("div");
          row.className = "presets";
          const pardon = document.createElement("button");
          pardon.type = "button";
          pardon.className = "chip";
          pardon.textContent = "Помиловать";
          pardon.addEventListener("click", () => resolveUnban(req.ID, true));
          const punish = document.createElement("button");
          punish.type = "button";
          punish.className = "chip";
          punish.textContent = "Казнить";
          punish.addEventListener("click", () => resolveUnban(req.ID, false));
          row.appendChild(pardon);
          row.appendChild(punish);
          item.appendChild(row);
          unbanList.appendChild(item);
        });
      })
      .catch(() => undefined);
  }

  loadUnban();
  window.setInterval(loadUnban, 30000);
})();
