import { $, reducedMotion } from "../lib/dom";
import { showToast } from "../lib/toast";

export function initCommandDemo(): void {
  const card = $<HTMLElement>("[data-command-demo]");
  if (!card) return;

  const runButton = $<HTMLButtonElement>("[data-run-command]", card);
  const resetButton = $<HTMLButtonElement>("[data-reset-command]", card);
  const output = $<HTMLElement>("[data-command-output]", card);
  if (!runButton || !output) return;

  const initialLabel = runButton.innerHTML;
  let timer = 0;
  let running = false;

  const finish = (): void => {
    running = false;
    output.hidden = false;
    runButton.disabled = true;
    runButton.removeAttribute("aria-busy");
    runButton.textContent = "exit 0";
    if (resetButton) resetButton.hidden = false;
  };

  const run = (): void => {
    if (running) return;
    running = true;
    window.clearTimeout(timer);
    output.hidden = true;
    if (resetButton) resetButton.hidden = true;
    runButton.disabled = true;
    runButton.setAttribute("aria-busy", "true");
    runButton.textContent = "running…";
    showToast("Scripted demo — no command was run. The output below is illustrative.", 3400);

    if (reducedMotion()) {
      finish();
      return;
    }

    timer = window.setTimeout(finish, 950);
  };

  const reset = (): void => {
    window.clearTimeout(timer);
    running = false;
    output.hidden = true;
    if (resetButton) resetButton.hidden = true;
    runButton.disabled = false;
    runButton.removeAttribute("aria-busy");
    runButton.innerHTML = initialLabel;
    runButton.focus({ preventScroll: true });
    showToast("Command demo reset. Nothing was executed.");
  };

  runButton.addEventListener("click", run);
  resetButton?.addEventListener("click", reset);
}
