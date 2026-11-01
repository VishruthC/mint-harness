import { $, $$ } from "../lib/dom";
import { showToast } from "../lib/toast";

export function initInstall(): void {
  const tabs = $$<HTMLButtonElement>("[data-install-tab]");
  const panels = $$<HTMLElement>("[data-install-panel]");
  const copyButton = $<HTMLButtonElement>("[data-copy-install]");
  if (!tabs.length) return;

  const activate = (name: string, focus = false): void => {
    for (const tab of tabs) {
      const active = tab.dataset.installTab === name;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", String(active));
      tab.tabIndex = active ? 0 : -1;
      if (active && focus) tab.focus();
    }

    for (const panel of panels) {
      const active = panel.dataset.installPanel === name;
      panel.classList.toggle("is-active", active);
      panel.hidden = !active;
    }
  };

  for (const tab of tabs) {
    tab.addEventListener("click", () => {
      const name = tab.dataset.installTab;
      if (name) activate(name);
    });

    tab.addEventListener("keydown", (event) => {
      const index = tabs.indexOf(tab);
      let next = index;

      if (event.key === "ArrowRight") next = (index + 1) % tabs.length;
      else if (event.key === "ArrowLeft") next = (index - 1 + tabs.length) % tabs.length;
      else if (event.key === "Home") next = 0;
      else if (event.key === "End") next = tabs.length - 1;
      else return;

      event.preventDefault();
      const name = tabs[next]?.dataset.installTab;
      if (name) activate(name, true);
    });
  }

  const activeCode = (): string => {
    const activePanel = $<HTMLElement>(".install-panel.is-active");
    return activePanel?.querySelector("pre")?.textContent?.trim() ?? "";
  };

  const copyFallback = (text: string): boolean => {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();

    let copied = false;
    try {
      copied = document.execCommand("copy");
    } catch {
      copied = false;
    }

    area.remove();
    return copied;
  };

  const copied = (): void => {
    if (!copyButton) return;
    const original = copyButton.textContent ?? "copy";
    copyButton.textContent = "copied ✓";
    showToast("Install steps copied to the clipboard.");
    window.setTimeout(() => {
      copyButton.textContent = original;
    }, 1800);
  };

  copyButton?.addEventListener("click", async () => {
    const text = activeCode();
    if (!text) return;

    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
        copied();
        return;
      }
    } catch {
      // Fall through to the selection-based fallback.
    }

    if (copyFallback(text)) copied();
    else showToast("Copy failed — select the command block manually.");
  });

  activate(tabs.find((tab) => tab.classList.contains("is-active"))?.dataset.installTab ?? "powershell");
}
