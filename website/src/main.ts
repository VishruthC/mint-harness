import "@fontsource-variable/newsreader/wght.css";
import "@fontsource-variable/newsreader/wght-italic.css";
import "@fontsource/victor-mono/latin-400.css";
import "@fontsource/victor-mono/latin-700.css";

import "./styles/tokens.css";
import "./styles/base.css";
import "./styles/layout.css";
import "./styles/sections.css";
import "./styles/motion.css";

import { ScrollTrigger } from "./lib/gsap";
import { initPageMotion } from "./lib/page-motion";
import { initApproval } from "./features/approval";
import { initCatPlayground } from "./features/cat";
import { initCommandDemo } from "./features/command";
import { initHero } from "./features/hero";
import { initHeroDots } from "./features/hero-dots";
import { initIndex } from "./features/index";
import { initInstall } from "./features/install";
import { initLoop } from "./features/loop";
import { initReadDemo } from "./features/read";
import { initSessions } from "./features/sessions";

function safe(label: string, task: () => void): boolean {
  try {
    task();
    return true;
  } catch (error) {
    console.error(`[MINT site] ${label} failed to initialize.`, error);
    return false;
  }
}

function boot(): void {
  const motionReady = safe("page motion", initPageMotion);

  safe("hero", initHero);
  safe("hero dots", initHeroDots);
  safe("loop scene", initLoop);
  safe("read specimen", initReadDemo);
  safe("approval scene", initApproval);
  safe("command demo", initCommandDemo);
  safe("sessions", initSessions);
  safe("cat playground", initCatPlayground);
  safe("install panel", initInstall);
  safe("index dialog", initIndex);

  if (motionReady) {
    document.documentElement.classList.add("motion-ready");
  }

  window.requestAnimationFrame(() => ScrollTrigger.refresh());
  document.fonts?.ready.then(() => ScrollTrigger.refresh()).catch(() => undefined);
  window.addEventListener("load", () => ScrollTrigger.refresh(), { once: true });
}

if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", boot, { once: true });
} else {
  boot();
}
