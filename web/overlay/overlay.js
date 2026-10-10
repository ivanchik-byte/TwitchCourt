"use strict";
(function () {
    function el(id) {
        const node = document.getElementById(id);
        if (!node)
            throw new Error("missing node #" + id);
        return node;
    }
    const stage = el("stage");
    const court = el("court");
    const prosecutor = el("prosecutor");
    const mouth = el("mouth");
    const caseNo = el("case-no");
    const charge = el("charge");
    const subtitles = el("subtitles");
    const testimony = el("testimony");
    const testimonyAuthor = el("testimony-author");
    const testimonyText = el("testimony-text");
    const objection = el("objection");
    const verdict = el("verdict");
    const verdictText = el("verdict-text");
    let objectionTimer = 0;
    let briefCourtTimer = 0;
    let currentStageState = "idle";
    let audioCtx = null;
    let analyser = null;
    let lipRaf = 0;
    const audioQueue = [];
    let playing = false;
    let currentSource = null;
    function ctx() {
        if (!audioCtx) {
            const Impl = window.AudioContext ||
                window.webkitAudioContext;
            audioCtx = new Impl();
            analyser = audioCtx.createAnalyser();
            analyser.fftSize = 512;
            analyser.connect(audioCtx.destination);
        }
        if (audioCtx.state === "suspended")
            void audioCtx.resume();
        return audioCtx;
    }
    function lipTick() {
        if (!analyser)
            return;
        const data = new Uint8Array(analyser.frequencyBinCount);
        analyser.getByteTimeDomainData(data);
        let sum = 0;
        for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
        }
        const rms = Math.sqrt(sum / data.length);
        mouth.classList.toggle("open", rms > 0.02);
        if (playing)
            lipRaf = requestAnimationFrame(lipTick);
        else
            mouth.classList.remove("open");
    }
    function enqueueAudio(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
        const ac = ctx();
        const copy = bytes.buffer.slice(0);
        ac.decodeAudioData(copy).then((decoded) => {
            audioQueue.push(decoded);
            if (!playing)
                playNext();
        }, () => undefined);
    }
    function playNext() {
        const buffer = audioQueue.shift();
        if (!buffer) {
            playing = false;
            currentSource = null;
            mouth.classList.remove("open");
            return;
        }
        playing = true;
        const ac = ctx();
        const source = ac.createBufferSource();
        currentSource = source;
        source.buffer = buffer;
        if (analyser)
            source.connect(analyser);
        else
            source.connect(ac.destination);
        source.onended = () => playNext();
        source.start();
        cancelAnimationFrame(lipRaf);
        lipRaf = requestAnimationFrame(lipTick);
    }
    function stopAudio() {
        audioQueue.length = 0;
        playing = false;
        try {
            currentSource?.stop();
        }
        catch {
            /* already ended */
        }
        currentSource = null;
        mouth.classList.remove("open");
    }
    function thump(when) {
        try {
            const ac = ctx();
            const t = when ?? ac.currentTime;
            const osc = ac.createOscillator();
            osc.type = "sine";
            osc.frequency.setValueAtTime(120, t);
            osc.frequency.exponentialRampToValueAtTime(38, t + 0.18);
            const gain = ac.createGain();
            gain.gain.setValueAtTime(0.9, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.25);
            osc.connect(gain);
            gain.connect(ac.destination);
            osc.start(t);
            osc.stop(t + 0.3);
        }
        catch {
            /* audio locked until first gesture */
        }
    }
    function coinPing() {
        try {
            const ac = ctx();
            [880, 1320].forEach((freq, i) => {
                const t = ac.currentTime + i * 0.09;
                const osc = ac.createOscillator();
                osc.type = "sine";
                osc.frequency.setValueAtTime(freq, t);
                const gain = ac.createGain();
                gain.gain.setValueAtTime(0.25, t);
                gain.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
                osc.connect(gain);
                gain.connect(ac.destination);
                osc.start(t);
                osc.stop(t + 0.25);
            });
        }
        catch {
            /* audio locked until first gesture */
        }
    }
    // Short samples live in sfx/, missing files stay silent on purpose.
    function playSfx(name) {
        try {
            const audio = new Audio("sfx/" + name);
            audio.volume = 0.9;
            void audio.play().catch(() => undefined);
        }
        catch {
            /* no sample yet */
        }
    }
    function deskSlam() {
        slamVisual();
        thump();
        playSfx("gavel.mp3");
    }
    function slamVisual() {
        prosecutor.classList.remove("slam");
        void prosecutor.offsetWidth;
        prosecutor.classList.add("slam");
        stage.classList.remove("shake");
        void stage.offsetWidth;
        stage.classList.add("shake");
        window.setTimeout(() => stage.classList.remove("shake"), 300);
    }
    function showObjection() {
        objection.classList.remove("hidden");
        objection.classList.remove("show");
        void objection.offsetWidth;
        objection.classList.add("show");
        playSfx("objection.mp3");
        window.clearTimeout(objectionTimer);
        objectionTimer = window.setTimeout(() => objection.classList.add("hidden"), 1250);
    }
    function showVerdict(payload) {
        const guilty = payload.verdict === "ВИНОВЕН";
        verdictText.textContent = payload.verdict;
        verdict.className = guilty ? "guilty" : "innocent";
        verdict.classList.remove("hidden");
        verdict.classList.remove("drop");
        void verdict.offsetWidth;
        verdict.classList.add("drop");
        stopCrowd();
        stopBgm();
        slamVisual();
        thump();
        playSfx("verdict.mp3");
    }
    function hideVerdict() {
        verdict.classList.add("hidden");
        verdict.classList.remove("drop");
    }
    function revealCourtBriefly(durationMs = 4500) {
        if (currentStageState === "idle") {
            court.classList.remove("hidden");
            window.clearTimeout(briefCourtTimer);
            briefCourtTimer = window.setTimeout(() => {
                if (currentStageState === "idle") {
                    court.classList.add("hidden");
                    subtitles.textContent = "";
                }
            }, durationMs);
        }
    }
    let bgm = null;
    function startBgm() {
        try {
            if (!bgm) {
                bgm = new Audio("sfx/bgm.mp3");
                bgm.loop = true;
                bgm.volume = 0.25;
            }
            void bgm.play().catch(() => undefined);
        }
        catch {
            /* no sample yet */
        }
    }
    function stopBgm() {
        try {
            if (bgm)
                bgm.pause();
        }
        catch {
            /* no sample yet */
        }
    }
    // Hushed crowd bed under the trial, cut on verdict for silence in the hall.
    let crowd = null;
    function startCrowd() {
        try {
            if (!crowd) {
                crowd = new Audio("sfx/crowd.mp3");
                crowd.loop = true;
                crowd.volume = 0.6;
            }
            void crowd.play().catch(() => undefined);
        }
        catch {
            /* no sample yet */
        }
    }
    function stopCrowd() {
        try {
            if (crowd) {
                crowd.pause();
                crowd.currentTime = 0;
            }
        }
        catch {
            /* no sample yet */
        }
    }
    function resetStage() {
        currentStageState = "idle";
        window.clearTimeout(briefCourtTimer);
        stopAudio();
        stopCrowd();
        court.classList.add("hidden");
        testimony.classList.add("hidden");
        hideVerdict();
        objection.classList.add("hidden");
    }
    let failures = 0;
    function connect() {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(protocol + "//" + location.host + "/ws" + location.search);
        ws.onmessage = (event) => {
            let msg;
            try {
                msg = JSON.parse(event.data);
            }
            catch {
                return;
            }
            handleEvent(msg);
        };
        ws.onopen = () => {
            failures = 0;
        };
        ws.onclose = () => {
            failures += 1;
            const delay = Math.min(2000 * 2 ** failures, 30000) + Math.floor(Math.random() * 500);
            window.setTimeout(connect, delay);
        };
    }
    function handleEvent(msg) {
        switch (msg.type) {
            case "state_change": {
                const state = String(msg.payload.state || "idle");
                currentStageState = state;
                if (state === "idle") {
                    stopBgm();
                    stopCrowd();
                    resetStage();
                }
                else {
                    window.clearTimeout(briefCourtTimer);
                    court.classList.remove("hidden");
                    startBgm();
                    startCrowd();
                    hideVerdict();
                    testimony.classList.add("hidden");
                    if (msg.payload.case_title)
                        caseNo.textContent = msg.payload.case_title;
                    if (msg.payload.charge)
                        charge.textContent = "Обвинение: " + msg.payload.charge;
                }
                break;
            }
            case "subtitles":
                revealCourtBriefly();
                if (msg.payload.text)
                    subtitles.textContent = msg.payload.text;
                break;
            case "audio_chunk":
                revealCourtBriefly();
                if (msg.payload.audio_base64)
                    enqueueAudio(msg.payload.audio_base64);
                if (msg.payload.text)
                    subtitles.textContent = msg.payload.text;
                break;
            case "animation":
                if (msg.payload.name === "slam" || msg.payload.name === "desk_slam") {
                    revealCourtBriefly();
                    deskSlam();
                }
                else if (msg.payload.name === "objection") {
                    showObjection();
                }
                break;
            case "verdict":
                showVerdict(msg.payload);
                break;
            case "donation":
                coinPing();
                break;
            case "testimony":
                testimonyAuthor.textContent = msg.payload.author || "Подсудимый";
                testimonyText.textContent = msg.payload.text;
                testimony.classList.remove("hidden");
                break;
            case "panic":
                stopBgm();
                resetStage();
                break;
            default:
                break;
        }
    }
    window.addEventListener("click", () => ctx(), { once: true });
    connect();
})();
