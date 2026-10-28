namespace Overlay {
  export type ServerEvent =
    | { type: "state_change"; payload: StateChange }
    | { type: "verdict"; payload: Verdict }
    | { type: "subtitles"; payload: Subtitles }
    | { type: "audio_chunk"; payload: AudioChunk }
    | { type: "animation"; payload: Animation }
    | { type: "donation"; payload: Donation }
    | { type: "testimony"; payload: Testimony }
    | { type: "panic"; payload: Record<string, unknown> };

  export interface StateChange {
    state: string;
    case_title?: string;
    defendant?: string;
    charge?: string;
    time_left_sec?: number;
    demo?: boolean;
    mode?: string;
    line?: string;
    verdict?: Verdict;
  }

  export interface Verdict {
    verdict: string;
    guilty_votes: number;
    total_votes: number;
    witnesses?: number;
    penalty?: string;
    twist?: string;
  }

  export interface Subtitles {
    speaker: string;
    text: string;
  }

  export interface AudioChunk {
    index: number;
    audio_base64: string;
    text: string;
    is_last: boolean;
  }

  export interface Animation {
    name: string;
    duration_ms?: number;
  }

  export interface Donation {
    donor: string;
    amount: number;
    currency: string;
    opens_trial: boolean;
  }

  export interface Testimony {
    author: string;
    text: string;
  }

}

  // link dot: green while frames arrive, red on silence or reconnect
  const link = document.createElement("div");
  link.textContent = "●";
  link.title = "связь с сервером";
  link.style.cssText =
    "position:fixed;right:8px;bottom:6px;z-index:99;font-size:12px;color:#ef4444;opacity:.8;pointer-events:none";
  document.body.appendChild(link);
  let lastFrame = 0;
  function markLive(ok: boolean): void {
    link.style.color = ok ? "#34d399" : "#ef4444";
  }

(function () {
  function el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error("missing node #" + id);
    return node as T;
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

  const phaseName = el("phase-name");
  const participant = el("participant");
  const speakerName = el("speaker-name");
  const verdictDetail = el("verdict-detail");
  let demoSession = false;
  let objectionTimer = 0;
  let briefCourtTimer = 0;
  let currentStageState = "idle";

  let audioEpoch = 0;
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let lipRaf = 0;
  const audioQueue: AudioBuffer[] = [];
  let playing = false;
  let currentSource: AudioBufferSourceNode | null = null;

  function ctx(): AudioContext {
    if (!audioCtx) {
      const Impl =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new Impl();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 512;
      analyser.connect(audioCtx.destination);
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  }

  function lipTick(): void {
    if (!analyser) return;
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (let i = 0; i < data.length; i++) {
      const v = (data[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / data.length);
    mouth.classList.toggle("open", rms > 0.02);
    if (playing) lipRaf = requestAnimationFrame(lipTick);
    else mouth.classList.remove("open");
  }

  function enqueueAudio(base64: string): void {
    const epoch = audioEpoch;
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ac = ctx();
    const copy = bytes.buffer.slice(0);
    ac.decodeAudioData(copy).then(
      (decoded) => {
        if (epoch !== audioEpoch) return;
        audioQueue.push(decoded);
        if (!playing) playNext();
      },
      () => undefined
    );
  }

  function playNext(): void {
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
    if (analyser) source.connect(analyser);
    else source.connect(ac.destination);
    source.onended = () => playNext();
    source.start();
    cancelAnimationFrame(lipRaf);
    lipRaf = requestAnimationFrame(lipTick);
  }

  function stopAudio(): void {
    audioEpoch += 1;
    audioQueue.length = 0;
    playing = false;
    try {
      currentSource?.stop();
    } catch {
      /* already ended */
    }
    currentSource = null;
    mouth.classList.remove("open");
  }

  function thump(when?: number): void {
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
    } catch {
      /* audio locked until first gesture */
    }
  }

  function coinPing(): void {
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
    } catch {
      /* audio locked until first gesture */
    }
  }

  // Short samples live in sfx/, missing files stay silent on purpose.
  function playSfx(name: string): void {
    if (demoSession) return;
    try {
      const audio = new Audio("sfx/" + name);
      audio.volume = 0.4;
      void audio.play().catch(() => undefined);
    } catch {
      /* no sample yet */
    }
  }

  function deskSlam(): void {
    slamVisual();
    if (!demoSession) thump();
    playSfx("gavel.mp3");
  }

  function slamVisual(): void {
    prosecutor.classList.remove("slam");
    void prosecutor.offsetWidth;
    prosecutor.classList.add("slam");
    stage.classList.remove("shake");
    void stage.offsetWidth;
    stage.classList.add("shake");
    window.setTimeout(() => stage.classList.remove("shake"), 300);
  }

  function showObjection(): void {
    objection.classList.remove("hidden");
    objection.classList.remove("show");
    void objection.offsetWidth;
    objection.classList.add("show");
    playSfx("objection.mp3");
    window.clearTimeout(objectionTimer);
    objectionTimer = window.setTimeout(() => objection.classList.add("hidden"), 1250);
  }

  function showVerdict(payload: Overlay.Verdict): void {
    const guilty = payload.verdict === "ВИНОВЕН";
    verdictText.textContent = payload.verdict;
    verdictDetail.textContent = payload.penalty || "";
    verdict.className = guilty ? "guilty" : "innocent";
    verdict.classList.remove("hidden");
    verdict.classList.remove("drop");
    void verdict.offsetWidth;
    verdict.classList.add("drop");
    stopCrowd();
    stopBgm();
    slamVisual();
    if (!demoSession) thump();
    playSfx("verdict.mp3");
  }

  function hideVerdict(): void {
    verdict.classList.add("hidden");
    verdict.classList.remove("drop");
  }

  function revealCourtBriefly(durationMs = 4500): void {
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

  let bgm: HTMLAudioElement | null = null;

  function startBgm(): void {
    if (demoSession) return;
    try {
      if (!bgm) {
        bgm = new Audio("sfx/bgm.mp3");
        bgm.loop = true;
        bgm.volume = 0.10;
      }
      void bgm.play().catch(() => undefined);
    } catch {
      /* no sample yet */
    }
  }

  function stopBgm(): void {
    try {
      if (bgm) bgm.pause();
    } catch {
      /* no sample yet */
    }
  }

  // Hushed crowd bed under the trial, cut on verdict for silence in the hall.
  let crowd: HTMLAudioElement | null = null;

  function startCrowd(): void {
    if (demoSession) return;
    try {
      if (!crowd) {
        crowd = new Audio("sfx/crowd.mp3");
        crowd.loop = true;
        crowd.volume = 0.08;
      }
      void crowd.play().catch(() => undefined);
    } catch {
      /* no sample yet */
    }
  }

  function stopCrowd(): void {
    try {
      if (crowd) {
        crowd.pause();
        crowd.currentTime = 0;
      }
    } catch {
      /* no sample yet */
    }
  }

  function resetStage(): void {
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

  function connect(): void {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(protocol + "//" + location.host + "/ws" + location.search);
    let pingTimer = 0;
    let staleTimer = 0;
    let stateEvents = 0;
    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: Overlay.ServerEvent;
      try {
        msg = JSON.parse(event.data) as Overlay.ServerEvent;
      } catch {
        return;
      }
      lastFrame = Date.now();
      markLive(true);
      if (msg.type === "state_change") stateEvents += 1;
      handleEvent(msg);
    };
    ws.onopen = () => {
      failures = 0;
      const revision = stateEvents;
      void fetch("/api/status" + location.search).then(async (response) => {
        if (!response.ok) return;
        const status = await response.json() as { trial?: Overlay.StateChange };
        if (revision !== stateEvents || ws.readyState !== WebSocket.OPEN || !status.trial) return;
        handleEvent({ type: "state_change", payload: status.trial });
        if (status.trial.line) handleEvent({ type: "subtitles", payload: { speaker: "Судья", text: status.trial.line } });
        if (status.trial.verdict) handleEvent({ type: "verdict", payload: status.trial.verdict });
      }).catch(() => markLive(false));
      lastFrame = Date.now();
      markLive(true);
      window.clearInterval(pingTimer);
      window.clearInterval(staleTimer);
      pingTimer = window.setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          try {
            ws.send(JSON.stringify({ action: "ping", payload: {} }));
          } catch {
            /* closed underneath */
          }
        }
      }, 15000);
      staleTimer = window.setInterval(() => {
        if (Date.now() - lastFrame > 30000) markLive(false);
      }, 5000);
    };
    ws.onclose = () => {
      window.clearInterval(pingTimer);
      window.clearInterval(staleTimer);
      markLive(false);
      failures += 1;
      const delay = Math.min(2000 * 2 ** failures, 30000) + Math.floor(Math.random() * 500);
      window.setTimeout(connect, delay);
    };
  }

  function handleEvent(msg: Overlay.ServerEvent): void {
    switch (msg.type) {
      case "state_change": {
        const state = String(msg.payload.state || "idle");
        currentStageState = state;
        if (typeof msg.payload.demo === "boolean") demoSession = msg.payload.demo;
        const labels: Record<string, string> = { indictment: "Открытие дела", testimony: "Показания", defense: "Слово ведущего", objection: "Ответ суда", deliberation: "Совещание", verdict: "Вердикт" };
        phaseName.textContent = labels[state] || "Заседание";
        if (msg.payload.defendant) participant.textContent = msg.payload.defendant;
        if (state === "indictment") {
          caseNo.textContent = demoSession ? "РЕПЕТИЦИЯ" : (msg.payload.case_title || "ЗАСЕДАНИЕ");
          subtitles.textContent = "";
        }
        if (state === "idle") {
          stopBgm();
          stopCrowd();
          resetStage();
        } else {
          window.clearTimeout(briefCourtTimer);
          court.classList.remove("hidden");
          startBgm();
          startCrowd();
          hideVerdict();
          testimony.classList.add("hidden");
          if (msg.payload.case_title) caseNo.textContent = msg.payload.case_title;
          if (msg.payload.charge) charge.textContent = "Обвинение: " + msg.payload.charge;
        }
        break;
      }
      case "subtitles":
        revealCourtBriefly();
        if (msg.payload.speaker) speakerName.textContent = msg.payload.speaker;
        if (msg.payload.text) subtitles.textContent = msg.payload.text;
        break;
      case "audio_chunk":
        revealCourtBriefly();
        if (!demoSession && msg.payload.audio_base64) enqueueAudio(msg.payload.audio_base64);
        if (msg.payload.text) subtitles.textContent = msg.payload.text;
        break;
      case "animation":
        if (msg.payload.name === "slam" || msg.payload.name === "desk_slam") {
          revealCourtBriefly();
          deskSlam();
        } else if (msg.payload.name === "objection") {
          showObjection();
        }
        break;
      case "verdict":
        showVerdict(msg.payload);
        break;
      case "donation":
        if (!demoSession) coinPing();
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
