namespace CourtAppearance {
  export interface Settings {
    theme: string;
    judge_preset: string;
    show_judge: boolean;
    reduce_motion: boolean;
    photo_url: string;
    background_url: string;
  }

  export function apply(settings: Settings): void {
    document.body.dataset.theme = settings.theme;
    document.body.dataset.reduceMotion = String(settings.reduce_motion);
    document.body.dataset.showJudge = String(settings.show_judge);
    const portrait = document.querySelector<HTMLImageElement>("[data-judge-portrait]");
    if (portrait) {
      portrait.onload = () => document.body.classList.remove("portrait-unavailable");
      portrait.onerror = () => document.body.classList.add("portrait-unavailable");
      if (portrait.getAttribute("src") !== settings.photo_url) portrait.src = settings.photo_url;
    }
    const backdrop = document.getElementById("court-bg") as HTMLImageElement | null;
    if (backdrop && backdrop.getAttribute("src") !== settings.background_url) backdrop.src = settings.background_url;
  }

  export async function refresh(): Promise<void> {
    const response = await fetch("/api/appearance", { cache: "no-store" });
    if (!response.ok) throw new Error("appearance unavailable: " + response.status);
    apply(await response.json() as Settings);
  }
}
