import { $, $$, on } from "../lib/dom";

export function initIndex(): void {
  const dialog = $<HTMLDialogElement>("[data-index-dialog]");
  const openButton = $<HTMLButtonElement>("[data-index-open]");
  const closeButton = $<HTMLButtonElement>("[data-index-close]");
  const search = $<HTMLInputElement>("[data-index-search]");
  const list = $<HTMLElement>("[data-index-list]");
  if (!dialog || !openButton || !search || !list) return;

  const items = $$<HTMLAnchorElement>("[data-index-item]", list);
  const inner = dialog.querySelector<HTMLElement>(".index-dialog-inner");

  const empty = document.createElement("p");
  empty.className = "index-empty";
  empty.hidden = true;
  list.after(empty);

  const live = document.createElement("p");
  live.className = "sr-only";
  live.setAttribute("aria-live", "polite");
  (inner ?? dialog).append(live);

  const isMac = /Mac|iPhone|iPad|iPod/.test(navigator.platform) || /Mac OS X/.test(navigator.userAgent);
  const keyboardLabel = $<HTMLElement>("[data-kbd]");
  if (keyboardLabel) keyboardLabel.textContent = isMac ? "⌘K" : "Ctrl K";

  const visibleItems = (): HTMLAnchorElement[] => items.filter((item) => !item.hidden);

  const filter = (query: string): void => {
    const needle = query.trim().toLowerCase();
    let count = 0;

    for (const item of items) {
      const haystack = `${item.textContent ?? ""} ${item.dataset.keywords ?? ""}`.toLowerCase();
      const matches = needle.length === 0 || haystack.includes(needle);
      item.hidden = !matches;
      if (matches) count += 1;
    }

    empty.hidden = count !== 0;
    empty.textContent = needle ? `No chapters match “${query.trim()}”.` : "";
    live.textContent = `${count} chapter${count === 1 ? "" : "s"} shown.`;
  };

  const open = (): void => {
    if (dialog.open) return;
    search.value = "";
    filter("");
    document.documentElement.classList.add("has-dialog");

    if (typeof dialog.showModal === "function") {
      dialog.showModal();
    } else {
      dialog.setAttribute("open", "");
    }

    window.requestAnimationFrame(() => {
      search.focus();
    });
  };

  const close = (): void => {
    if (!dialog.open) return;
    if (typeof dialog.close === "function") dialog.close();
    else dialog.removeAttribute("open");
    document.documentElement.classList.remove("has-dialog");
    openButton.focus({ preventScroll: true });
  };

  openButton.addEventListener("click", open);
  closeButton?.addEventListener("click", close);

  // A native modal dialog closes on Escape, but a focused search input can
  // consume the key first (and clear itself). Handle Escape in the capture
  // phase so closing is predictable and focus always returns to the trigger.
  dialog.addEventListener(
    "keydown",
    (event) => {
      if (event.key !== "Escape" || !dialog.open) return;
      event.preventDefault();
      close();
    },
    true,
  );

  dialog.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });

  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) close();
  });

  dialog.addEventListener("close", () => {
    document.documentElement.classList.remove("has-dialog");
    openButton.focus({ preventScroll: true });
  });

  search.addEventListener("input", () => filter(search.value));

  search.addEventListener("keydown", (event) => {
    if (event.key !== "ArrowDown") return;
    const first = visibleItems()[0];
    if (!first) return;
    event.preventDefault();
    first.focus();
  });

  list.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLAnchorElement)) return;
    if (!target.matches("[data-index-item]")) return;

    const available = visibleItems();
    const index = available.indexOf(target);
    if (index === -1) return;

    let next = index;

    if (event.key === "ArrowDown") next = (index + 1) % available.length;
    else if (event.key === "ArrowUp") next = (index - 1 + available.length) % available.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = available.length - 1;
    else return;

    event.preventDefault();
    available[next]?.focus();
  });

  for (const item of items) {
    item.addEventListener("click", () => close());
  }

  on(document, "keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      if (dialog.open) close();
      else open();
      return;
    }

    if (event.key === "Escape" && dialog.open && typeof dialog.showModal !== "function") {
      close();
    }
  });
}
