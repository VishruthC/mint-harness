import { $ } from "../lib/dom";

const SPACING = 28;
const HOVER_RADIUS = 15;
const GATHER = 0.2;

export function initHeroDots(): void {
  const field = document.querySelector<HTMLElement>("[data-hero-field]");
  const canvas = field?.querySelector<HTMLCanvasElement>("[data-hero-dots]");
  if (!field || !canvas) return;

  const context = canvas.getContext("2d");
  if (!context) return;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const dpr = window.devicePixelRatio || 1;

  let width = 0;
  let height = 0;
  const dots: { x: number; y: number }[] = [];

  const rebuildDots = (): void => {
    dots.length = 0;
    const cols = Math.ceil(width / SPACING) + 1;
    const rows = Math.ceil(height / SPACING) + 1;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        dots.push({
          x: (col + 0.5) * SPACING,
          y: (row + 0.5) * SPACING,
        });
      }
    }
  };

  const resize = (): void => {
    const rect = field.getBoundingClientRect();
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    rebuildDots();
  };

  const mouse = { x: -9999, y: -9999, active: false };

  const hero = field.closest<HTMLElement>(".hero") ?? document.body;
  hero.addEventListener("mousemove", (event) => {
    const rect = field.getBoundingClientRect();
    mouse.x = event.clientX - rect.left;
    mouse.y = event.clientY - rect.top;
    mouse.active = true;
  });
  hero.addEventListener("mouseleave", () => {
    mouse.active = false;
  });

  const draw = (): void => {
    context.clearRect(0, 0, width, height);

    for (const dot of dots) {
      let x = dot.x;
      let y = dot.y;
      let alpha = 0.16;
      let radius = 1.2;

      if (mouse.active) {
        const dx = mouse.x - dot.x;
        const dy = mouse.y - dot.y;
        const distance = Math.hypot(dx, dy);

        if (distance <= HOVER_RADIUS) {
          const t = 1 - distance / HOVER_RADIUS;
          const pull = t * SPACING * GATHER;
          const length = distance || 1;
          x += (dx / length) * pull;
          y += (dy / length) * pull;
          alpha = 0.16 + t * 0.72;
          radius = 1.2 + t * 1.8;
        }
      }

      context.beginPath();
      context.arc(x, y, radius, 0, Math.PI * 2);
      context.fillStyle = `rgba(166, 227, 161, ${alpha})`;
      context.fill();
    }

    if (!reduced) {
      window.requestAnimationFrame(draw);
    }
  };

  resize();
  field.classList.add("is-dots-ready");

  const observer = new ResizeObserver(() => resize());
  observer.observe(field);

  draw();
}