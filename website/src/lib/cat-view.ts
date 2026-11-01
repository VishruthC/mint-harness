import {
  CAT_ART_FRAMES,
  CAT_ART_SIZE,
  renderCatFrame,
  type CatExpression,
  type CatMood,
} from "@mint/cat-art";

export interface CatViewOptions {
  canvas: HTMLCanvasElement;
  size?: number;
  expression?: CatExpression;
  mood?: CatMood;
  animated?: boolean;
  onFrame?: (frame: number) => void;
}

const FRAME_MS = 1000 / 12;

/**
 * The harness portrait is composed with generous negative space inside its
 * 192px plate. Cropping the same rendered pixels keeps the cat legible in the
 * website's specimen frame without touching the source renderer.
 *
 * Bounds are measured across every expression and frame: the cat spans
 * x 22–154 and y 5–171, so this 176px square centers it with breathing room.
 */
const CROP = { x: 10, y: 0, size: 176 } as const;

/**
 * Draws the harness's real cat renderer onto a canvas.
 *
 * The renderer returns raw RGBA bytes, so there are no images, network calls,
 * or third-party canvas dependencies involved. Animation is throttled to the
 * same 12 fps cadence the terminal uses.
 */
export class CatView {
  private readonly canvas: HTMLCanvasElement;
  private readonly ctx: CanvasRenderingContext2D;
  private readonly size: number;
  private readonly sourceCanvas: HTMLCanvasElement;
  private readonly sourceCtx: CanvasRenderingContext2D;
  private readonly sourceImage: ImageData;
  private readonly onFrame?: (frame: number) => void;
  private readonly motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
  private observer: IntersectionObserver | null = null;

  private expression: CatExpression;
  private mood: CatMood;
  private animated: boolean;
  private reduced = this.motionQuery.matches;
  private visible = true;
  private raf = 0;
  private lastTime = 0;
  private frame = 0;
  private destroyed = false;

  constructor(options: CatViewOptions) {
    this.canvas = options.canvas;
    this.size = options.size ?? CAT_ART_SIZE;
    this.expression = options.expression ?? "idle";
    this.mood = options.mood ?? "idle";
    this.animated = options.animated ?? true;
    this.onFrame = options.onFrame;

    this.canvas.width = this.size;
    this.canvas.height = this.size;

    const context = this.canvas.getContext("2d", { alpha: true });
    if (!context) {
      throw new Error("Canvas 2D is unavailable in this browser.");
    }
    this.ctx = context;

    this.sourceCanvas = document.createElement("canvas");
    this.sourceCanvas.width = CAT_ART_SIZE;
    this.sourceCanvas.height = CAT_ART_SIZE;
    const sourceContext = this.sourceCanvas.getContext("2d", { alpha: true });
    if (!sourceContext) {
      throw new Error("Canvas 2D is unavailable in this browser.");
    }
    this.sourceCtx = sourceContext;
    this.sourceImage = this.sourceCtx.createImageData(CAT_ART_SIZE, CAT_ART_SIZE);

    this.render();
    this.observe();
    this.motionQuery.addEventListener("change", this.handleMotionChange);
    document.addEventListener("visibilitychange", this.handleVisibility);
  }

  setExpression(expression: CatExpression): void {
    if (this.expression === expression) return;
    this.expression = expression;
    this.frame = 0;
    this.render();
  }

  setMood(mood: CatMood): void {
    if (this.mood === mood) return;
    this.mood = mood;
    this.render();
  }

  setAnimated(animated: boolean): void {
    if (this.animated === animated) return;
    this.animated = animated;
    if (!animated) this.frame = 0;
    this.sync();
  }

  get isAnimated(): boolean {
    return this.animated;
  }

  destroy(): void {
    this.destroyed = true;
    if (this.raf) cancelAnimationFrame(this.raf);
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
    this.observer.observe(this.canvas);
    this.sync();
  }

  private sync(): void {
    if (this.destroyed) return;

    const shouldRun = this.animated && this.visible && !document.hidden && !this.reduced;
    if (shouldRun) {
      if (!this.raf) {
        this.lastTime = 0;
        this.raf = requestAnimationFrame(this.tick);
      }
      return;
    }

    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.frame = 0;
    this.render();
  }

  private tick = (now: number): void => {
    if (this.destroyed) return;
    this.raf = requestAnimationFrame(this.tick);

    if (!this.lastTime) this.lastTime = now;
    if (now - this.lastTime < FRAME_MS) return;

    this.lastTime = now;
    this.frame = (this.frame + 1) % CAT_ART_FRAMES;
    this.render();
  };

  private render(): void {
    const animated = this.animated && !this.reduced;
    const rgba = renderCatFrame({
      expression: this.expression,
      mood: this.mood,
      frame: animated ? this.frame : -1,
      size: CAT_ART_SIZE,
    });

    if (rgba.length === this.sourceImage.data.length) {
      this.sourceImage.data.set(rgba);
      this.sourceCtx.putImageData(this.sourceImage, 0, 0);

      this.ctx.clearRect(0, 0, this.size, this.size);
      this.ctx.imageSmoothingEnabled = true;
      this.ctx.imageSmoothingQuality = "high";
      this.ctx.drawImage(
        this.sourceCanvas,
        CROP.x,
        CROP.y,
        CROP.size,
        CROP.size,
        0,
        0,
        this.size,
        this.size,
      );
    }

    this.onFrame?.(animated ? this.frame : 0);
  }

  private handleMotionChange = (): void => {
    this.reduced = this.motionQuery.matches;
    this.frame = 0;
    this.sync();
  };

  private handleVisibility = (): void => {
    this.sync();
  };
}
