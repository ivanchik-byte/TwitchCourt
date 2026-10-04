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
    const secretInput = el("secret-input");
    function secret() {
        return secretInput.value.trim();
    }
    function authHeaders() {
        const value = secret();
        return value ? { "X-Tribunal-Secret": value } : {};
    }
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
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(body),
        })
            .then((res) => {
            say(settingsStatus, res.ok ? "Настройки сохранены." : "Ошибка: требуется секретный ключ.");
        })
            .catch(() => {
            say(settingsStatus, "Нет связи с сервером.");
        });
    });
    profileForm.addEventListener("submit", (event) => {
        event.preventDefault();
        fetch("/api/profile", {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify({
                name: profileName.value.trim(),
                titles: Settings.splitList(profileTitles.value),
                traits: Settings.splitList(profileTraits.value),
                running_gags: Settings.splitList(profileGags.value),
                mercy: profileMercy.value.trim(),
            }),
        })
            .then((res) => {
            say(profileStatus, res.ok ? "Портрет сохранен." : "Ошибка: требуется секретный ключ.");
        })
            .catch(() => {
            say(profileStatus, "Нет связи с сервером.");
        });
    });
    const judgeForm = el("judge-form");
    const judgeState = el("judge-state");
    const judgeFile = el("judge-file");
    const judgeStatus = el("judge-status");
    judgeForm.addEventListener("submit", (event) => {
        event.preventDefault();
        if (!judgeFile.files || judgeFile.files.length === 0) {
            say(judgeStatus, "Выберите файл изображения.");
            return;
        }
        const data = new FormData();
        data.append("photo", judgeFile.files[0]);
        fetch("/api/judge/photo?state=" + encodeURIComponent(judgeState.value), {
            method: "POST",
            headers: { ...authHeaders() },
            body: data,
        })
            .then((res) => {
            say(judgeStatus, res.ok ? "Фото обновлено." : "Ошибка загрузки: проверьте файл и секретный ключ.");
        })
            .catch(() => {
            say(judgeStatus, "Нет связи с сервером.");
        });
    });
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
        const match = window.location.hash.match(/^#\/(court|donates|overlay)(\/.*)?$/);
        if (match)
            return "view-" + match[1];
        return "view-court";
    }
    document.querySelectorAll(".seg-card").forEach((btn) => {
        btn.addEventListener("click", () => {
            const target = btn.getAttribute("data-view");
            if (!target || btn.classList.contains("active"))
                return;
            openView(target);
        });
    });
    window.addEventListener("hashchange", () => {
        openView(viewFromHash(), false);
    });
    openView(viewFromHash(), false);
    const aiForm = el("ai-form");
    const aiProvider = el("ai-provider");
    const aiModel = el("ai-model");
    const aiKey = el("ai-key");
    const aiTemp = el("ai-temp");
    const aiStatus = el("ai-status");
    function renderAI(data) {
        if (data.provider)
            aiProvider.value = data.provider;
        if (data.model)
            aiModel.value = data.model;
        if (typeof data.temperature === "number")
            aiTemp.value = String(data.temperature);
        if (typeof data.live === "boolean") {
            say(aiStatus, data.live ? "Мозг подключён, прокурор в эфире." : "Ключа нет — суд говорит заготовками (mock).");
        }
    }
    fetch("/api/ai")
        .then((res) => res.json())
        .then((data) => renderAI(data))
        .catch(() => undefined);
    aiForm.addEventListener("submit", (event) => {
        event.preventDefault();
        const tempRaw = aiTemp.value.trim();
        const temp = tempRaw === "" ? null : Number(tempRaw);
        const body = {
            provider: aiProvider.value,
            model: aiModel.value.trim(),
            temperature: temp,
        };
        if (aiKey.value.trim() !== "")
            body["api_key"] = aiKey.value;
        if (typeof temp !== "number" || !Number.isFinite(temp))
            delete body["temperature"];
        fetch("/api/ai", {
            method: "PUT",
            headers: { "Content-Type": "application/json", ...authHeaders() },
            body: JSON.stringify(body),
        })
            .then((res) => {
            if (!res.ok) {
                say(aiStatus, "Ошибка: проверьте секретный ключ и провайдера.");
                return null;
            }
            return res.json();
        })
            .then((data) => {
            if (data) {
                renderAI(data);
                aiKey.value = "";
            }
        })
            .catch(() => {
            say(aiStatus, "Нет связи с сервером.");
        });
    });
    const backdrop = document.getElementById("bg-canvas");
    if (backdrop && typeof Backdrop !== "undefined")
        Backdrop.mount(backdrop);
    const gooey = document.getElementById("gooey-nav");
    if (gooey && typeof GooeyNav !== "undefined")
        GooeyNav.mount(gooey);
})();
