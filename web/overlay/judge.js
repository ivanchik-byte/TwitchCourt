"use strict";
(function () {
    function el(id) {
        const node = document.getElementById(id);
        if (!node)
            throw new Error("missing node #" + id);
        return node;
    }
    const img = el("judge");
    let timer = 0;
    function setJudge(state, flashMs = 0) {
        img.src = "/api/judge/photo?state=" + state + "&t=" + Date.now();
        img.classList.remove("bang");
        void img.offsetWidth;
        if (state === "gavel")
            img.classList.add("bang");
        window.clearTimeout(timer);
        if (flashMs > 0) {
            timer = window.setTimeout(() => {
                img.classList.remove("bang");
                img.src = "/api/judge/photo?state=normal&t=" + Date.now();
            }, flashMs);
        }
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
            if (msg.type === "animation") {
                const name = (msg.payload && msg.payload.name) || "";
                if (name === "slam" || name === "desk_slam")
                    setJudge("gavel", 900);
            }
            else if (msg.type === "verdict") {
                setJudge("angry", 2500);
            }
            else if (msg.type === "state_change" || msg.type === "panic") {
                setJudge("normal");
            }
        };
        ws.onclose = () => {
            window.setTimeout(connect, 2000);
        };
    }
    connect();
})();
