import { $$ } from "../lib/dom";
import { showToast } from "../lib/toast";

export function initSessions(): void {
  const buttons = $$<HTMLButtonElement>("[data-resume-session]");
  for (const button of buttons) {
    button.addEventListener("click", () => {
      showToast("Demo only — this session list is illustrative. The real store is local SQLite.", 3200);
    });
  }
}
