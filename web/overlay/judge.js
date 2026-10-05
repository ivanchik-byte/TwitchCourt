"use strict";
(function () {
    function el(id) {
        const node = document.getElementById(id);
        if (!node)
            throw new Error("missing node #" + id);
        return node;
    }
    const img = el("judge");
    let bangTimer = 0;
    let talkTimer = 0;
    function startTalking() {
        img.classList.add("talking");
        window.clearTimeout(talkTimer);
        // no speech-end event on the socket: stop bouncing after 6s of silence
        talkTimer = window.setTimeout(stopTalking, 6000);
    }
    function stopTalking() {
        window.clearTimeout(talkTimer);
        img.classList.remove("talking");
    }
    function slam() {
        img.classList.remove("bang");
        void img.offsetWidth;
        img.classList.add("bang");
        window.clearTimeout(bangTimer);
        bangTimer = window.setTimeout(() => img.classList.remove("bang"), 700);
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
            if (msg.type === "subtitles" || msg.type === "audio_chunk") {
                startTalking();
            }
            else if (msg.type === "animation") {
                const name = (msg.payload && msg.payload.name) || "";
                if (name === "slam" || name === "desk_slam")
                    slam();
            }
            else if (msg.type === "verdict" ||
                msg.type === "panic" ||
                (msg.type === "state_change" && msg.payload?.state === "idle")) {
                stopTalking();
            }
        };
        ws.onclose = () => {
            window.setTimeout(connect, 2000);
        };
    }
    connect();
})();
