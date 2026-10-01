// Shared wire protocol, inlined per page so each bundle stays dependency-free.
namespace Tribunal {
  export type ServerEvent =
    | { type: "state_change"; payload: StateChange }
    | { type: "subtitles"; payload: Subtitles }
    | { type: "audio_chunk"; payload: AudioChunk }
    | { type: "animation"; payload: Animation }
    | { type: "voting_update"; payload: VotingUpdate }
    | { type: "verdict"; payload: Verdict }
    | { type: "panic"; payload: Record<string, unknown> };

  export interface StateChange {
    state: string;
    case_title?: string;
    defendant?: string;
    charge?: string;
    time_left_sec?: number;
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

  export interface VotingUpdate {
    guilty_count: number;
    innocent_count: number;
    time_left_sec: number;
  }

  export interface Verdict {
    verdict: string;
    guilty_votes: number;
    total_votes: number;
    penalty?: string;
  }

  export interface StreamerProfile {
    name: string;
    titles?: string[];
    traits?: string[];
    running_gags?: string[];
    mercy?: string;
  }

  export interface TrialRecord {
    defendant: string;
    crime: string;
    verdict: string;
    guilty: number;
    innocent: number;
  }

  export interface Accuser {
    name: string;
    sue_calls: number;
    votes: number;
  }

  export interface CourtSettings {
    min_amounts: Record<string, number>;
    default_min: number;
    punishments: string[];
  }

  export function socketUrl(path: string): string {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    return protocol + "//" + location.host + path;
  }

  export function parseEvent(raw: string): ServerEvent | null {
    try {
      return JSON.parse(raw) as ServerEvent;
    } catch {
      return null;
    }
  }

  export function splitLines(value: string): string[] {
    return value
      .split("\n")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  export function splitList(value: string): string[] {
    return value
      .split(",")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
  }

  export function joinList(items: string[] | undefined): string {
    return Array.isArray(items) ? items.join(", ") : "";
  }
}

// OBS courtroom overlay: poses, voice bus with room DSP, responsive scaling.
(function () {
  const STAGE_W = 1920;
  const STAGE_H = 1080;

  function el<T extends HTMLElement>(id: string): T {
    const node = document.getElementById(id);
    if (!node) throw new Error("missing node #" + id);
    return node as T;
  }

  function maybe<T extends HTMLElement>(id: string): T | null {
    return document.getElementById(id) as T | null;
  }

  const stage = el("court-stage");
  const dialogText = el("dialog-text");
  const speakerName = el("speaker-name");
  const caseBadge = el("case-badge");
  const objectionBanner = el("objection-banner");
  const speedLines = el("speed-lines");
  const verdictStamp = el("verdict-stamp");
  const stampSeal = el("stamp-seal");
  const stampText = el("stamp-text");
  const votingContainer = el("voting-bar-container");
  const guiltyCount = el("guilty-count");
  const innocentCount = el("innocent-count");
  const voteTimer = el("vote-timer");
  const guiltyFill = el("guilty-fill");
  const innocentFill = el("innocent-fill");
  const poseConfident = el("pose-confident");
  const poseObjection = el("pose-objection");
  const poseSlam = el("pose-slam");
  const mouths = document.querySelectorAll(".prosecutor-mouth");

  type Pose = "confident" | "objection" | "slam";
  let currentPose: Pose = "confident";
  let poseTimer: number | null = null;

  function setPose(pose: Pose, lockMs?: number): void {
    if (poseTimer !== null) {
      window.clearTimeout(poseTimer);
      poseTimer = null;
    }
    poseConfident.classList.remove("active");
    poseObjection.classList.remove("active");
    poseSlam.classList.remove("active");
    if (pose === "objection") poseObjection.classList.add("active");
    else if (pose === "slam") poseSlam.classList.add("active");
    else poseConfident.classList.add("active");
    currentPose = pose;
    if (lockMs) {
      poseTimer = window.setTimeout(() => setPose("confident"), lockMs);
    }
  }

  // The fixed scene scales to any source size without reflow.
  // zoom keeps layout scaling clear of the rumble transform on the stage.
  function fitStage(): void {
    const scale = Math.min(window.innerWidth / STAGE_W, window.innerHeight / STAGE_H);
    (document.body.style as CSSStyleDeclaration & { zoom: string }).zoom = String(scale);
  }
  window.addEventListener("resize", fitStage);

  let audioCtx: AudioContext | null = null;
  let voiceBus: GainNode | null = null;
  const audioQueue: AudioBuffer[] = [];
  let playing = false;

  function ctx(): AudioContext {
    if (!audioCtx) {
      const Impl =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      audioCtx = new Impl();
      voiceBus = buildVoiceBus(audioCtx);
    }
    if (audioCtx.state === "suspended") void audioCtx.resume();
    return audioCtx;
  }

  // Courtroom voice bus: highpass -> box cut -> presence -> glue -> dry + room.
  function buildVoiceBus(ac: AudioContext): GainNode {
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

  function makeRoomImpulse(ac: AudioContext): AudioBuffer {
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

  function gavelHit(when?: number): void {
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

    const sub = ac.createOscillator();
    sub.type = "sine";
    sub.frequency.setValueAtTime(130, t);
    sub.frequency.exponentialRampToValueAtTime(40, t + 0.07);
    const subGain = ac.createGain();
    subGain.gain.setValueAtTime(0.9, t);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.15);
    sub.connect(subGain);
    subGain.connect(ac.destination);
    sub.start(t);
    sub.stop(t + 0.16);
  }

  function objectionStinger(when?: number): void {
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
      osc.frequency.exponentialRampToValueAtTime(freq * 0.985, t + 0.08);
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

    const bell = ac.createOscillator();
    bell.type = "sine";
    bell.frequency.setValueAtTime(1760, t);
    const bellGain = ac.createGain();
    bellGain.gain.setValueAtTime(0.15, t);
    bellGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.9);
    bell.connect(bellGain);
    bellGain.connect(bus);
    bell.start(t);
    bell.stop(t + 0.95);
  }

  function setMouthTalking(talking: boolean): void {
    mouths.forEach((m) => {
      if (talking) m.classList.add("mouth-talking");
      else m.classList.remove("mouth-talking");
    });
  }

  function enqueueAudio(base64: string): void {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const ac = ctx();
    ac.decodeAudioData(
      bytes.buffer.slice(0),
      (decoded) => {
        audioQueue.push(decoded);
        if (!playing) playNext();
      },
      () => undefined
    );
  }

  function playNext(): void {
    if (audioQueue.length === 0) {
      playing = false;
      setMouthTalking(false);
      return;
    }
    playing = true;
    setMouthTalking(true);
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

  function deskSlam(): void {
    setPose("slam", 500);
    stage.classList.add("screen-rumble");
    gavelHit();
    window.setTimeout(() => stage.classList.remove("screen-rumble"), 400);
  }

  function objection(): void {
    setPose("objection", 1200);
    objectionStinger();
    objectionBanner.classList.remove("hidden");
    speedLines.classList.remove("hidden");
    stage.classList.add("screen-rumble");
    window.setTimeout(() => {
      stage.classList.remove("screen-rumble");
      speedLines.classList.add("hidden");
    }, 450);
    window.setTimeout(() => objectionBanner.classList.add("hidden"), 1200);
  }

  function onStateChange(payload: Tribunal.StateChange): void {
    if (payload.state === "idle") {
      stage.classList.remove("active");
      stage.classList.add("idle");
      votingContainer.classList.add("hidden");
      verdictStamp.classList.add("hidden");
      objectionBanner.classList.add("hidden");
      speedLines.classList.add("hidden");
      setPose("confident");
      return;
    }
    stage.classList.remove("idle");
    stage.classList.add("active");
    if (payload.case_title) caseBadge.textContent = payload.case_title;
    if (payload.charge) dialogText.textContent = "Обвинение: " + payload.charge;
    if (payload.state === "voting") {
      votingContainer.classList.remove("hidden");
      setPose("confident");
    } else {
      votingContainer.classList.add("hidden");
    }
  }

  function onVoting(payload: Tribunal.VotingUpdate): void {
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

  function onVerdict(payload: Tribunal.Verdict): void {
    const innocent = payload.verdict === "НЕВИНОВЕН";
    stampText.textContent = payload.verdict;
    stampSeal.className = "stamp-seal " + (innocent ? "innocent" : "guilty");
    const penalty = maybe("stamp-penalty");
    if (penalty) {
      if (!innocent && payload.penalty) {
        penalty.textContent = "Наказание: " + payload.penalty;
        penalty.classList.remove("hidden");
      } else {
        penalty.textContent = "";
        penalty.classList.add("hidden");
      }
    }
    verdictStamp.classList.remove("hidden");
    if (!innocent) deskSlam();
    else setPose("confident");
    window.setTimeout(() => verdictStamp.classList.add("hidden"), 5500);
  }

  function resetStage(): void {
    audioQueue.length = 0;
    playing = false;
    setMouthTalking(false);
    stage.classList.remove("active");
    stage.classList.add("idle");
    verdictStamp.classList.add("hidden");
    objectionBanner.classList.add("hidden");
    speedLines.classList.add("hidden");
    setPose("confident");
  }

  function connect(): void {
    const ws = new WebSocket(Tribunal.socketUrl("/ws"));
    ws.onmessage = (event: MessageEvent<string>) => {
      const msg = Tribunal.parseEvent(event.data);
      if (!msg) return;
      switch (msg.type) {
        case "state_change":
          onStateChange(msg.payload);
          break;
        case "subtitles":
          if (msg.payload.speaker) speakerName.textContent = msg.payload.speaker;
          if (msg.payload.text) dialogText.textContent = msg.payload.text;
          break;
        case "audio_chunk":
          if (msg.payload.audio_base64) enqueueAudio(msg.payload.audio_base64);
          if (msg.payload.text) dialogText.textContent = msg.payload.text;
          break;
        case "animation":
          if (msg.payload.name === "slam" || msg.payload.name === "desk_slam") deskSlam();
          else if (msg.payload.name === "objection") objection();
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
