(function() {
  const stage = document.getElementById("court-stage");
  const dialogText = document.getElementById("dialog-text");
  const speakerName = document.getElementById("speaker-name");
  const caseTitle = document.getElementById("case-title");
  const sprite = document.getElementById("character-sprite");
  const objectionBanner = document.getElementById("objection-banner");
  const verdictStamp = document.getElementById("verdict-stamp");
  const stampText = document.getElementById("stamp-text");
  const votingContainer = document.getElementById("voting-bar-container");
  const guiltyCount = document.getElementById("guilty-count");
  const innocentCount = document.getElementById("innocent-count");
  const voteTimer = document.getElementById("vote-timer");
  const guiltyFill = document.getElementById("guilty-fill");
  const innocentFill = document.getElementById("innocent-fill");

  let audioCtx = null;
  let voiceChain = null;
  const audioQueue = [];
  let isPlayingAudio = false;

  function getAudioContext() {
    if (!audioCtx) {
      const AudioContextClass = window.AudioContext || window.webkitAudioContext;
      audioCtx = new AudioContextClass();
      voiceChain = buildVoiceChain(audioCtx);
    }
    if (audioCtx.state === "suspended") {
      audioCtx.resume();
    }
    return audioCtx;
  }

  // Courtroom voice bus: highpass -> eq -> compressor -> dry + room.
  // Runs in OBS CEF with zero cost on the game PC encoder path.
  function buildVoiceChain(ctx) {
    const input = ctx.createGain();
    const highpass = ctx.createBiquadFilter();
    highpass.type = "highpass";
    highpass.frequency.value = 80;

    const boxCut = ctx.createBiquadFilter();
    boxCut.type = "peaking";
    boxCut.frequency.value = 450;
    boxCut.Q.value = 1.1;
    boxCut.gain.value = -6;

    const presence = ctx.createBiquadFilter();
    presence.type = "peaking";
    presence.frequency.value = 3500;
    presence.Q.value = 0.9;
    presence.gain.value = 4;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.18;

    const dry = ctx.createGain();
    dry.gain.value = 0.88;
    const wet = ctx.createGain();
    wet.gain.value = 0.12;
    const verb = ctx.createConvolver();
    verb.buffer = makeRoomImpulse(ctx);

    input.connect(highpass);
    highpass.connect(boxCut);
    boxCut.connect(presence);
    presence.connect(comp);
    comp.connect(dry);
    dry.connect(ctx.destination);
    comp.connect(verb);
    verb.connect(wet);
    wet.connect(ctx.destination);
    return input;
  }

  function makeRoomImpulse(ctx) {
    const seconds = 1.1;
    const rate = ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const impulse = ctx.createBuffer(2, len, rate);
    for (let ch = 0; ch < 2; ch++) {
      const data = impulse.getChannelData(ch);
      for (let i = 0; i < len; i++) {
        data[i] = (Math.random() * 2 - 1) * Math.exp(-3.2 * i / len);
      }
    }
    return impulse;
  }

  function playGavelHit(when) {
    const ctx = getAudioContext();
    const t = when || ctx.currentTime;

    const bufLen = Math.floor(ctx.sampleRate * 0.04);
    const noiseBuf = ctx.createBuffer(1, bufLen, ctx.sampleRate);
    const data = noiseBuf.getChannelData(0);
    for (let i = 0; i < bufLen; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.007));
    }
    const noise = ctx.createBufferSource();
    noise.buffer = noiseBuf;

    const bandpass = ctx.createBiquadFilter();
    bandpass.type = "bandpass";
    bandpass.frequency.setValueAtTime(1600, t);
    bandpass.Q.setValueAtTime(3.0, t);

    const noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(1.5, t);
    noiseGain.gain.exponentialRampToValueAtTime(0.001, t + 0.04);

    noise.connect(bandpass);
    bandpass.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    noise.start(t);

    const osc1 = ctx.createOscillator();
    osc1.type = "triangle";
    osc1.frequency.setValueAtTime(190, t);
    osc1.frequency.exponentialRampToValueAtTime(105, t + 0.08);

    const oscGain1 = ctx.createGain();
    oscGain1.gain.setValueAtTime(1.0, t);
    oscGain1.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);

    osc1.connect(oscGain1);
    oscGain1.connect(ctx.destination);
    osc1.start(t);
    osc1.stop(t + 0.25);

    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(130, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + 0.07);

    const subGain = ctx.createGain();
    subGain.gain.setValueAtTime(0.9, t);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);

    sub.connect(subGain);
    subGain.connect(ctx.destination);
    sub.start(t);
    sub.stop(t + 0.16);
  }

  function playObjectionStinger(when) {
    const ctx = getAudioContext();
    const t = when || ctx.currentTime;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.setValueAtTime(-10, t);
    comp.ratio.setValueAtTime(8, t);
    comp.connect(ctx.destination);

    const chordFreqs = [146.83, 220.0, 349.23, 415.3, 587.33];
    chordFreqs.forEach((f, idx) => {
      const osc = ctx.createOscillator();
      osc.type = (idx % 2 === 0) ? "sawtooth" : "triangle";
      osc.frequency.setValueAtTime(f, t);
      osc.frequency.exponentialRampToValueAtTime(f * 0.985, t + 0.08);

      const lpf = ctx.createBiquadFilter();
      lpf.type = "lowpass";
      lpf.frequency.setValueAtTime(3200, t);
      lpf.frequency.exponentialRampToValueAtTime(600, t + 0.5);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.3 / chordFreqs.length, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.75 + idx * 0.04);

      osc.connect(lpf);
      lpf.connect(g);
      g.connect(comp);
      osc.start(t);
      osc.stop(t + 0.85);
    });

    const bell = ctx.createOscillator();
    bell.type = "sine";
    bell.frequency.setValueAtTime(1760, t);
    const bellGain = ctx.createGain();
    bellGain.gain.setValueAtTime(0.15, t);
    bellGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    bell.connect(bellGain);
    bellGain.connect(comp);
    bell.start(t);
    bell.stop(t + 0.95);
  }

  function enqueueAudio(base64Data) {
    const binary = atob(base64Data);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
      bytes[i] = binary.charCodeAt(i);
    }

    const ctx = getAudioContext();
    ctx.decodeAudioData(bytes.buffer.slice(0), (decoded) => {
      audioQueue.push(decoded);
      if (!isPlayingAudio) {
        processNextAudio();
      }
    }, () => {});
  }

  function processNextAudio() {
    if (audioQueue.length === 0) {
      isPlayingAudio = false;
      sprite.classList.remove("talking");
      return;
    }

    isPlayingAudio = true;
    sprite.classList.add("talking");

    const ctx = getAudioContext();
    const buffer = audioQueue.shift();
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(voiceChain || ctx.destination);

    source.onended = () => {
      processNextAudio();
    };

    source.start();
  }

  function triggerDeskSlam() {
    sprite.classList.add("slam");
    stage.classList.add("screen-shake");
    playGavelHit();
    setTimeout(() => {
      sprite.classList.remove("slam");
      stage.classList.remove("screen-shake");
    }, 400);
  }

  function triggerObjection() {
    playObjectionStinger();
    objectionBanner.classList.remove("hidden");
    stage.classList.add("screen-shake");
    setTimeout(() => {
      stage.classList.remove("screen-shake");
    }, 300);
    setTimeout(() => {
      objectionBanner.classList.add("hidden");
    }, 1200);
  }

  function handleMessage(event) {
    let msg;
    try {
      msg = JSON.parse(event.data);
    } catch (err) {
      return;
    }

    switch (msg.type) {
      case "state_change":
        handleStateChange(msg.payload);
        break;
      case "subtitles":
        if (msg.payload.speaker) speakerName.textContent = msg.payload.speaker;
        if (msg.payload.text) dialogText.textContent = msg.payload.text;
        break;
      case "audio_chunk":
        if (msg.payload.audio_base64) {
          enqueueAudio(msg.payload.audio_base64);
        }
        if (msg.payload.text) {
          dialogText.textContent = msg.payload.text;
        }
        break;
      case "animation":
        if (msg.payload.name === "slam" || msg.payload.name === "desk_slam") {
          triggerDeskSlam();
        } else if (msg.payload.name === "objection") {
          triggerObjection();
        }
        break;
      case "voting_update":
        handleVotingUpdate(msg.payload);
        break;
      case "verdict":
        handleVerdict(msg.payload);
        break;
      case "panic":
        handlePanic();
        break;
    }
  }

  function handleStateChange(payload) {
    if (payload.state === "idle") {
      stage.classList.remove("active");
      stage.classList.add("idle");
      votingContainer.classList.add("hidden");
      verdictStamp.classList.add("hidden");
      objectionBanner.classList.add("hidden");
      return;
    }

    stage.classList.remove("idle");
    stage.classList.add("active");

    if (payload.case_title) caseTitle.textContent = payload.case_title;
    if (payload.charge) dialogText.textContent = "Обвинение: " + payload.charge;

    if (payload.state === "voting") {
      votingContainer.classList.remove("hidden");
    } else {
      votingContainer.classList.add("hidden");
    }
  }

  function handleVotingUpdate(payload) {
    guiltyCount.textContent = payload.guilty_count;
    innocentCount.textContent = payload.innocent_count;
    voteTimer.textContent = payload.time_left_sec + "с";

    const total = payload.guilty_count + payload.innocent_count;
    if (total > 0) {
      const gPct = Math.round((payload.guilty_count / total) * 100);
      guiltyFill.style.width = gPct + "%";
      innocentFill.style.width = (100 - gPct) + "%";
    }
  }

  function handleVerdict(payload) {
    stampText.textContent = payload.verdict;
    if (payload.verdict === "НЕВИНОВЕН") {
      stampText.classList.add("innocent");
    } else {
      stampText.classList.remove("innocent");
    }

    verdictStamp.classList.remove("hidden");
    triggerDeskSlam();
    setTimeout(() => {
      verdictStamp.classList.add("hidden");
    }, 5000);
  }

  function handlePanic() {
    audioQueue.length = 0;
    isPlayingAudio = false;
    sprite.classList.remove("talking");
    stage.classList.remove("active");
    stage.classList.add("idle");
    verdictStamp.classList.add("hidden");
    objectionBanner.classList.add("hidden");
  }

  function connect() {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(protocol + "//" + location.host + "/ws");

    ws.onmessage = handleMessage;
    ws.onclose = () => {
      setTimeout(connect, 2000);
    };
  }

  window.addEventListener("click", () => {
    getAudioContext();
  }, { once: true });

  connect();
})();
