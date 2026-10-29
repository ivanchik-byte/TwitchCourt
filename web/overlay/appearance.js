"use strict";
var CourtAppearance;
(function (CourtAppearance) {
    let appearance = null;
    let activeRole = "judge";
    function role(role) {
        activeRole = role;
        const portrait = document.querySelector("[data-judge-portrait]");
        if (!portrait || !appearance)
            return;
        const url = activeRole === "judge" ? appearance.photo_url : appearance.role_photos?.[activeRole] || appearance.photo_url;
        portrait.onload = () => document.body.classList.remove("portrait-unavailable");
        portrait.onerror = () => document.body.classList.add("portrait-unavailable");
        portrait.alt = activeRole === "prosecutor" ? "Прокурор" : activeRole === "advocate" ? "Адвокат" : "Судья";
        if (portrait.getAttribute("src") !== url)
            portrait.src = url;
    }
    CourtAppearance.role = role;
    function apply(settings) {
        appearance = settings;
        document.body.dataset.theme = settings.theme;
        document.body.dataset.reduceMotion = String(settings.reduce_motion);
        document.body.dataset.showJudge = String(settings.show_judge);
        role(activeRole);
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
