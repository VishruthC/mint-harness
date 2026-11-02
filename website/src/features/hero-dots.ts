import { $ } from "../lib/dom";

const SPACING = 28;
const HOVER_RADIUS = 88;
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
  const dots: { x: number; y: number; intensity: number }[] = [];

  const rebuildDots = (): void => {
    dots.length = 0;
    const cols = Math.ceil(width / SPACING) + 1;
    const rows = Math.ceil(height / SPACING) + 1;
    for (let row = 0; row < rows; row += 1) {
      for (let col = 0; col < cols; col += 1) {
        dots.push({
          x: (col + 0.5) * SPACING,
          y: (row + 0.5) * SPACING,
          intensity: 0,
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
      let target = 0;
      let pullX = 0;
      let pullY = 0;

      if (mouse.active) {
        const dx = mouse.x - dot.x;
        const dy = mouse.y - dot.y;
        const distance = Math.hypot(dx, dy);

        if (distance <= HOVER_RADIUS) {
          target = 1 - distance / HOVER_RADIUS;
          const length = distance || 1;
          const pull = target * SPACING * GATHER;
          pullX = (dx / length) * pull;
          pullY = (dy / length) * pull;
        }
      }

      // Fast attack, slow release for a fluid feel.
      const rate = target > dot.intensity ? 0.96 : 0.08;
      dot.intensity += (target - dot.intensity) * rate;
      if (dot.intensity < 0.001) dot.intensity = 0;

      const t = dot.intensity;
      const x = dot.x + pullX * t;
      const y = dot.y + pullY * t;
      const alpha = 0.28 + t * 0.72;
      const radius = 1.35 + t * 2.45;

      context.shadowBlur = t > 0.01 ? 10 + t * 18 : 0;
      context.shadowColor = `rgba(166, 227, 161, ${0.4 + t * 0.6})`;

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