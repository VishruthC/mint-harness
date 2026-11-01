import { $, $$, reducedMotion } from "./dom";

export function initPageMotion(): void {
  const revealItems = $$<HTMLElement>("[data-reveal]");

  if (reducedMotion() || typeof IntersectionObserver === "undefined") {
    revealItems.forEach((item) => item.classList.add("is-in"));
  } else {
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          entry.target.classList.add("is-in");
          observer.unobserve(entry.target);
        }
      },
      { threshold: 0.08, rootMargin: "0px 0px -6% 0px" },
    );

    revealItems.forEach((item) => observer.observe(item));
  }

  const header = $<HTMLElement>("[data-header]");
  const progress = $<HTMLElement>("[data-scroll-progress]");
  const sections = $$<HTMLElement>("[data-section]");
  const railDots = $$<HTMLElement>("[data-rail]");
  const rail = new Map(railDots.map((dot) => [dot.dataset.rail ?? "", dot]));
  const footer = $<HTMLElement>(".site-footer");

  let scheduled = 0;

  const update = (): void => {
    scheduled = 0;
    const y = window.scrollY;
    header?.classList.toggle("is-scrolled", y > 8);

    const maxScroll = Math.max(1, document.documentElement.scrollHeight - window.innerHeight);
    if (progress) progress.style.width = `${Math.min(100, (y / maxScroll) * 100)}%`;

    const probe = y + window.innerHeight * 0.45;
    let current = "top";

    for (const section of sections) {
      if (section.offsetTop <= probe) current = section.dataset.section ?? current;
    }

    const railKey = current === "install" ? "limits" : current;
    for (const [key, dot] of rail) {
      dot.classList.toggle("is-active", key === railKey);
    }

    const overFooter = footer ? y + 68 >= footer.offsetTop : false;
    header?.classList.toggle(
      "is-dark",
      current === "loop" || current === "approve" || overFooter,
    );
  };

  const requestUpdate = (): void => {
    if (scheduled) return;
    scheduled = window.requestAnimationFrame(update);
  };

  window.addEventListener("scroll", requestUpdate, { passive: true });
  window.addEventListener("resize", requestUpdate, { passive: true });
  window.addEventListener("load", requestUpdate, { once: true });
  document.fonts?.ready.then(requestUpdate).catch(() => undefined);

  requestUpdate();
}
