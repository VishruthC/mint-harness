export const $ = <T extends Element = Element>(
  selector: string,
  root: ParentNode = document,
): T | null => root.querySelector<T>(selector);

export const $$ = <T extends Element = Element>(
  selector: string,
  root: ParentNode = document,
): T[] => Array.from(root.querySelectorAll<T>(selector));

export const reducedMotion = (): boolean =>
  window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function on<K extends keyof HTMLElementEventMap>(
  target: HTMLElement | Document | Window,
  type: K,
  listener: (event: HTMLElementEventMap[K]) => void,
  options?: AddEventListenerOptions,
): void {
  target.addEventListener(type, listener as EventListener, options);
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function setText(element: Element | null, text: string): void {
  if (element) element.textContent = text;
}
