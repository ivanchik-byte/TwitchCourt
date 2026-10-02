namespace GooeyNav {
  const PARTICLE_COUNT = 8;
  const PARTICLE_DISTANCES: [number, number] = [90, 10];
  const PARTICLE_R = 100;
  const ANIMATION_TIME = 600;
  const TIME_VARIANCE = 300;
  const COLORS = [1, 2, 3, 1, 2, 3, 1, 4];

  function noise(n = 1): number {
    return n / 2 - Math.random() * n;
  }

  function pointOnCircle(distance: number, index: number, total: number): [number, number] {
    const angle = ((360 + noise(8)) / total) * index * (Math.PI / 180);
    return [distance * Math.cos(angle), distance * Math.sin(angle)];
  }

  export function mount(nav: HTMLElement): void {
    const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const list = nav.querySelector("ul");
    if (!list) return;
    const items = Array.from(list.querySelectorAll<HTMLLIElement>("li"));
    if (items.length === 0) return;

    const filter = document.createElement("span");
    filter.className = "effect filter";
    const text = document.createElement("span");
    text.className = "effect text";
    nav.appendChild(filter);
    nav.appendChild(text);

    let activeIndex = Math.max(
      0,
      items.findIndex((item) => item.classList.contains("active"))
    );

    function placeEffect(element: HTMLLIElement): void {
      const box = nav.getBoundingClientRect();
      const pos = element.getBoundingClientRect();
      const styles = {
        left: pos.x - box.x + "px",
        top: pos.y - box.y + "px",
        width: pos.width + "px",
        height: pos.height + "px",
      };
      Object.assign(filter.style, styles);
      Object.assign(text.style, styles);
      text.innerText = element.innerText;
    }

    function burst(element: HTMLElement): void {
      if (reduceMotion) return;
      const bubbleTime = ANIMATION_TIME * 2 + TIME_VARIANCE;
      element.style.setProperty("--time", bubbleTime + "ms");
      for (let i = 0; i < PARTICLE_COUNT; i++) {
        const duration = ANIMATION_TIME * 2 + noise(TIME_VARIANCE * 2);
        const [sx, sy] = pointOnCircle(PARTICLE_DISTANCES[0], PARTICLE_COUNT - i, PARTICLE_COUNT);
        const [ex, ey] = pointOnCircle(PARTICLE_DISTANCES[1] + noise(7), PARTICLE_COUNT - i, PARTICLE_COUNT);
        let rotate = noise(PARTICLE_R / 10);
        rotate = rotate > 0 ? (rotate + PARTICLE_R / 20) * 10 : (rotate - PARTICLE_R / 20) * 10;
        const color = COLORS[Math.floor(Math.random() * COLORS.length)];
        const scale = 1 + noise(0.2);
        window.setTimeout(() => {
          const particle = document.createElement("span");
          particle.className = "particle";
          particle.style.setProperty("--start-x", sx + "px");
          particle.style.setProperty("--start-y", sy + "px");
          particle.style.setProperty("--end-x", ex + "px");
          particle.style.setProperty("--end-y", ey + "px");
          particle.style.setProperty("--time", duration + "ms");
          particle.style.setProperty("--scale", String(scale));
          particle.style.setProperty("--color", "var(--color-" + color + ", white)");
          particle.style.setProperty("--rotate", rotate + "deg");
          const point = document.createElement("span");
          point.className = "point";
          particle.appendChild(point);
          element.appendChild(particle);
          requestAnimationFrame(() => element.classList.add("active"));
          window.setTimeout(() => {
            try {
              element.removeChild(particle);
            } catch {
              /* already gone */
            }
          }, duration);
        }, 30);
      }
    }

    function activate(index: number): void {
      if (index === activeIndex) return;
      activeIndex = index;
      items.forEach((item, i) => item.classList.toggle("active", i === index));
      const current = items[index];
      placeEffect(current);
      filter.querySelectorAll(".particle").forEach((p) => {
        try {
          filter.removeChild(p);
        } catch {
          /* already gone */
        }
      });
      text.classList.remove("active");
      void text.offsetWidth;
      text.classList.add("active");
      burst(filter);
    }

    items.forEach((item, index) => {
      const link = item.querySelector("a");
      if (!link) return;
      link.addEventListener("click", (event) => {
        const target = link.getAttribute("data-target");
        const href = link.getAttribute("href");
        if (target) {
          event.preventDefault();
          activate(index);
          const node = document.getElementById(target);
          if (node) node.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "start" });
          return;
        }
        if (href && href !== "#") {
          event.preventDefault();
          activate(index);
          window.setTimeout(() => {
            window.location.href = href;
          }, 220);
        }
      });
    });

    placeEffect(items[activeIndex]);
    text.classList.add("active");

    const observer = new ResizeObserver(() => placeEffect(items[activeIndex]));
    observer.observe(nav);
    window.addEventListener("load", () => placeEffect(items[activeIndex]));
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(() => placeEffect(items[activeIndex])).catch(() => undefined);
    }
  }
}
