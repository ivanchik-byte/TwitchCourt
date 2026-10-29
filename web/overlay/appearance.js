"use strict";
var CourtAppearance;
(function (CourtAppearance) {
    function apply(settings) {
        document.body.dataset.theme = settings.theme;
        document.body.dataset.reduceMotion = String(settings.reduce_motion);
        document.body.dataset.showJudge = String(settings.show_judge);
        const portrait = document.querySelector("[data-judge-portrait]");
        if (portrait) {
            portrait.onload = () => document.body.classList.remove("portrait-unavailable");
            portrait.onerror = () => document.body.classList.add("portrait-unavailable");
            if (portrait.getAttribute("src") !== settings.photo_url)
                portrait.src = settings.photo_url;
        }
        const backdrop = document.getElementById("court-bg");
        if (backdrop && backdrop.getAttribute("src") !== settings.background_url)
            backdrop.src = settings.background_url;
    }
    CourtAppearance.apply = apply;
    async function refresh() {
        const response = await fetch("/api/appearance", { cache: "no-store" });
        if (!response.ok)
            throw new Error("appearance unavailable: " + response.status);
        apply(await response.json());
    }
    CourtAppearance.refresh = refresh;
})(CourtAppearance || (CourtAppearance = {}));
