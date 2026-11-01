import { $, reducedMotion } from "../lib/dom";

export function initReadDemo(): void {
  const specimen = $<HTMLElement>("[data-read-demo]");
  const alert = $<HTMLElement>("[data-boundary-alert]");
  if (!specimen || !alert) return;

  if (reducedMotion() || typeof IntersectionObserver === "undefined") {
    alert.classList.add("is-visible");
    return;
  }

  const observer = new IntersectionObserver(
    (entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      observer.disconnect();
      window.setTimeout(() => alert.classList.add("is-visible"), 900);
    },
    { threshold: 0.22 },
  );

  observer.observe(specimen);
}
