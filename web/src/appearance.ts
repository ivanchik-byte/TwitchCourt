namespace CourtAppearance {
  export interface Settings {
    role_photos?: Record<string,string>;
    theme: string;
    judge_preset: string;
    show_judge: boolean;
    reduce_motion: boolean;
    photo_url: string;
    background_url: string;
  }

  let appearance: Settings | null = null;
  let activeRole = "judge";
  export function role(role: string): void {
    activeRole = role;
    const portrait = document.querySelector<HTMLImageElement>("[data-judge-portrait]");
    if (!portrait || !appearance) return;
    const url = activeRole === "judge" ? appearance.photo_url : appearance.role_photos?.[activeRole] || appearance.photo_url;
    portrait.onload = () => document.body.classList.remove("portrait-unavailable");
    portrait.onerror = () => document.body.classList.add("portrait-unavailable");
    portrait.alt = activeRole === "prosecutor" ? "Прокурор" : activeRole === "advocate" ? "Адвокат" : "Судья";
    if (portrait.getAttribute("src") !== url) portrait.src = url;
  }

  export function apply(settings: Settings): void {
    appearance = settings;
    document.body.dataset.theme = settings.theme;
    document.body.dataset.reduceMotion = String(settings.reduce_motion);
    document.body.dataset.showJudge = String(settings.show_judge);
    role(activeRole);
    const backdrop = document.getElementById("court-bg") as HTMLImageElement | null;
    if (backdrop && backdrop.getAttribute("src") !== settings.background_url) backdrop.src = settings.background_url;
  }

  export async function refresh(): Promise<void> {
    const response = await fetch("/api/appearance", { cache: "no-store" });
    if (!response.ok) throw new Error("appearance unavailable: " + response.status);
    apply(await response.json() as Settings);
  }
}
