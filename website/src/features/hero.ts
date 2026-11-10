import hiFrame01 from "../../../src/cat/assets/default/hi/frame-01.png";
import hiFrame02 from "../../../src/cat/assets/default/hi/frame-02.png";
import { $, $$, reducedMotion } from "../lib/dom";

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => {
    window.setTimeout(resolve, ms);
  });

export function initHero(): void {
  const hero = $<HTMLElement>(".hero");
  const tui = $<HTMLElement>("[data-tui]");
  const replay = $<HTMLButtonElement>("[data-replay]");
  if (!hero || !tui) return;

  const lines = $$<HTMLElement>("[data-line]", tui).sort(
    (a, b) => Number(a.dataset.line ?? 0) - Number(b.dataset.line ?? 0),
  );
  const input = $<HTMLElement>("[data-tui-input]", tui);
  const userText = lines[0]?.querySelector<HTMLElement>(".tui-user-text") ?? lines[0] ?? null;
  const clock = $<HTMLTimeElement>("[data-tui-clock]", tui);
  const cat = $<HTMLImageElement>("[data-hero-cat]");

  const tickClock = (): void => {
    if (!clock) return;
    const now = new Date();
    const pad = (value: number): string => String(value).padStart(2, "0");
    clock.textContent = `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    clock.dateTime = now.toISOString();
  };
  tickClock();
  window.setInterval(tickClock, 1000);

  if (cat) {
    const frames = [hiFrame01, hiFrame02];
    const preload = new Image();
    preload.src = frames[1];
    cat.src = frames[0];

    if (!reducedMotion()) {
      let frame = 0;
      window.setInterval(() => {
        frame = (frame + 1) % frames.length;
        cat.src = frames[frame];
      }, 500);
    }
  }

  let runId = 0;
  let slide: Animation | null = null;

  const showLines = (count: number): void => {
    lines.slice(0, count).forEach((line) => line.classList.add("is-visible"));
  };

  const reveal = (index: number): void => {
    const line = lines[index];
    if (!line) return;
    line.classList.add("is-visible");
  };

  const play = async (): Promise<void> => {
    const token = ++runId;
    const alive = (): boolean => token === runId;

    slide?.cancel();
    slide = null;

    if (replay) {
      replay.disabled = true;
      replay.setAttribute("aria-busy", "true");
    }

    lines.forEach((line) => line.classList.remove("is-visible"));
    if (input) {
      input.classList.remove("is-visible");
      input.classList.remove("is-sliding");
      input.textContent = "";
    }

    if (reducedMotion()) {
      showLines(lines.length);
      if (replay) {
        replay.disabled = false;
        replay.removeAttribute("aria-busy");
      }
      return;
    }

    await sleep(340);
    if (!alive()) return;

    const question =
      userText?.textContent?.trim() ?? "where is the session token validated?";

    if (input && userText) {
      input.classList.add("is-visible");
      input.textContent = "";

      for (const char of question) {
        if (!alive()) return;
        input.textContent += char;
        await sleep(28);
      }

      if (!alive()) return;

      const startRect = input.getBoundingClientRect();
      const endRect = userText.getBoundingClientRect();
      const deltaX = endRect.left - startRect.left;
      const deltaY = endRect.top - startRect.top;

      input.classList.add("is-sliding");

      slide = input.animate(
        [
          { transform: "translate(0px, 0px)", opacity: 1 },
          { transform: `translate(${deltaX}px, ${deltaY}px)`, opacity: 1 },
        ],
        {
          duration: 360,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "forwards",
        },
      );

      await new Promise<void>((resolve) => {
        if (!slide) {
          resolve();
          return;
        }
        slide.onfinish = () => resolve();
        slide.oncancel = () => resolve();
      });

      if (!alive()) return;

      slide?.cancel();
      slide = null;
      input.classList.remove("is-visible");
      input.classList.remove("is-sliding");
      input.textContent = "";
    }

    reveal(0);

    const delays = [420, 300, 320, 400, 280, 280, 400];

    for (let index = 1; index < lines.length; index += 1) {
      await sleep(delays[index - 1] ?? 300);
      if (!alive()) return;
      reveal(index);
    }

    await sleep(550);
    if (!alive()) return;

    if (replay) {
      replay.disabled = false;
      replay.removeAttribute("aria-busy");
    }
  };

  hero.classList.add("is-ready");
  window.setTimeout(() => void play(), 420);

  replay?.addEventListener("click", () => {
    void play();
  });
}
