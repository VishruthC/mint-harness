import { $, $$ } from "../lib/dom";
import { ScrollTrigger, gsap } from "../lib/gsap";
import { showToast } from "../lib/toast";

const PIN_QUERY = "(min-width: 1000px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)";
const STATIC_QUERY = "(max-width: 999px), (max-height: 699px), (prefers-reduced-motion: reduce)";

export function initApproval(): void {
  const pin = $<HTMLElement>("[data-approval-pin]");
  const desk = $<HTMLElement>("[data-approval-desk]");
  const checks = $$<HTMLElement>("[data-check]");
  const diffs = $$<HTMLElement>("[data-diff]");
  const stamp = $<HTMLElement>("[data-stamp]");
  const stampMain = $<HTMLElement>("[data-stamp-main]");
  const stampSub = stamp?.querySelector<HTMLElement>(".stamp-sub");
  const status = $<HTMLElement>("[data-diff-status]");
  const keycap = $<HTMLButtonElement>("[data-apply]");
  const reset = $<HTMLButtonElement>("[data-reset-approval]");
  if (!pin || !keycap) return;

  let approved = false;

  const revealAll = (): void => {
    checks.forEach((check) => check.classList.add("is-checked"));
    diffs.forEach((diff) => diff.classList.add("is-visible"));
    stamp?.classList.add("is-visible");
    desk?.classList.add("is-armed");
  };

  const setProgress = (progress: number): void => {
    if (approved) {
      revealAll();
      return;
    }

    for (const check of checks) {
      const at = Number(check.dataset.at ?? 0);
      check.classList.toggle("is-checked", progress >= at);
    }

    for (const diff of diffs) {
      const at = Number(diff.dataset.at ?? 0);
      diff.classList.toggle("is-visible", progress >= at);
    }

    stamp?.classList.toggle("is-visible", progress >= 0.34);
    desk?.classList.toggle("is-armed", progress >= 0.26);
  };

  const approve = (): void => {
    if (approved) return;
    approved = true;
    revealAll();
    pin.classList.add("is-approved");
    keycap.classList.add("is-pressed");
    keycap.setAttribute("aria-disabled", "true");
    if (status) status.textContent = "patch applied";
    if (stampMain) stampMain.textContent = "APPROVED";
    if (stampSub) stampSub.textContent = "user approved";
    showToast("Demo only — no files were changed. The real gate writes only after /apply.", 3600);
  };

  const resetDemo = (): void => {
    approved = false;
    pin.classList.remove("is-approved");
    keycap.classList.remove("is-pressed");
    keycap.removeAttribute("aria-disabled");
    if (status) status.textContent = "awaiting approval";
    if (stampMain) stampMain.textContent = "APPROVAL REQUIRED";
    if (stampSub) stampSub.textContent = "user action only";
    revealAll();
    keycap.focus({ preventScroll: true });
    showToast("Demo reset. Nothing was ever written to disk.");
  };

  keycap.addEventListener("click", approve);
  reset?.addEventListener("click", resetDemo);

  setProgress(0);

  const media = gsap.matchMedia();

  media.add(PIN_QUERY, () => {
    const trigger = ScrollTrigger.create({
      trigger: pin,
      start: "top top",
      end: "+=120%",
      pin: true,
      pinSpacing: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => setProgress(self.progress),
      onLeave: () => setProgress(1),
      onEnterBack: () => setProgress(0.55),
      onLeaveBack: () => setProgress(0),
    });

    return () => {
      trigger.kill();
      setProgress(0);
    };
  });

  media.add(STATIC_QUERY, () => {
    revealAll();
  });
}
