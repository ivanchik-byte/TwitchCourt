namespace Overlay {
  export type ServerEvent =
    | { type: "state_change"; payload: StateChange }
    | { type: "verdict"; payload: Verdict }
    | { type: "subtitles"; payload: Subtitles }
    | { type: "audio_chunk"; payload: AudioChunk }
    | { type: "animation"; payload: Animation }
    | { type: "donation"; payload: Donation }
    | { type: "testimony"; payload: Testimony }
    | { type: "appearance_change"; payload: CourtAppearance.Settings }
    | { type: "exhibit"; payload: { title: string; text: string } }
    | { type: "jury"; payload: Jury }
    | { type: "panic"; payload: Record<string, unknown> };

  export interface StateChange {
    role?: string;
    speaker?: string;
    state: string;
    case_title?: string;
    defendant?: string;
    charge?: string;
    time_left_sec?: number;
    demo?: boolean;
    mode?: string;
    line?: string;
    verdict?: Verdict;
    exhibits?: { title: string; text: string; revealed: boolean }[];
    jury?: Jury;
  }

  export interface JuryRound {
    id: string;
    number: number;
    status: "open" | "closed";
    closes_at_ms?: number;
    total: number;
    guilty?: number;
    innocent?: number;
  }

  export interface Jury {
    epoch: string;
    revision: number;
    open_round: number;
    first?: JuryRound;
    second?: JuryRound;
    comparison?: { compared: number; changed: number };
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
    role?: string;
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
  const judgePortrait = el("judge-portrait");
  const caseNo = el("case-no");
  const charge = el("charge");
  const subtitles = el("subtitles");
  const testimony = el("testimony");
  const testimonyAuthor = el("testimony-author");
  const testimonyText = el("testimony-text");
  const objection = el("objection");
  const verdict = el("verdict");
  const verdictText = el("verdict-text");
  const juryPanel = el("jury");
  let lastJury: Overlay.Jury | null = null;
  let juryClock = 0;

  const phaseName = el("phase-name");
  const participant = el("participant");
  const speakerName = el("speaker-name");
  const verdictDetail = el("verdict-detail");
  let demoSession = false;
  let objectionTimer = 0;
  let briefCourtTimer = 0;
  let currentStageState = "idle";
  const preview = new URLSearchParams(location.search).get("preview") === "1";
  if (preview) link.remove();

  function showJury(view: Overlay.Jury): void {
    if (lastJury?.epoch === view.epoch && lastJury.revision > view.revision) view = lastJury;
    lastJury = view;
    window.clearInterval(juryClock);
    juryPanel.replaceChildren();
    const visible = !!view.first && currentStageState !== "idle";
    juryPanel.classList.toggle("hidden", !visible);
    document.body.classList.toggle("jury-visible", visible);
    if (!visible) return;
    const heading = document.createElement("div");
    heading.className = "jury-heading";
    heading.textContent = "МНЕНИЕ ПРИСЯЖНЫХ";
    juryPanel.appendChild(heading);
    const open = view.open_round === 1 ? view.first : view.open_round === 2 ? view.second : undefined;
    if (open) {
      const title = document.createElement("p");
      title.className = "jury-prompt";
      title.textContent = "Виновен или невиновен?";
      const commands = document.createElement("p");
      commands.className = "jury-commands";
      commands.textContent = "!vote 1 — виновен     !vote 2 — невиновен";
      const status = document.createElement("p");
      status.className = "jury-status";
      const tick = () => {
        const left = Math.max(0, Math.ceil(((open.closes_at_ms ?? 0) - Date.now()) / 1000));
        status.textContent = `Голосов: ${open.total} · ${left > 0 ? left + " сек." : "подсчёт…"}`;
      };
      tick();
      juryClock = window.setInterval(tick, 250);
      juryPanel.append(title, commands, status);
    }
    for (const round of [view.first, view.second]) {
      if (!round || round.status !== "closed") continue;
      const row = document.createElement("div");
      row.className = "jury-result";
      const title = document.createElement("p");
      title.textContent = `${round.number === 1 ? "До защиты" : "После обсуждения"} · голосов: ${round.total}`;
      row.appendChild(title);
      if (round.total > 0) {
        const guilty = Math.round((round.guilty ?? 0) * 100 / round.total);
        const bar = document.createElement("div");
        bar.className = "jury-bar";
        const fill = document.createElement("span");
        fill.style.width = guilty + "%";
        bar.appendChild(fill);
        const counts = document.createElement("p");
        counts.className = "jury-counts";
        counts.textContent = `Виновен ${guilty}% (${round.guilty}) · Невиновен ${100 - guilty}% (${round.innocent})`;
        row.append(bar, counts);
      } else {
        const empty = document.createElement("p");
        empty.className = "jury-counts";
        empty.textContent = "Никто не проголосовал";
        row.appendChild(empty);
      }
      juryPanel.appendChild(row);
    }
    if (view.comparison) {
      const summary = document.createElement("p");
      summary.className = "jury-comparison";
      summary.textContent = view.comparison.compared > 0 ? `Изменили решение: ${view.comparison.changed} из ${view.comparison.compared}, голосовавших оба раза` : "Никто не проголосовал оба раза";
      juryPanel.appendChild(summary);
    }
  }

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
    judgePortrait.classList.toggle("is-speaking", rms > 0.02);
    if (playing) lipRaf = requestAnimationFrame(lipTick);
    else { mouth.classList.remove("open"); judgePortrait.classList.remove("is-speaking"); }
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
      judgePortrait.classList.remove("is-speaking");
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
    judgePortrait.classList.remove("is-speaking");
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
      void CourtAppearance.refresh().catch(() => console.warn("Не удалось обновить оформление сцены."));
      const revision = stateEvents;
      void fetch("/api/status" + location.search).then(async (response) => {
        if (!response.ok) return;
        const status = await response.json() as { trial?: Overlay.StateChange };
        if (revision !== stateEvents || ws.readyState !== WebSocket.OPEN || !status.trial) return;
        handleEvent({ type: "state_change", payload: status.trial });
        if (status.trial.jury) showJury(status.trial.jury);
        if (status.trial.line) handleEvent({ type: "subtitles", payload: { role: status.trial.role, speaker: status.trial.speaker || "Судья", text: status.trial.line } });
        if (status.trial.verdict) handleEvent({ type: "verdict", payload: status.trial.verdict });
        const exhibit = status.trial.exhibits?.filter(entry => entry.revealed).slice(-1)[0];
        if (exhibit && status.trial.state !== "idle") handleEvent({ type: "exhibit", payload: exhibit });
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
      case "jury":
        showJury(msg.payload);
        break;
      case "appearance_change":
        CourtAppearance.apply(msg.payload);
        break;
      case "exhibit":
        testimonyAuthor.textContent = "Улика · " + msg.payload.title;
        testimonyText.textContent = msg.payload.text;
        testimony.classList.remove("hidden");
        break;
      case "state_change": {
        const state = String(msg.payload.state || "idle");
        currentStageState = state;
        if (typeof msg.payload.demo === "boolean") demoSession = msg.payload.demo;
        const labels: Record<string, string> = { indictment: "Открытие дела", testimony: "Показания", defense: "Слово ведущего", objection: "Ответ суда", jury: "Мнение присяжных", deliberation: "Совещание", verdict: "Вердикт" };
        phaseName.textContent = labels[state] || "Заседание";
        if (msg.payload.defendant) participant.textContent = msg.payload.defendant;
        if (state === "indictment") {
          caseNo.textContent = demoSession ? "РЕПЕТИЦИЯ" : (msg.payload.case_title || "ЗАСЕДАНИЕ");
          subtitles.textContent = "";
        }
        if (state === "idle") {
          window.clearInterval(juryClock);
          lastJury = null;
          juryPanel.classList.add("hidden");
          document.body.classList.remove("jury-visible");
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
        if (msg.payload.jury) showJury(msg.payload.jury);
        const revealed = msg.payload.exhibits?.filter(entry => entry.revealed).slice(-1)[0];
        if (revealed && state !== "idle") handleEvent({ type: "exhibit", payload: revealed });
        break;
      }
      case "subtitles":
        revealCourtBriefly();
        CourtAppearance.role(msg.payload.role || "judge");
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
        window.clearInterval(juryClock);
        lastJury = null;
        juryPanel.classList.add("hidden");
        document.body.classList.remove("jury-visible");
        stopBgm();
        resetStage();
        break;
      default:
        break;
    }
  }

  if (preview) {
    const showPreview = (phase: string): void => {
      resetStage();
      handleEvent({ type: "state_change", payload: { state: phase, demo: true, defendant: "night_viewer", case_title: "ЧЕТЫРЕ ЧАСА ДО СНА", charge: "Объявил, что идёт спать, и ещё четыре часа давал советы в чате." } });
      handleEvent({ type: "subtitles", payload: { speaker: "Судья", text: "Подсудимый, суд ознакомился с вашим «я на пять минут». Прошло четыре часа." } });
      if (phase === "testimony") handleEvent({ type: "testimony", payload: { author: "Свидетель из чата", text: "Он ещё дважды пожелал всем спокойной ночи." } });
      if (phase === "verdict") handleEvent({ type: "verdict", payload: { verdict: "ОПРАВДАН", guilty_votes: 0, total_votes: 1, penalty: "Нёс ночную вахту и спасал прохождение." } });
    };
    window.addEventListener("message", (event: MessageEvent) => {
      if (event.origin !== location.origin || event.source !== window.parent || event.data?.type !== "tribunal-preview") return;
      const settings = event.data.appearance as CourtAppearance.Settings;
      CourtAppearance.apply({ ...settings, photo_url: "/api/judge/photo?preset=" + encodeURIComponent(settings.judge_preset) + "&v=" + event.data.mediaTick });
      showPreview(event.data.phase);
    });
    if (window.parent === window) void CourtAppearance.refresh().catch(() => console.warn("Предпросмотр использует стандартное оформление."));
    showPreview("indictment");
  } else {
    window.addEventListener("click", () => ctx(), { once: true });
    connect();
  }
})();
