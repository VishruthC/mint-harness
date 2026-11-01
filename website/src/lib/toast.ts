let toastTimer = 0;

export function showToast(message: string, duration = 2800): void {
  const toast = document.querySelector<HTMLElement>("[data-toast]");
  if (!toast) return;

  window.clearTimeout(toastTimer);
  toast.textContent = message;
  toast.classList.add("is-visible");
  toastTimer = window.setTimeout(() => {
    toast.classList.remove("is-visible");
  }, duration);
}
