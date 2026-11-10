import { CatPlayer, type CatExpression } from "../lib/cat-player";
import { $, reducedMotion, setText } from "../lib/dom";
import { showToast } from "../lib/toast";

interface ExpressionInfo {
  id: CatExpression;
  label: string;
  unlock: string;
  short: string;
  minPets: number;
  minTreats: number;
}

/** Mirrors the expressions and thresholds in the harness's src/cat.ts. */
const EXPRESSIONS: readonly ExpressionInfo[] = [
  { id: "idle", label: "Classic loaf", unlock: "Always available", short: "always", minPets: 0, minTreats: 0 },
  { id: "happy", label: "Happy eyes", unlock: "Always available", short: "always", minPets: 0, minTreats: 0 },
  { id: "love", label: "Heart eyes", unlock: "Pet 3 times", short: "3 pets", minPets: 3, minTreats: 0 },
  { id: "zoomies", label: "Zoomies", unlock: "Feed 3 treats", short: "3 treats", minPets: 0, minTreats: 3 },
  {
    id: "wizard",
    label: "Tiny wizard",
    unlock: "Pet 8 times and feed 5 treats",
    short: "8 pets + 5 treats",
    minPets: 8,
    minTreats: 5,
  },
  {
    id: "chaos",
    label: "Chaos gremlin",
    unlock: "Pet 15 times and feed 10 treats",
    short: "15 pets + 10 treats",
    minPets: 15,
    minTreats: 10,
  },
] as const;

const EXPRESSION_IDS = new Set<CatExpression>(EXPRESSIONS.map((expression) => expression.id));
const STORAGE_KEY = "mint-cat-demo-v1";

const PET_MESSAGES = [
  "purr purr. You have excellent hands.",
  "The cat accepts your affection. A rare honor.",
  "*tiny pixel tail wiggle*",
  "MINT has received +1 emotional support.",
  "Purrrrr. Productivity buff activated.",
];

const TREAT_MESSAGES = [
  "nom nom. One pixel treat, gone.",
  "MINT is now 3% more powerful. Probably.",
  "*crunch crunch* Thanks, human.",
  "Treat accepted. The tiny chef approves.",
];

interface CatState {
  pets: number;
  treats: number;
  unlocked: CatExpression[];
  selected: CatExpression;
  animated: boolean;
}

function defaultState(): CatState {
  return {
    pets: 0,
    treats: 0,
    unlocked: ["idle", "happy"],
    selected: "idle",
    animated: !reducedMotion(),
  };
}

function loadState(): CatState {
  const fallback = defaultState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return fallback;

    const parsed = JSON.parse(raw) as Partial<CatState>;
    const pets = Number.isFinite(parsed.pets) ? Math.max(0, Math.floor(Number(parsed.pets))) : 0;
    const treats = Number.isFinite(parsed.treats) ? Math.max(0, Math.floor(Number(parsed.treats))) : 0;
    const unlocked = Array.isArray(parsed.unlocked)
      ? parsed.unlocked.filter(
          (id): id is CatExpression => typeof id === "string" && EXPRESSION_IDS.has(id as CatExpression),
        )
      : [];

    for (const id of unlockedFor(pets, treats)) {
      if (!unlocked.includes(id)) unlocked.push(id);
    }

    const selected =
      typeof parsed.selected === "string" &&
      unlocked.includes(parsed.selected as CatExpression)
        ? (parsed.selected as CatExpression)
        : "idle";

    return {
      pets,
      treats,
      unlocked,
      selected,
      animated: typeof parsed.animated === "boolean" ? parsed.animated : fallback.animated,
    };
  } catch {
    return fallback;
  }
}

function saveState(state: CatState): void {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // The demo still works without persistence.
  }
}

function unlockedFor(pets: number, treats: number): CatExpression[] {
  return EXPRESSIONS.filter(
    (expression) => pets >= expression.minPets && treats >= expression.minTreats,
  ).map((expression) => expression.id);
}

function expressionInfo(id: CatExpression): ExpressionInfo {
  return EXPRESSIONS.find((expression) => expression.id === id) ?? EXPRESSIONS[0]!;
}

export function initCatPlayground(): void {
  const image = $<HTMLImageElement>("[data-cat-stage]");
  const list = $<HTMLElement>("[data-expression-list]");
  const canvasWrap = image?.closest<HTMLElement>(".cat-canvas-wrap") ?? null;
  if (!image || !list || !canvasWrap) return;

  const state = loadState();
  const frameLabel = $<HTMLElement>("[data-cat-frame]");
  const frameTotal = $<HTMLElement>("[data-cat-frame-total]");
  const petCount = $<HTMLElement>("[data-pet-count]");
  const feedCount = $<HTMLElement>("[data-feed-count]");
  const animateToggle = $<HTMLInputElement>("[data-cat-animate]");
  const unlockLabel = $<HTMLElement>("[data-cat-unlock]");
  const catToast = $<HTMLElement>("[data-cat-toast]");
  const petButton = $<HTMLButtonElement>("[data-pet]");
  const feedButton = $<HTMLButtonElement>("[data-feed]");
  const unlockAll = $<HTMLButtonElement>("[data-unlock-all]");
  const resetButton = $<HTMLButtonElement>("[data-reset-cat]");

  let toastTimer = 0;
  let moodTimer = 0;

  const view = new CatPlayer({
    image,
    stage: canvasWrap,
    expression: state.selected,
    animated: state.animated && !reducedMotion(),
    onFrame: (frame, total) => {
      setText(frameLabel, String(frame).padStart(2, "0"));
      setText(frameTotal, String(total).padStart(2, "0"));
    },
  });

  const pills = new Map<CatExpression, HTMLButtonElement>();

  const showCatMessage = (message: string): void => {
    if (!catToast) return;
    window.clearTimeout(toastTimer);
    catToast.textContent = message;
    toastTimer = window.setTimeout(() => {
      catToast.textContent = "";
    }, 3400);
  };

  const scheduleMoodReset = (): void => {
    window.clearTimeout(moodTimer);
    moodTimer = window.setTimeout(() => {
      view.play(state.selected);
    }, 2200);
  };

  const spawnHearts = (): void => {
    if (!canvasWrap || reducedMotion()) return;
    for (let index = 0; index < 3; index += 1) {
      const heart = document.createElement("span");
      heart.className = "cat-heart";
      heart.textContent = index === 1 ? "♡" : "♥";
      heart.style.left = `${34 + Math.random() * 32}%`;
      heart.style.top = `${42 + Math.random() * 20}%`;
      heart.style.animationDelay = `${index * 90}ms`;
      canvasWrap.append(heart);
      window.setTimeout(() => heart.remove(), 1700);
    }
  };

  const refresh = (): void => {
    setText(petCount, String(state.pets));
    setText(feedCount, String(state.treats));

    if (animateToggle) {
      animateToggle.checked = state.animated && !reducedMotion();
      animateToggle.disabled = reducedMotion();
      animateToggle.closest(".switch")?.classList.toggle("is-disabled", reducedMotion());
    }

    for (const info of EXPRESSIONS) {
      const button = pills.get(info.id);
      if (!button) continue;

      const unlocked = state.unlocked.includes(info.id);
      const selected = state.selected === info.id;
      const label = button.querySelector("span");

      button.classList.toggle("is-locked", !unlocked);
      button.classList.toggle("is-selected", selected);
      button.setAttribute("aria-checked", String(selected));
      button.setAttribute("aria-disabled", String(!unlocked));
      button.tabIndex = selected ? 0 : -1;
      if (label) label.textContent = unlocked ? "unlocked" : info.short;
    }

    const next = EXPRESSIONS.find((expression) => !state.unlocked.includes(expression.id));
    setText(
      unlockLabel,
      next
        ? `${next.label} unlock at ${next.short}.`
        : "All six expressions unlocked. Chaos is contained.",
    );

    const selectedInfo = expressionInfo(state.selected);
    image.alt = `MINT the cat, ${selectedInfo.label} expression, from the harness asset pack.`;
  };

  const chooseExpression = (info: ExpressionInfo): void => {
    if (!state.unlocked.includes(info.id)) {
      const message = `Locked — ${info.unlock.toLowerCase()}.`;
      showToast(message);
      showCatMessage(message);
      return;
    }

    window.clearTimeout(moodTimer);
    state.selected = info.id;
    saveState(state);
    view.play(info.id);
    refresh();
    showCatMessage(`Expression: ${info.label}.`);
  };

  for (const info of EXPRESSIONS) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "expression-pill";
    button.dataset.expression = info.id;
    button.setAttribute("role", "radio");
    button.setAttribute("aria-checked", "false");

    const title = document.createElement("strong");
    title.textContent = info.label;
    const meta = document.createElement("span");
    meta.textContent = info.short;
    button.append(title, meta);

    button.addEventListener("click", () => chooseExpression(info));
    list.append(button);
    pills.set(info.id, button);
  }

  // Radios share one tab stop and support the usual arrow-key navigation.
  list.addEventListener("keydown", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement) || !target.dataset.expression) return;

    const index = EXPRESSIONS.findIndex((expression) => expression.id === target.dataset.expression);
    if (index === -1) return;

    let next = index;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") next = (index + 1) % EXPRESSIONS.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") next = (index - 1 + EXPRESSIONS.length) % EXPRESSIONS.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = EXPRESSIONS.length - 1;
    else return;

    event.preventDefault();
    const nextInfo = EXPRESSIONS[next];
    if (nextInfo) pills.get(nextInfo.id)?.focus();
  });

  const applyUnlocks = (): ExpressionInfo[] => {
    const before = new Set(state.unlocked);
    const earned = new Set([...state.unlocked, ...unlockedFor(state.pets, state.treats)]);
    state.unlocked = EXPRESSIONS.filter((expression) => earned.has(expression.id)).map(
      (expression) => expression.id,
    );
    return EXPRESSIONS.filter(
      (expression) => state.unlocked.includes(expression.id) && !before.has(expression.id),
    );
  };

  const unlockSuffix = (unlocked: ExpressionInfo[]): string =>
    unlocked.length ? ` Unlocked: ${unlocked.map((expression) => expression.label).join(", ")}.` : "";

  petButton?.addEventListener("click", () => {
    state.pets += 1;
    const unlocked = applyUnlocks();
    const message = PET_MESSAGES[(state.pets - 1) % PET_MESSAGES.length]!;

    view.play(state.pets % 4 === 0 ? "love" : "happy");
    saveState(state);
    refresh();
    spawnHearts();
    scheduleMoodReset();
    showCatMessage(`${message}${unlockSuffix(unlocked)}`);
    showToast(`${message}${unlockSuffix(unlocked)}`, 3200);
  });

  feedButton?.addEventListener("click", () => {
    state.treats += 1;
    const unlocked = applyUnlocks();
    const message = TREAT_MESSAGES[(state.treats - 1) % TREAT_MESSAGES.length]!;

    view.play(state.treats % 3 === 0 ? "zoomies" : "happy");
    saveState(state);
    refresh();
    scheduleMoodReset();
    showCatMessage(`${message}${unlockSuffix(unlocked)}`);
    showToast(`${message}${unlockSuffix(unlocked)}`, 3200);
  });

  animateToggle?.addEventListener("change", () => {
    if (reducedMotion()) {
      animateToggle.checked = false;
      return;
    }
    state.animated = animateToggle.checked;
    view.setAnimated(state.animated);
    saveState(state);
    showCatMessage(state.animated ? "Animation on. The cat resumes its tiny routine." : "Animation paused. A still life.");
  });

  unlockAll?.addEventListener("click", () => {
    state.unlocked = EXPRESSIONS.map((expression) => expression.id);
    saveState(state);
    refresh();
    showCatMessage("All six expressions unlocked for this browser demo.");
    showToast("All expressions unlocked. The real cat makes you earn them.", 3200);
  });

  resetButton?.addEventListener("click", () => {
    const fresh = defaultState();
    state.pets = fresh.pets;
    state.treats = fresh.treats;
    state.unlocked = fresh.unlocked;
    state.selected = fresh.selected;
    state.animated = fresh.animated;

    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch {
      // Ignore storage failures.
    }

    window.clearTimeout(moodTimer);
    view.play(state.selected);
    view.setAnimated(state.animated);
    refresh();
    showCatMessage("Cat reset. It has forgotten you already.");
    showToast("Cat demo reset. Nothing outside your browser was touched.");
  });

  refresh();
}
