"use strict";
var Backdrop;
(function (Backdrop) {
    const COUNT = 200;
    const SPREAD = 10;
    const SPEED = 0.1;
    const BASE_SIZE = 100;
    const CAMERA_DISTANCE = 20;
    const VERTEX = `
    attribute vec3 position;
    attribute vec4 random;
    attribute vec3 color;

    uniform mat4 modelMatrix;
    uniform mat4 viewMatrix;
    uniform mat4 projectionMatrix;
    uniform float uTime;
    uniform float uSpread;
    uniform float uBaseSize;
    uniform float uSizeRandomness;

    varying vec4 vRandom;
    varying vec3 vColor;

    void main() {
      vRandom = random;
      vColor = color;

      vec3 pos = position * uSpread;
      pos.z *= 10.0;

      vec4 mPos = modelMatrix * vec4(pos, 1.0);
      float t = uTime;
      mPos.x += sin(t * random.z + 6.28 * random.w) * mix(0.1, 1.5, random.x);
      mPos.y += sin(t * random.y + 6.28 * random.x) * mix(0.1, 1.5, random.w);
      mPos.z += sin(t * random.w + 6.28 * random.y) * mix(0.1, 1.5, random.z);

      vec4 mvPos = viewMatrix * mPos;

      if (uSizeRandomness == 0.0) {
        gl_PointSize = uBaseSize;
      } else {
        gl_PointSize = (uBaseSize * (1.0 + uSizeRandomness * (random.x - 0.5))) / length(mvPos.xyz);
      }

      gl_Position = projectionMatrix * mvPos;
    }
  `;
    const FRAGMENT = `
    precision highp float;

    uniform float uTime;
    uniform float uAlphaParticles;
    varying vec4 vRandom;
    varying vec3 vColor;

    void main() {
      vec2 uv = gl_PointCoord.xy;
      float d = length(uv - vec2(0.5));

      if (uAlphaParticles < 0.5) {
        if (d > 0.5) {
          discard;
        }
        gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), 1.0);
      } else {
        float circle = smoothstep(0.5, 0.4, d) * 0.8;
        gl_FragColor = vec4(vColor + 0.2 * sin(uv.yxx + uTime + vRandom.y * 6.28), circle);
      }
    }
  `;
    function perspective(fovDeg, aspect, near, far) {
        const f = 1 / Math.tan(((fovDeg * Math.PI) / 180) / 2);
        const out = new Float32Array(16);
        out[0] = f / aspect;
        out[5] = f;
        out[10] = (far + near) / (near - far);
        out[11] = -1;
        out[14] = (2 * far * near) / (near - far);
        return out;
    }
    function multiply(a, b) {
        const out = new Float32Array(16);
        for (let col = 0; col < 4; col++) {
            for (let row = 0; row < 4; row++) {
                out[col * 4 + row] =
                    a[row] * b[col * 4] +
                        a[4 + row] * b[col * 4 + 1] +
                        a[8 + row] * b[col * 4 + 2] +
                        a[12 + row] * b[col * 4 + 3];
            }
        }
        return out;
    }
    function rotationX(angle) {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        return new Float32Array([1, 0, 0, 0, 0, c, s, 0, 0, -s, c, 0, 0, 0, 0, 1]);
    }
    function rotationY(angle) {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        return new Float32Array([c, 0, -s, 0, 0, 1, 0, 0, s, 0, c, 0, 0, 0, 0, 1]);
    }
    function rotationZ(angle) {
        const c = Math.cos(angle);
        const s = Math.sin(angle);
        return new Float32Array([c, s, 0, 0, -s, c, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
    }
    function translation(x, y, z) {
        return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1]);
    }
    function compile(gl, type, source) {
        const shader = gl.createShader(type);
        if (!shader)
            throw new Error("no shader");
        gl.shaderSource(shader, source);
        gl.compileShader(shader);
        if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
            throw new Error("shader: " + gl.getShaderInfoLog(shader));
        }
        return shader;
    }
    function mount(canvas) {
        const maybe = canvas.getContext("webgl", { antialias: true, alpha: false });
        if (!maybe)
            return;
        const gl = maybe;
        const program = gl.createProgram();
        if (!program)
            return;
        gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX));
        gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT));
        gl.linkProgram(program);
        if (!gl.getProgramParameter(program, gl.LINK_STATUS))
            return;
        gl.useProgram(program);
        const dpr = Math.min(window.devicePixelRatio || 1, 2);
        const resize = () => {
            canvas.width = window.innerWidth * dpr;
            canvas.height = window.innerHeight * dpr;
            canvas.style.width = window.innerWidth + "px";
            canvas.style.height = window.innerHeight + "px";
            gl.viewport(0, 0, canvas.width, canvas.height);
        };
        window.addEventListener("resize", resize);
        resize();
        const positions = new Float32Array(COUNT * 3);
        const randoms = new Float32Array(COUNT * 4);
        const colors = new Float32Array(COUNT * 3);
        for (let i = 0; i < COUNT; i++) {
            let x = 0;
            let y = 0;
            let z = 0;
            let len = 0;
            do {
                x = Math.random() * 2 - 1;
                y = Math.random() * 2 - 1;
                z = Math.random() * 2 - 1;
                len = x * x + y * y + z * z;
            } while (len > 1 || len === 0);
            const r = Math.cbrt(Math.random());
            positions.set([x * r, y * r, z * r], i * 3);
            randoms.set([Math.random(), Math.random(), Math.random(), Math.random()], i * 4);
            colors.set([1, 1, 1], i * 3);
        }
        const bindAttribute = (name, size, data) => {
            const buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
            const loc = gl.getAttribLocation(program, name);
            gl.enableVertexAttribArray(loc);
            gl.vertexAttribPointer(loc, size, gl.FLOAT, false, 0, 0);
        };
        bindAttribute("position", 3, positions);
        bindAttribute("random", 4, randoms);
        bindAttribute("color", 3, colors);
        const uniform = (name) => gl.getUniformLocation(program, name);
        const uModel = uniform("modelMatrix");
        const uView = uniform("viewMatrix");
        const uProj = uniform("projectionMatrix");
        const uTime = uniform("uTime");
        const uSpread = uniform("uSpread");
        const uBaseSize = uniform("uBaseSize");
        const uSizeRandomness = uniform("uSizeRandomness");
        const uAlpha = uniform("uAlphaParticles");
        gl.uniform1f(uSpread, SPREAD);
        gl.uniform1f(uBaseSize, BASE_SIZE * dpr);
        gl.uniform1f(uSizeRandomness, 1);
        gl.uniform1f(uAlpha, 0);
        const mouse = { x: 0, y: 0 };
        window.addEventListener("mousemove", (event) => {
            mouse.x = (event.clientX / window.innerWidth) * 2 - 1;
            mouse.y = -((event.clientY / window.innerHeight) * 2 - 1);
        });
        gl.enable(gl.BLEND);
        gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
        gl.clearColor(0x03 / 255, 0x04 / 255, 0x07 / 255, 1);
        const animate = !window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        let raf = 0;
        let running = true;
        let last = performance.now();
        let elapsed = 0;
        let rotZ = 0;
        function frame(now) {
            if (!running)
                return;
            raf = requestAnimationFrame(frame);
            const delta = now - last;
            last = now;
            elapsed += delta * SPEED;
            const aspect = canvas.width / canvas.height;
            gl.uniformMatrix4fv(uProj, false, perspective(15, aspect, 0.1, 100));
            gl.uniformMatrix4fv(uView, false, translation(0, 0, -CAMERA_DISTANCE));
            const rx = Math.sin(elapsed * 0.0002) * 0.1;
            const ry = Math.cos(elapsed * 0.0005) * 0.15;
            rotZ += 0.01 * SPEED;
            let model = multiply(rotationZ(rotZ), rotationY(ry));
            model = multiply(model, rotationX(rx));
            model[12] = -mouse.x;
            model[13] = -mouse.y;
            gl.uniformMatrix4fv(uModel, false, model);
            gl.uniform1f(uTime, elapsed * 0.001);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.POINTS, 0, COUNT);
        }
        function renderOnce() {
            const aspect = canvas.width / canvas.height;
            gl.uniformMatrix4fv(uProj, false, perspective(15, aspect, 0.1, 100));
            gl.uniformMatrix4fv(uView, false, translation(0, 0, -CAMERA_DISTANCE));
            gl.uniformMatrix4fv(uModel, false, multiply(multiply(rotationZ(0), rotationY(0.15)), rotationX(0)));
            gl.uniform1f(uTime, 0);
            gl.clear(gl.COLOR_BUFFER_BIT);
            gl.drawArrays(gl.POINTS, 0, COUNT);
        }
        document.addEventListener("visibilitychange", () => {
            if (document.hidden) {
                running = false;
                cancelAnimationFrame(raf);
            }
            else if (animate && !running) {
                running = true;
                last = performance.now();
                raf = requestAnimationFrame(frame);
            }
        });
        if (animate) {
            raf = requestAnimationFrame(frame);
        }
        else {
            renderOnce();
        }
    }
    Backdrop.mount = mount;
})(Backdrop || (Backdrop = {}));
"use strict";
var GooeyNav;
(function (GooeyNav) {
    const PARTICLE_COUNT = 8;
    const PARTICLE_DISTANCES = [90, 10];
    const PARTICLE_R = 100;
    const ANIMATION_TIME = 600;
    const TIME_VARIANCE = 300;
    const COLORS = [1, 2, 3, 1, 2, 3, 1, 4];
    function noise(n = 1) {
        return n / 2 - Math.random() * n;
    }
    function pointOnCircle(distance, index, total) {
        const angle = ((360 + noise(8)) / total) * index * (Math.PI / 180);
        return [distance * Math.cos(angle), distance * Math.sin(angle)];
    }
    function mount(nav) {
        const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        const list = nav.querySelector("ul");
        if (!list)
            return;
        const items = Array.from(list.querySelectorAll("li"));
        if (items.length === 0)
            return;
        const filter = document.createElement("span");
        filter.className = "effect filter";
        const text = document.createElement("span");
        text.className = "effect text";
        nav.appendChild(filter);
        nav.appendChild(text);
        let activeIndex = Math.max(0, items.findIndex((item) => item.classList.contains("active")));
        function placeEffect(element) {
            const box = nav.getBoundingClientRect();
            const pos = element.getBoundingClientRect();
            const styles = {
                left: pos.x - box.x + "px",
                top: pos.y - box.y + "px",
                width: pos.width + "px",
                height: pos.height + "px",
            };
            Object.assign(filter.style, styles);
            Object.assign(text.style, styles);
            text.innerText = element.innerText;
        }
        function burst(element) {
            if (reduceMotion)
                return;
            const bubbleTime = ANIMATION_TIME * 2 + TIME_VARIANCE;
            element.style.setProperty("--time", bubbleTime + "ms");
            for (let i = 0; i < PARTICLE_COUNT; i++) {
                const duration = ANIMATION_TIME * 2 + noise(TIME_VARIANCE * 2);
                const [sx, sy] = pointOnCircle(PARTICLE_DISTANCES[0], PARTICLE_COUNT - i, PARTICLE_COUNT);
                const [ex, ey] = pointOnCircle(PARTICLE_DISTANCES[1] + noise(7), PARTICLE_COUNT - i, PARTICLE_COUNT);
                let rotate = noise(PARTICLE_R / 10);
                rotate = rotate > 0 ? (rotate + PARTICLE_R / 20) * 10 : (rotate - PARTICLE_R / 20) * 10;
                const color = COLORS[Math.floor(Math.random() * COLORS.length)];
                const scale = 1 + noise(0.2);
                window.setTimeout(() => {
                    const particle = document.createElement("span");
                    particle.className = "particle";
                    particle.style.setProperty("--start-x", sx + "px");
                    particle.style.setProperty("--start-y", sy + "px");
                    particle.style.setProperty("--end-x", ex + "px");
                    particle.style.setProperty("--end-y", ey + "px");
                    particle.style.setProperty("--time", duration + "ms");
                    particle.style.setProperty("--scale", String(scale));
                    particle.style.setProperty("--color", "var(--color-" + color + ", white)");
                    particle.style.setProperty("--rotate", rotate + "deg");
                    const point = document.createElement("span");
                    point.className = "point";
                    particle.appendChild(point);
                    element.appendChild(particle);
                    requestAnimationFrame(() => element.classList.add("active"));
                    window.setTimeout(() => {
                        try {
                            element.removeChild(particle);
                        }
                        catch {
                            /* already gone */
                        }
                    }, duration);
                }, 30);
            }
        }
        function activate(index) {
            if (index === activeIndex)
                return;
            activeIndex = index;
            items.forEach((item, i) => item.classList.toggle("active", i === index));
            const current = items[index];
            placeEffect(current);
            filter.querySelectorAll(".particle").forEach((p) => {
                try {
                    filter.removeChild(p);
                }
                catch {
                    /* already gone */
                }
            });
            text.classList.remove("active");
            void text.offsetWidth;
            text.classList.add("active");
            burst(filter);
        }
        items.forEach((item, index) => {
            const link = item.querySelector("a");
            if (!link)
                return;
            link.addEventListener("click", (event) => {
                const target = link.getAttribute("data-target");
                const href = link.getAttribute("href");
                if (target) {
                    event.preventDefault();
                    activate(index);
                    const node = document.getElementById(target);
                    if (node)
                        node.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
                    return;
                }
                if (href && href !== "#") {
                    event.preventDefault();
                    activate(index);
                    window.setTimeout(() => {
                        window.location.href = href;
                    }, 220);
                }
            });
        });
        placeEffect(items[activeIndex]);
        text.classList.add("active");
        const observer = new ResizeObserver(() => placeEffect(items[activeIndex]));
        observer.observe(nav);
        window.addEventListener("load", () => placeEffect(items[activeIndex]));
        if (document.fonts && document.fonts.ready) {
            document.fonts.ready.then(() => placeEffect(items[activeIndex])).catch(() => undefined);
        }
    }
    GooeyNav.mount = mount;
})(GooeyNav || (GooeyNav = {}));
"use strict";
(function () {
    function el(id) {
        const node = document.getElementById(id);
        if (!node)
            throw new Error("missing node #" + id);
        return node;
    }
    function say(node, text) {
        node.textContent = text;
    }
    const currentState = el("current-state");
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
    function socketUrl(path) {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        return protocol + "//" + location.host + path;
    }
    function connect() {
        ws = new WebSocket(socketUrl("/ws"));
        ws.onmessage = (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            }
            catch {
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
    const backdrop = document.getElementById("bg-canvas");
    if (backdrop && typeof Backdrop !== "undefined")
        Backdrop.mount(backdrop);
    const gooey = document.getElementById("gooey-nav");
    if (gooey && typeof GooeyNav !== "undefined")
        GooeyNav.mount(gooey);
    connect();
    const unbanList = document.getElementById("unban-list");
    function resolveUnban(id, approve) {
        fetch("/api/unban/resolve", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({ id, approve }),
        })
            .then((res) => {
            if (res.ok)
                loadUnban();
        })
            .catch(() => undefined);
    }
    function loadUnban() {
        if (!unbanList)
            return;
        fetch("/api/unban")
            .then((res) => res.json())
            .then((data) => {
            while (unbanList.firstChild)
                unbanList.firstChild.remove();
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
    const poolList = document.getElementById("dock-list");
    const dockStatus = document.getElementById("dock-status");
    const punishStatus = document.getElementById("punish-status");
    const btnDockRandom = document.getElementById("btn-dock-random");
    const btnDockSkip = document.getElementById("btn-dock-skip");
    function dockSay(text) {
        if (dockStatus)
            dockStatus.textContent = text;
    }
    function pickSeat(nick) {
        fetch("/api/dock/pick", {
            method: "POST",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(nick ? { nick } : {}),
        })
            .then((res) => {
            if (res.ok)
                loadDock();
            else
                dockSay("Суд занят или очередь пуста.");
        })
            .catch(() => dockSay("Нет связи с сервером."));
    }
    if (btnDockRandom)
        btnDockRandom.addEventListener("click", () => pickSeat(""));
    if (btnDockSkip) {
        btnDockSkip.addEventListener("click", () => {
            fetch("/api/dock/skip", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: "{}",
            })
                .then(() => loadDock())
                .catch(() => dockSay("Нет связи с сервером."));
        });
    }
    document.querySelectorAll("#punish-row .chip").forEach((chip) => {
        chip.addEventListener("click", () => {
            const kind = chip.getAttribute("data-kind") || "timeout";
            const secs = Number(chip.getAttribute("data-secs") || "90");
            fetch("/api/punish", {
                method: "POST",
                headers: { "Content-Type": "application/json", ...authHeaders() },
                body: JSON.stringify({ kind, secs }),
            })
                .then((res) => res.json())
                .then((data) => {
                const p = data && data.punishment;
                if (punishStatus && p) {
                    punishStatus.textContent = "Кара: " + punishLabel(p);
                }
            })
                .catch(() => undefined);
        });
    });
    function punishLabel(p) {
        switch (p.Kind) {
            case "pardon":
                return "Помилование";
            case "ban":
                return "Бан";
            default:
                return "Мут " + p.Secs + "с";
        }
    }
    function loadDock() {
        if (!poolList)
            return;
        fetch("/api/dock")
            .then((res) => res.json())
            .then((data) => {
            while (poolList.firstChild)
                poolList.firstChild.remove();
            const items = (data && data.pool) || [];
            if (data && data.defendant) {
                const now = document.createElement("li");
                now.textContent = "На скамье: " + data.defendant;
                poolList.appendChild(now);
            }
            if (items.length === 0) {
                const empty = document.createElement("li");
                empty.className = "feed-empty";
                empty.textContent = "Очередь пуста. Ждём !court.";
                poolList.appendChild(empty);
            }
            items.forEach((seat) => {
                const item = document.createElement("li");
                item.textContent = seat.Nick + (seat.Reason ? ": " + seat.Reason : "");
                const take = document.createElement("button");
                take.type = "button";
                take.className = "chip";
                take.textContent = "На скамью";
                take.addEventListener("click", () => pickSeat(seat.Nick));
                item.appendChild(document.createTextNode(" "));
                item.appendChild(take);
                poolList.appendChild(item);
            });
            const p = data && data.punishment;
            if (punishStatus && p) {
                punishStatus.textContent = "Кара: " + punishLabel(p);
            }
        })
            .catch(() => undefined);
    }
    loadDock();
    window.setInterval(loadDock, 3000);
})();
"use strict";
// Invisible defense mic: while the court is in the defense window,
// the dashboard tab listens to the streamer via Web Speech API and
// streams final transcripts to the server. No UI of its own: status
// reuses the existing trial-status footnote when present.
(function () {
    const Impl = window.SpeechRecognition ||
        window.webkitSpeechRecognition;
    let ws = null;
    let rec = null;
    let defending = false;
    let pending = "";
    function status(text) {
        const node = document.getElementById("trial-status");
        if (node)
            node.textContent = text;
    }
    function sendChunk() {
        const text = pending.trim();
        pending = "";
        if (!text || !ws || ws.readyState !== WebSocket.OPEN)
            return;
        ws.send(JSON.stringify({ action: "defense", payload: { author: "стример", text } }));
    }
    function startMic() {
        pending = "";
        if (!Impl)
            return;
        try {
            rec = new Impl();
        }
        catch {
            return;
        }
        rec.lang = "ru-RU";
        rec.continuous = true;
        rec.interimResults = false;
        rec.onresult = (event) => {
            for (let i = event.resultIndex; i < event.results.length; i++) {
                const res = event.results[i];
                if (res.isFinal) {
                    pending += String(res[0].transcript) + " ";
                    sendChunk();
                }
            }
        };
        // Chrome ends sessions on silence: resume while the window is open.
        rec.onend = () => {
            if (defending) {
                try {
                    rec.start();
                }
                catch {
                    /* mic locked, chat quotes cover the defense */
                }
            }
        };
        try {
            rec.start();
        }
        catch {
            rec = null;
            return;
        }
        status("Суд слушает защиту, говорите...");
    }
    function stopMic() {
        defending = false;
        if (rec) {
            try {
                rec.onend = null;
                rec.stop();
            }
            catch {
                /* already stopped */
            }
            rec = null;
        }
        sendChunk();
    }
    function connect() {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        ws = new WebSocket(protocol + "//" + location.host + "/ws");
        ws.onmessage = (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            }
            catch {
                return;
            }
            if (msg.type !== "state_change")
                return;
            const state = String((msg.payload && msg.payload.state) || "idle");
            if (state === "defense" && !defending) {
                defending = true;
                startMic();
            }
            else if (state !== "defense" && defending) {
                stopMic();
            }
        };
        ws.onclose = () => {
            window.setTimeout(connect, 2000);
        };
    }
    connect();
})();
