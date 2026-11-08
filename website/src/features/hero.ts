import { CatView } from "../lib/cat-view";
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
  const catCanvas = $<HTMLCanvasElement>("[data-hero-cat]");

  let cat: CatView | null = null;
  if (catCanvas) {
    try {
      cat = new CatView({
        canvas: catCanvas,
        size: 128,
        expression: "idle",
        mood: "idle",
        animated: true,
      });
    } catch {
      cat = null;
    }
  }

  let runId = 0;

  const showLines = (count: number): void => {
    lines.slice(0, count).forEach((line) => line.classList.add("is-visible"));
  };

  const play = async (): Promise<void> => {
    const token = ++runId;
    const alive = (): boolean => token === runId;

    if (replay) {
      replay.disabled = true;
      replay.setAttribute("aria-busy", "true");
    }

    lines.forEach((line) => line.classList.remove("is-visible"));
    if (input) input.textContent = "";
    cat?.setMood("idle");

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
      lines[0]?.querySelectorAll("span")[1]?.textContent?.trim() ??
      "where is the session token validated?";

    if (input) {
      input.classList.add("is-visible");
      input.textContent = "";

      for (const char of question) {
        if (!alive()) return;
        input.textContent += char;
        await sleep(28);
      }

      if (!alive()) return;

      const startRect = input.getBoundingClientRect();
      const endRect = lines[0].getBoundingClientRect();
      const deltaY = endRect.top - startRect.top;

      const slide = input.animate(
        [
          { transform: "translateY(0px)", opacity: 1 },
          { transform: `translateY(${deltaY}px)`, opacity: 1 },
        ],
        {
          duration: 360,
          easing: "cubic-bezier(0.22, 1, 0.36, 1)",
          fill: "forwards",
        },
      );

      await new Promise<void>((resolve) => {
        slide.onfinish = () => resolve();
        slide.oncancel = () => resolve();
      });

      if (!alive()) return;

      slide.cancel();
      input.classList.remove("is-visible");
      input.textContent = "";
      lines[0].classList.add("is-visible");
    } else {
      showLines(1);
    }

    await sleep(420);
    if (!alive()) return;
    showLines(2);
    cat?.setMood("thinking");

    await sleep(300);
    if (!alive()) return;
    showLines(3);

    await sleep(320);
    if (!alive()) return;
    showLines(4);

    await sleep(400);
    if (!alive()) return;
    showLines(5);
    cat?.setMood("curious");

    await sleep(280);
    if (!alive()) return;
    showLines(6);

    await sleep(280);
    if (!alive()) return;
    showLines(7);
    cat?.setMood("happy");

    await sleep(400);
    if (!alive()) return;
    showLines(8);

    await sleep(550);
    if (!alive()) return;
    cat?.setMood("idle");

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
