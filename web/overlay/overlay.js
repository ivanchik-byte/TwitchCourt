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
    const caseTeaser = el("case-teaser");
    const teaserNum = el("teaser-num");
    const teaserFill = el("teaser-fill");
    const prosecutor = el("prosecutor");
    const mouth = el("mouth");
    const caseNo = el("case-no");
    const charge = el("charge");
    const subtitles = el("subtitles");
    const gauge = el("gauge");
    const gaugeGuilty = el("gauge-guilty");
    const gaugeGuiltyN = el("gauge-guilty-n");
    const gaugeInnocent = el("gauge-innocent");
    const gaugeInnocentN = el("gauge-innocent-n");
    const gaugeTimer = el("gauge-timer");
    const objection = el("objection");
    const verdict = el("verdict");
    const verdictText = el("verdict-text");
    let teaserTimer = 0;
    let objectionTimer = 0;
    let audioCtx = null;
    let analyser = null;
    let lipRaf = 0;
    const audioQueue = [];
    let playing = false;
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
            mouth.classList.remove("open");
            return;
        }
        playing = true;
        const ac = ctx();
        const source = ac.createBufferSource();
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
    function deskSlam() {
        prosecutor.classList.remove("slam");
        void prosecutor.offsetWidth;
        prosecutor.classList.add("slam");
        stage.classList.remove("shake");
        void stage.offsetWidth;
        stage.classList.add("shake");
        thump();
        window.setTimeout(() => stage.classList.remove("shake"), 300);
    }
    function showObjection() {
        objection.classList.remove("hidden");
        objection.classList.remove("show");
        void objection.offsetWidth;
        objection.classList.add("show");
        window.clearTimeout(objectionTimer);
        objectionTimer = window.setTimeout(() => objection.classList.add("hidden"), 1250);
    }
    function showTeaser(meter) {
        teaserNum.textContent = "404";
        teaserFill.style.width = meter + "%";
        caseTeaser.classList.remove("hidden");
        window.clearTimeout(teaserTimer);
        teaserTimer = window.setTimeout(() => caseTeaser.classList.add("hidden"), 2000);
    }
    function showVerdict(payload) {
        const guilty = payload.verdict === "ВИНОВЕН";
        verdictText.textContent = payload.verdict;
        verdict.className = guilty ? "guilty" : "innocent";
        verdict.classList.remove("hidden");
        verdict.classList.remove("drop");
        void verdict.offsetWidth;
        verdict.classList.add("drop");
        thump();
        deskSlam();
    }
    function hideVerdict() {
        verdict.classList.add("hidden");
        verdict.classList.remove("drop");
    }
    function resetStage() {
        stopAudio();
        court.classList.add("hidden");
        gauge.classList.add("hidden");
        hideVerdict();
        objection.classList.add("hidden");
        caseTeaser.classList.add("hidden");
    }
    function connect() {
        const protocol = location.protocol === "https:" ? "wss:" : "ws:";
        const ws = new WebSocket(protocol + "//" + location.host + "/ws");
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
        ws.onclose = () => {
            window.setTimeout(connect, 2000);
        };
    }
    function handleEvent(msg) {
        switch (msg.type) {
            case "state_change": {
                const state = String(msg.payload.state || "idle");
                if (state === "idle") {
                    resetStage();
                }
                else {
                    court.classList.remove("hidden");
                    hideVerdict();
                    if (msg.payload.case_title)
                        caseNo.textContent = msg.payload.case_title;
                    if (msg.payload.charge)
                        charge.textContent = "Обвинение: " + msg.payload.charge;
                    if (state === "voting")
                        gauge.classList.remove("hidden");
                    else
                        gauge.classList.add("hidden");
                }
                break;
            }
            case "subtitles":
                if (msg.payload.text)
                    subtitles.textContent = msg.payload.text;
                break;
            case "audio_chunk":
                if (msg.payload.audio_base64)
                    enqueueAudio(msg.payload.audio_base64);
                if (msg.payload.text)
                    subtitles.textContent = msg.payload.text;
                break;
            case "animation":
                if (msg.payload.name === "slam" || msg.payload.name === "desk_slam")
                    deskSlam();
                else if (msg.payload.name === "objection")
                    showObjection();
                break;
            case "voting_update": {
                const total = msg.payload.guilty_count + msg.payload.innocent_count;
                const share = total > 0 ? Math.round((msg.payload.guilty_count / total) * 100) : 50;
                gaugeGuilty.style.width = share + "%";
                gaugeGuiltyN.textContent = String(msg.payload.guilty_count);
                gaugeInnocentN.textContent = String(msg.payload.innocent_count);
                gaugeTimer.textContent = String(msg.payload.time_left_sec);
                break;
            }
            case "verdict":
                gauge.classList.add("hidden");
                showVerdict(msg.payload);
                break;
            case "donation":
                coinPing();
                break;
            case "suspicion":
                showTeaser(msg.payload.meter);
                break;
            case "panic":
                resetStage();
                break;
            default:
                break;
        }
    }
    window.addEventListener("click", () => ctx(), { once: true });
    connect();
})();
