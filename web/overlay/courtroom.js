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
// OBS courtroom overlay: state machine, voice bus with room DSP, scaled stage.
(function () {
    const STAGE_W = 1920;
    const STAGE_H = 1080;
    function el(id) {
        const node = document.getElementById(id);
        if (!node)
            throw new Error("missing node #" + id);
        return node;
    }
    const stage = el("court-stage");
    const scaler = el("court-scaler");
    const dialogText = el("dialog-text");
    const speakerName = el("speaker-name");
    const caseTitle = el("case-title");
    const sprite = el("character-sprite");
    const objectionBanner = el("objection-banner");
    const verdictStamp = el("verdict-stamp");
    const stampText = el("stamp-text");
    const votingPanel = el("voting-bar-container");
    const guiltyCount = el("guilty-count");
    const innocentCount = el("innocent-count");
    const voteTimer = el("vote-timer");
    const guiltyFill = el("guilty-fill");
    const innocentFill = el("innocent-fill");
    // The 1920x1080 scene scales down to any source size without reflow.
    function fitStage() {
        const host = scaler.parentElement;
        if (!host)
            return;
        const box = host.getBoundingClientRect();
        const scale = Math.min(box.width / STAGE_W, box.height / STAGE_H);
        scaler.style.transform = "scale(" + scale + ")";
    }
    window.addEventListener("resize", fitStage);
    let audioCtx = null;
    let voiceBus = null;
    const audioQueue = [];
    let playing = false;
    function ctx() {
        if (!audioCtx) {
            const Impl = window.AudioContext || window.webkitAudioContext;
            audioCtx = new Impl();
            voiceBus = buildVoiceBus(audioCtx);
        }
        if (audioCtx.state === "suspended")
            void audioCtx.resume();
        return audioCtx;
    }
    // Courtroom voice bus: highpass -> box cut -> presence -> glue -> dry + room.
    function buildVoiceBus(ac) {
        const input = ac.createGain();
        const highpass = ac.createBiquadFilter();
        highpass.type = "highpass";
        highpass.frequency.value = 80;
        const boxCut = ac.createBiquadFilter();
        boxCut.type = "peaking";
        boxCut.frequency.value = 450;
        boxCut.Q.value = 1.1;
        boxCut.gain.value = -6;
        const presence = ac.createBiquadFilter();
        presence.type = "peaking";
        presence.frequency.value = 3500;
        presence.Q.value = 0.9;
        presence.gain.value = 4;
        const glue = ac.createDynamicsCompressor();
        glue.threshold.value = -18;
        glue.ratio.value = 4;
        glue.attack.value = 0.004;
        glue.release.value = 0.18;
        const dry = ac.createGain();
        dry.gain.value = 0.88;
        const wet = ac.createGain();
        wet.gain.value = 0.12;
        const room = ac.createConvolver();
        room.buffer = makeRoomImpulse(ac);
        input.connect(highpass);
        highpass.connect(boxCut);
        boxCut.connect(presence);
        presence.connect(glue);
        glue.connect(dry);
        dry.connect(ac.destination);
        glue.connect(room);
        room.connect(wet);
        wet.connect(ac.destination);
        return input;
    }
    function makeRoomImpulse(ac) {
        const len = Math.floor(ac.sampleRate * 1.1);
        const impulse = ac.createBuffer(2, len, ac.sampleRate);
        for (let ch = 0; ch < 2; ch++) {
            const data = impulse.getChannelData(ch);
            for (let i = 0; i < len; i++) {
                data[i] = (Math.random() * 2 - 1) * Math.exp((-3.2 * i) / len);
            }
        }
        return impulse;
    }
    function gavelHit(when) {
        const ac = ctx();
        const t = when ?? ac.currentTime;
        const frames = Math.floor(ac.sampleRate * 0.04);
        const noiseBuf = ac.createBuffer(1, frames, ac.sampleRate);
        const data = noiseBuf.getChannelData(0);
        for (let i = 0; i < frames; i++) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ac.sampleRate * 0.007));
        }
        const noise = ac.createBufferSource();
        noise.buffer = noiseBuf;
        const band = ac.createBiquadFilter();
        band.type = "bandpass";
        band.frequency.setValueAtTime(1600, t);
        band.Q.setValueAtTime(3.0, t);
        const click = ac.createGain();
        click.gain.setValueAtTime(1.5, t);
        click.gain.exponentialRampToValueAtTime(0.001, t + 0.04);
        noise.connect(band);
        band.connect(click);
        click.connect(ac.destination);
        noise.start(t);
        const body = ac.createOscillator();
        body.type = "triangle";
        body.frequency.setValueAtTime(190, t);
        body.frequency.exponentialRampToValueAtTime(105, t + 0.08);
        const bodyGain = ac.createGain();
        bodyGain.gain.setValueAtTime(1.0, t);
        bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
        body.connect(bodyGain);
        bodyGain.connect(ac.destination);
        body.start(t);
        body.stop(t + 0.25);
    }
    function objectionStinger(when) {
        const ac = ctx();
        const t = when ?? ac.currentTime;
        const bus = ac.createDynamicsCompressor();
        bus.threshold.setValueAtTime(-10, t);
        bus.ratio.setValueAtTime(8, t);
        bus.connect(ac.destination);
        const chord = [146.83, 220.0, 349.23, 415.3, 587.33];
        chord.forEach((freq, idx) => {
            const osc = ac.createOscillator();
            osc.type = idx % 2 === 0 ? "sawtooth" : "triangle";
            osc.frequency.setValueAtTime(freq, t);
            const veil = ac.createBiquadFilter();
            veil.type = "lowpass";
            veil.frequency.setValueAtTime(3200, t);
            veil.frequency.exponentialRampToValueAtTime(600, t + 0.5);
            const gain = ac.createGain();
            gain.gain.setValueAtTime(0.3 / chord.length, t);
            gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.75 + idx * 0.04);
            osc.connect(veil);
            veil.connect(gain);
            gain.connect(bus);
            osc.start(t);
            osc.stop(t + 0.85);
        });
    }
    function enqueueAudio(base64) {
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++)
            bytes[i] = binary.charCodeAt(i);
        const ac = ctx();
        ac.decodeAudioData(bytes.buffer.slice(0), (decoded) => {
            audioQueue.push(decoded);
            if (!playing)
                playNext();
        }, () => undefined);
    }
    function playNext() {
        if (audioQueue.length === 0) {
            playing = false;
            sprite.classList.remove("talking");
            return;
        }
        playing = true;
        sprite.classList.add("talking");
        const ac = ctx();
        const buffer = audioQueue.shift();
        if (!buffer) {
            playing = false;
            return;
        }
        const source = ac.createBufferSource();
        source.buffer = buffer;
        source.connect(voiceBus ?? ac.destination);
        source.onended = () => playNext();
        source.start();
    }
    function deskSlam() {
        sprite.classList.add("slam");
        stage.classList.add("screen-shake");
        gavelHit();
        window.setTimeout(() => {
            sprite.classList.remove("slam");
            stage.classList.remove("screen-shake");
        }, 400);
    }
    function objection() {
        objectionStinger();
        objectionBanner.classList.remove("hidden");
        stage.classList.add("screen-shake");
        window.setTimeout(() => stage.classList.remove("screen-shake"), 300);
        window.setTimeout(() => objectionBanner.classList.add("hidden"), 1200);
    }
    function onStateChange(payload) {
        if (payload.state === "idle") {
            stage.classList.remove("active");
            stage.classList.add("idle");
            votingPanel.classList.add("hidden");
            verdictStamp.classList.add("hidden");
            objectionBanner.classList.add("hidden");
            return;
        }
        stage.classList.remove("idle");
        stage.classList.add("active");
        if (payload.case_title)
            caseTitle.textContent = payload.case_title;
        if (payload.charge)
            dialogText.textContent = "Обвинение: " + payload.charge;
        if (payload.state === "voting")
            votingPanel.classList.remove("hidden");
        else
            votingPanel.classList.add("hidden");
    }
    function onVoting(payload) {
        guiltyCount.textContent = String(payload.guilty_count);
        innocentCount.textContent = String(payload.innocent_count);
        voteTimer.textContent = payload.time_left_sec + "с";
        const total = payload.guilty_count + payload.innocent_count;
        if (total > 0) {
            const share = Math.round((payload.guilty_count / total) * 100);
            guiltyFill.style.width = share + "%";
            innocentFill.style.width = 100 - share + "%";
        }
    }
    function onVerdict(payload) {
        stampText.textContent = payload.verdict;
        stampText.classList.toggle("innocent", payload.verdict === "НЕВИНОВЕН");
        verdictStamp.classList.remove("hidden");
        deskSlam();
        window.setTimeout(() => verdictStamp.classList.add("hidden"), 5000);
    }
    function resetStage() {
        audioQueue.length = 0;
        playing = false;
        sprite.classList.remove("talking");
        stage.classList.remove("active");
        stage.classList.add("idle");
        verdictStamp.classList.add("hidden");
        objectionBanner.classList.add("hidden");
    }
    function connect() {
        const ws = new WebSocket(Tribunal.socketUrl("/ws"));
        ws.onmessage = (event) => {
            const msg = Tribunal.parseEvent(event.data);
            if (!msg)
                return;
            switch (msg.type) {
                case "state_change":
                    onStateChange(msg.payload);
                    break;
                case "subtitles":
                    if (msg.payload.speaker)
                        speakerName.textContent = msg.payload.speaker;
                    if (msg.payload.text)
                        dialogText.textContent = msg.payload.text;
                    break;
                case "audio_chunk":
                    if (msg.payload.audio_base64)
                        enqueueAudio(msg.payload.audio_base64);
                    if (msg.payload.text)
                        dialogText.textContent = msg.payload.text;
                    break;
                case "animation":
                    if (msg.payload.name === "slam" || msg.payload.name === "desk_slam")
                        deskSlam();
                    else if (msg.payload.name === "objection")
                        objection();
                    break;
                case "voting_update":
                    onVoting(msg.payload);
                    break;
                case "verdict":
                    onVerdict(msg.payload);
                    break;
                case "panic":
                    resetStage();
                    break;
            }
        };
        ws.onclose = () => window.setTimeout(connect, 2000);
    }
    window.addEventListener("click", () => ctx(), { once: true });
    fitStage();
    connect();
})();
