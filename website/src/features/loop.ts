import { $, $$, clamp } from "../lib/dom";
import { ScrollTrigger, gsap } from "../lib/gsap";

const PIN_QUERY = "(min-width: 1000px) and (min-height: 700px) and (prefers-reduced-motion: no-preference)";
const STATIC_QUERY = "(max-width: 999px), (max-height: 699px), (prefers-reduced-motion: reduce)";

export function initLoop(): void {
  const pin = $<HTMLElement>("[data-loop-pin]");
  const path = $<SVGPathElement>("[data-loop-path]");
  const pulse = $<SVGCircleElement>("[data-loop-pulse]");
  const nodes = $$<SVGGElement>("[data-node]");
  const steps = $$<HTMLElement>("[data-step]");
  const gate = $<SVGGElement>(".loop-node--gate");
  if (!pin || !path || !pulse) return;

  const length = path.getTotalLength();
  path.style.strokeDasharray = `${length}`;
  path.style.strokeDashoffset = `${length}`;

  const setProgress = (value: number, waiting = false): void => {
    const visual = clamp(value, 0, 1);

    path.style.strokeDashoffset = `${length * (1 - visual)}`;

    for (const node of nodes) {
      const at = Number(node.dataset.at ?? 0);
      node.classList.toggle("is-active", visual >= at - 0.004);
    }

    for (const step of steps) {
      const at = Number(step.dataset.at ?? 0);
      step.classList.toggle("is-active", visual >= at - 0.004);
    }

    if (visual > 0.004 && visual < 0.996) {
      const point = path.getPointAtLength(length * visual);
      pulse.setAttribute("cx", String(point.x));
      pulse.setAttribute("cy", String(point.y));
      pulse.classList.add("is-live");
    } else {
      pulse.classList.remove("is-live");
    }

    pin.classList.toggle("is-waiting", waiting);
    gate?.classList.toggle("is-waiting", waiting);
  };

  const setComplete = (): void => {
    setProgress(1, false);
    pin.classList.remove("is-waiting");
    gate?.classList.remove("is-waiting");
  };

  setProgress(0);

  const media = gsap.matchMedia();

  media.add(PIN_QUERY, () => {
    const trigger = ScrollTrigger.create({
      trigger: pin,
      start: "top top",
      end: "+=165%",
      pin: true,
      pinSpacing: true,
      anticipatePin: 1,
      invalidateOnRefresh: true,
      onUpdate: (self) => {
        const progress = self.progress;
        let visual: number;
        let waiting = false;

        if (progress < 0.48) {
          visual = (progress / 0.48) * 0.5;
        } else if (progress < 0.68) {
          visual = 0.5;
          waiting = true;
        } else {
          visual = 0.5 + ((progress - 0.68) / 0.32) * 0.5;
        }

        setProgress(visual, waiting);
      },
      onLeave: () => setComplete(),
      onEnterBack: () => setProgress(0.5, true),
      onLeaveBack: () => setProgress(0),
    });

    return () => {
      trigger.kill();
      setProgress(0);
    };
  });

  media.add(STATIC_QUERY, () => {
    setComplete();
  });
}
