// OBS overlay client: transparent stage, lipsynced actor, gauges, seals.
namespace Overlay {
  export type ServerEvent =
    | { type: "state_change"; payload: StateChange }
    | { type: "voting_update"; payload: VotingUpdate }
    | { type: "verdict"; payload: Verdict }
    | { type: "subtitles"; payload: Subtitles }
    | { type: "audio_chunk"; payload: AudioChunk }
    | { type: "animation"; payload: Animation }
    | { type: "donation"; payload: Donation }
    | { type: "suspicion"; payload: Suspicion }
    | { type: "panic"; payload: Record<string, unknown> };

  export interface StateChange {
    state: string;
    case_title?: string;
    defendant?: string;
    charge?: string;
    time_left_sec?: number;
  }

  export interface VotingUpdate {
    guilty_count: number;
    innocent_count: number;
    time_left_sec: number;
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

  export interface Suspicion {
    meter: number;
    milestone: number;
  }
}

(function () {
  function el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error("missing node #" + id);
    return node as T;
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
  let briefCourtTimer = 0;
  let currentStageState = "idle";

  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let lipRaf = 0;
  const audioQueue: AudioBuffer[] = [];
  let playing = false;

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
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ac = ctx();
    const copy = bytes.buffer.slice(0);
    ac.decodeAudioData(copy).then(
      (decoded) => {
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
      mouth.classList.remove("open");
      return;
    }
    playing = true;
    const ac = ctx();
    const source = ac.createBufferSource();
    source.buffer = buffer;
    if (analyser) source.connect(analyser);
    else source.connect(ac.destination);
    source.onended = () => playNext();
    source.start();
    cancelAnimationFrame(lipRaf);
    lipRaf = requestAnimationFrame(lipTick);
  }

  function stopAudio(): void {
    audioQueue.length = 0;
    playing = false;
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

  function deskSlam(): void {
    prosecutor.classList.remove("slam");
    void prosecutor.offsetWidth;
    prosecutor.classList.add("slam");
    stage.classList.remove("shake");
    void stage.offsetWidth;
    stage.classList.add("shake");
    thump();
    window.setTimeout(() => stage.classList.remove("shake"), 300);
  }

  function showObjection(): void {
    objection.classList.remove("hidden");
    objection.classList.remove("show");
    void objection.offsetWidth;
    objection.classList.add("show");
    window.clearTimeout(objectionTimer);
    objectionTimer = window.setTimeout(() => objection.classList.add("hidden"), 1250);
  }

  function showTeaser(meter: number): void {
    teaserNum.textContent = "404";
    teaserFill.style.width = meter + "%";
    caseTeaser.classList.remove("hidden");
    window.clearTimeout(teaserTimer);
    teaserTimer = window.setTimeout(() => caseTeaser.classList.add("hidden"), 2000);
  }

  function showVerdict(payload: Overlay.Verdict): void {
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

  function resetStage(): void {
    currentStageState = "idle";
    window.clearTimeout(briefCourtTimer);
    stopAudio();
    court.classList.add("hidden");
    gauge.classList.add("hidden");
    hideVerdict();
    objection.classList.add("hidden");
    caseTeaser.classList.add("hidden");
  }

  function connect(): void {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const ws = new WebSocket(protocol + "//" + location.host + "/ws");
    ws.onmessage = (event: MessageEvent<string>) => {
      let msg: Overlay.ServerEvent;
      try {
        msg = JSON.parse(event.data) as Overlay.ServerEvent;
      } catch {
        return;
      }
      handleEvent(msg);
    };
    ws.onclose = () => {
      window.setTimeout(connect, 2000);
    };
  }

  function handleEvent(msg: Overlay.ServerEvent): void {
    switch (msg.type) {
      case "state_change": {
        const state = String(msg.payload.state || "idle");
        currentStageState = state;
        if (state === "idle") {
          resetStage();
        } else {
          window.clearTimeout(briefCourtTimer);
          court.classList.remove("hidden");
          hideVerdict();
          if (msg.payload.case_title) caseNo.textContent = msg.payload.case_title;
          if (msg.payload.charge) charge.textContent = "Обвинение: " + msg.payload.charge;
          if (state === "voting") gauge.classList.remove("hidden");
          else gauge.classList.add("hidden");
        }
        break;
      }
      case "subtitles":
        revealCourtBriefly();
        if (msg.payload.text) subtitles.textContent = msg.payload.text;
        break;
      case "audio_chunk":
        revealCourtBriefly();
        if (msg.payload.audio_base64) enqueueAudio(msg.payload.audio_base64);
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
