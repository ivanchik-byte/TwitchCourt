"use strict";
// Particles backdrop: vanilla WebGL port of the rotating particle sphere.
// Fullscreen canvas behind the desk, hover drift, zero dependencies.
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
// GooeyNav port: sticky pill nav with gooey blob + bubble particles.
// Vanilla, no dependencies. Items scroll to page sections (stub content).
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
// Страница настроек: пороги донатов, наказания, портрет. Без сокетов.
var Settings;
(function (Settings) {
    function splitLines(value) {
        return value
            .split("\n")
            .map((part) => part.trim())
            .filter((part) => part.length > 0);
    }
    Settings.splitLines = splitLines;
    function splitList(value) {
        return value
            .split(",")
            .map((part) => part.trim())
            .filter((part) => part.length > 0);
    }
    Settings.splitList = splitList;
    function joinList(items) {
        return Array.isArray(items) ? items.join(", ") : "";
    }
    Settings.joinList = joinList;
})(Settings || (Settings = {}));
(function () {
    function el(id) {
        const node = document.getElementById(id);
        if (!node)
            throw new Error("missing node #" + id);
        return node;
    }
    const srvDot = el("srv-dot");
    const srvLabel = el("srv-label");
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
    function say(node, text) {
        node.textContent = text;
    }
    function num(input) {
        const raw = input.value.trim();
        if (raw === "")
            return null;
        const parsed = Number(raw);
        return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
    }
    fetch("/api/status")
        .then((res) => {
        if (!res.ok)
            throw new Error("down");
        srvDot.className = "dot connected";
        say(srvLabel, "На связи");
    })
        .catch(() => {
        srvDot.className = "dot disconnected";
        say(srvLabel, "Нет связи");
    });
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
        .then((profile) => {
        profileName.value = profile.name || "";
        profileTitles.value = Settings.joinList(profile.titles);
        profileTraits.value = Settings.joinList(profile.traits);
        profileGags.value = Settings.joinList(profile.running_gags);
        profileMercy.value = profile.mercy || "";
    })
        .catch(() => undefined);
    settingsForm.addEventListener("submit", (event) => {
        event.preventDefault();
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
            punishments: Settings.splitLines(punishmentsInput.value),
        };
        if (fallback !== null)
            body["default_min"] = fallback;
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
    const nickInput = el("mc-nick-input");
    const btnAddNick = el("mc-btn-add-nick");
    const btnAddStreamer = el("mc-btn-add-streamer");
    const nicksCounter = el("mc-nicks-counter");
    const cardNicksMeta = el("mc-meta-nicks");
    const logPathInput = el("mc-log-path-input");
    const btnAutodetect = el("mc-btn-autodetect");
    const pathStatus = el("mc-path-status");
    const detectNote = el("mc-detect-note");
    const cardPathMeta = el("mc-meta-path");
    const cardBadge = el("mc-card-badge");
    const btnTestTrial = el("mc-btn-test-trial");
    const testStatus = el("mc-test-status");
    let mcNicks = [];
    try {
        const rawNicks = localStorage.getItem("st_mc_nicks");
        if (rawNicks) {
            const parsed = JSON.parse(rawNicks);
            if (Array.isArray(parsed))
                mcNicks = parsed;
        }
    }
    catch { }
    try {
        const savedPath = localStorage.getItem("st_mc_path");
        if (savedPath) {
            logPathInput.value = savedPath;
        }
    }
    catch { }
    function renderNickTags() {
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
                }
                catch { }
                renderNickTags();
            });
            chip.appendChild(removeBtn);
            tagCloud.appendChild(chip);
        });
    }
    function addNick(nick) {
        const trimmed = nick.trim();
        if (!trimmed)
            return;
        if (!mcNicks.includes(trimmed)) {
            mcNicks.push(trimmed);
            try {
                localStorage.setItem("st_mc_nicks", JSON.stringify(mcNicks));
            }
            catch { }
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
    function updatePathStatus(path, found) {
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
        }
        else {
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
            .then((data) => {
            if (data.path) {
                logPathInput.value = data.path;
                try {
                    localStorage.setItem("st_mc_path", data.path);
                }
                catch { }
                updatePathStatus(data.path, !!data.found);
                if (data.found) {
                    detectNote.textContent = "Лог найден: " + data.path;
                    detectNote.className = "modal-note note-ok";
                }
                else {
                    detectNote.textContent = "Предложен путь: " + data.path + " (создастся при запуске)";
                    detectNote.className = "modal-note";
                }
            }
            else {
                detectNote.textContent = "Стандартный путь не найден. Выбери шаблон или укажи вручную.";
                detectNote.className = "modal-note note-err";
            }
        })
            .catch(() => {
            detectNote.textContent = "Ошибка связи с сервером при автопоиске.";
            detectNote.className = "modal-note note-err";
        });
    });
    document.querySelectorAll(".btn-preset").forEach((btn) => {
        btn.addEventListener("click", () => {
            const presetPath = btn.getAttribute("data-path");
            if (presetPath) {
                logPathInput.value = presetPath;
                try {
                    localStorage.setItem("st_mc_path", presetPath);
                }
                catch { }
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
            }
            else {
                testStatus.textContent = "Суд занят или уже идет другое дело.";
            }
        })
            .catch(() => {
            testStatus.textContent = "Нет связи с сервером.";
        });
    });
    function openMinecraftModal(syncHash = true) {
        modalMinecraft.classList.remove("hidden");
        cardMinecraft.setAttribute("aria-expanded", "true");
        try {
            localStorage.setItem("st_mc_modal", "open");
        }
        catch { }
        if (syncHash && window.location.hash !== "#/games/minecraft") {
            window.history.replaceState(null, "", "#/games/minecraft");
        }
    }
    function closeMinecraftModal(syncHash = true) {
        modalMinecraft.classList.add("hidden");
        cardMinecraft.setAttribute("aria-expanded", "false");
        try {
            localStorage.setItem("st_mc_modal", "closed");
        }
        catch { }
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
        }
        catch { }
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
            }
            else {
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
            if (!modalMinecraft.classList.contains("hidden"))
                closeMinecraftModal(true);
        }
    });
    // Синхронизация вкладок и хэша URL
    function openView(name, syncHash = true) {
        document.querySelectorAll(".seg-card").forEach((btn) => {
            btn.classList.toggle("active", btn.getAttribute("data-view") === name);
        });
        document.querySelectorAll(".settings-view").forEach((view) => {
            view.classList.toggle("hidden", view.id !== name);
        });
        if (syncHash) {
            const hash = name ? "#/" + name.replace(/^view-/, "") : "";
            if (window.location.hash !== hash) {
                window.history.replaceState(null, "", hash === "" ? window.location.pathname : hash);
            }
        }
    }
    function viewFromHash() {
        const match = window.location.hash.match(/^#\/(court|games|donates|overlay)(\/.*)?$/);
        return match ? "view-" + match[1] : null;
    }
    function shouldOpenMinecraftModal() {
        if (window.location.hash === "#/games/minecraft")
            return true;
        try {
            const saved = localStorage.getItem("st_mc_modal");
            if (saved === "open" && window.location.hash.startsWith("#/games")) {
                return true;
            }
        }
        catch { }
        return false;
    }
    document.querySelectorAll(".seg-card").forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = btn.getAttribute("data-view");
            if (!target)
                return;
            const isOpen = btn.classList.contains("active");
            if (isOpen) {
                closeMinecraftModal(false);
                openView(null);
            }
            else {
                openView(target);
            }
        });
    });
    window.addEventListener("hashchange", () => {
        const view = viewFromHash();
        openView(view, false);
        if (window.location.hash === "#/games/minecraft") {
            openMinecraftModal(false);
        }
        else if (!window.location.hash.startsWith("#/games")) {
            closeMinecraftModal(false);
        }
    });
    const initialView = viewFromHash();
    const mcModalOpen = shouldOpenMinecraftModal();
    if (mcModalOpen) {
        openView("view-games", false);
        openMinecraftModal(window.location.hash !== "#/games/minecraft");
    }
    else {
        openView(initialView, false);
    }
    const backdrop = document.getElementById("bg-canvas");
    if (backdrop && typeof Backdrop !== "undefined")
        Backdrop.mount(backdrop);
    const gooey = document.getElementById("gooey-nav");
    if (gooey && typeof GooeyNav !== "undefined")
        GooeyNav.mount(gooey);
})();
