import hiFrame01 from "../../../src/cat/assets/default/hi/frame-01.png";
import hiFrame02 from "../../../src/cat/assets/default/hi/frame-02.png";
import idleFrame01 from "../../../src/cat/assets/default/idle/frame-01.png";
import idleFrame02 from "../../../src/cat/assets/default/idle/frame-02.png";
import readFrame01 from "../../../src/cat/assets/default/read/frame-01.png";
import readFrame02 from "../../../src/cat/assets/default/read/frame-02.png";
import thinkFrame01 from "../../../src/cat/assets/default/think/frame-01.png";
import thinkFrame02 from "../../../src/cat/assets/default/think/frame-02.png";

export type CatExpression = "idle" | "happy" | "love" | "zoomies" | "wizard" | "chaos";

interface CatClip {
  frames: readonly string[];
  fps: number;
}

/**
 * Browser remixes of the real asset pack. Four source states cover six moods:
 * idle is the loaf, hi is happy/love/zoomies, read is the tiny wizard's book,
 * and think powers the chaos gremlin.
 */
const CLIPS: Record<CatExpression, CatClip> = {
  idle: { frames: [idleFrame01, idleFrame02], fps: 2 },
  happy: { frames: [hiFrame01, hiFrame02], fps: 2 },
  love: { frames: [hiFrame01, hiFrame02], fps: 1.5 },
  zoomies: { frames: [hiFrame01, hiFrame02], fps: 6 },
  wizard: { frames: [readFrame01, readFrame02], fps: 3 },
  chaos: { frames: [thinkFrame01, thinkFrame02], fps: 4 },
};

export interface CatPlayerOptions {
  image: HTMLImageElement;
  stage: HTMLElement;
  expression: CatExpression;
  animated: boolean;
  onFrame?: (frame: number, total: number) => void;
}

export class CatPlayer {
  private readonly image: HTMLImageElement;
  private readonly stage: HTMLElement;
  private readonly onFrame?: (frame: number, total: number) => void;
  private readonly motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  private readonly preloads: HTMLImageElement[] = [];
  private observer: IntersectionObserver | null = null;
  private expression: CatExpression;
  private animated: boolean;
  private reduced = this.motionQuery.matches;
  private visible = true;
  private index = 0;
  private timer = 0;
  private destroyed = false;

  constructor(options: CatPlayerOptions) {
    this.image = options.image;
    this.stage = options.stage;
    this.onFrame = options.onFrame;
    this.expression = options.expression;
    this.animated = options.animated;

    this.image.decoding = "async";
    this.stage.dataset.mood = this.expression;
    this.render();
    this.observe();
    this.motionQuery.addEventListener("change", this.handleMotionChange);
    document.addEventListener("visibilitychange", this.handleVisibility);
    window.setTimeout(() => this.preload(), 1200);
  }

  play(expression: CatExpression): void {
    this.expression = expression;
    this.index = 0;
    this.stage.dataset.mood = expression;
    this.render();
    this.sync();
  }

  setAnimated(animated: boolean): void {
    if (this.animated === animated) return;
    this.animated = animated;
    if (!animated) {
      this.index = 0;
      this.render();
    }
    this.sync();
  }

  destroy(): void {
    this.destroyed = true;
    window.clearInterval(this.timer);
    this.observer?.disconnect();
    this.motionQuery.removeEventListener("change", this.handleMotionChange);
    document.removeEventListener("visibilitychange", this.handleVisibility);
  }

  private observe(): void {
    if (typeof IntersectionObserver === "undefined") {
      this.sync();
      return;
    }

    this.observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry) return;
        this.visible = entry.isIntersecting;
        this.sync();
      },
      { rootMargin: "120px 0px" },
    );
    this.observer.observe(this.stage);
    this.sync();
  }

  private preload(): void {
    if (this.destroyed) return;
    const frames = new Set(Object.values(CLIPS).flatMap((clip) => clip.frames));
    for (const frame of frames) {
      const image = new Image();
      image.decoding = "async";
      image.src = frame;
      this.preloads.push(image);
    }
  }

  private sync(): void {
    if (this.destroyed) return;
    window.clearInterval(this.timer);
    this.timer = 0;

    if (!this.animated || this.reduced || !this.visible) {
      this.index = 0;
      this.render();
      return;
    }

    if (document.hidden) return;

    this.render();
    const clip = CLIPS[this.expression];
    this.timer = window.setInterval(() => {
      this.index = (this.index + 1) % clip.frames.length;
      this.render();
    }, Math.round(1000 / clip.fps));
  }

  private render(): void {
    const clip = CLIPS[this.expression];
    const source = clip.frames[this.index] ?? clip.frames[0];
    if (!source) return;
    if (this.image.getAttribute("src") !== source) this.image.src = source;
    this.onFrame?.(this.index + 1, clip.frames.length);
  }

  private handleMotionChange = (): void => {
    this.reduced = this.motionQuery.matches;
    this.sync();
  };

  private handleVisibility = (): void => {
    this.sync();
  };
}
