import type { CatProfile } from "./storage";

export type CatMood = "idle" | "curious" | "thinking" | "happy" | "error" | "zoomies" | "sleepy" | "love";

export const CAT_EXPRESSIONS = [
  { id: "idle", label: "Classic loaf", unlock: "Always available", minPets: 0, minTreats: 0 },
  { id: "happy", label: "Happy eyes", unlock: "Always available", minPets: 0, minTreats: 0 },
  { id: "love", label: "Heart eyes", unlock: "Pet 3 times", minPets: 3, minTreats: 0 },
  { id: "zoomies", label: "Zoomies", unlock: "Feed 3 treats", minPets: 0, minTreats: 3 },
  { id: "wizard", label: "Tiny wizard", unlock: "Pet 8 times and feed 5 treats", minPets: 8, minTreats: 5 },
  { id: "chaos", label: "Chaos gremlin", unlock: "Pet 15 times and feed 10 treats", minPets: 15, minTreats: 10 },
] as const;

export function unlockCatExpressions(profile: CatProfile): CatProfile {
  const unlocked = new Set(profile.unlockedExpressions);
  for (const expression of CAT_EXPRESSIONS) {
    if (profile.pets >= expression.minPets && profile.treats >= expression.minTreats) unlocked.add(expression.id);
  }
  return { ...profile, unlockedExpressions: [...unlocked] };
}

export function petCat(profile: CatProfile): { profile: CatProfile; mood: CatMood; message: string; unlocked: string[] } {
  const before = new Set(profile.unlockedExpressions);
  const next = unlockCatExpressions({ ...profile, pets: profile.pets + 1 });
  const unlocked = next.unlockedExpressions.filter((id) => !before.has(id));
  const messages = ["purr purr. You have excellent hands.", "The cat accepts your affection. A rare honor.", "*tiny pixel tail wiggle*", "MINT has received +1 emotional support.", "Purrrrr. Productivity buff activated."];
  return { profile: next, mood: next.pets % 4 === 0 ? "love" : "happy", message: messages[(next.pets - 1) % messages.length]!, unlocked };
}

export function feedCat(profile: CatProfile): { profile: CatProfile; mood: CatMood; message: string; unlocked: string[] } {
  const before = new Set(profile.unlockedExpressions);
  const next = unlockCatExpressions({ ...profile, treats: profile.treats + 1 });
  const unlocked = next.unlockedExpressions.filter((id) => !before.has(id));
  const messages = ["nom nom. One pixel treat, gone.", "MINT is now 3% more powerful. Probably.", "*crunch crunch* Thanks, human.", "Treat accepted. The tiny chef approves."];
  return { profile: next, mood: next.treats % 3 === 0 ? "zoomies" : "happy", message: messages[(next.treats - 1) % messages.length]!, unlocked };
}

export function selectCatExpression(profile: CatProfile, expressionId: string): CatProfile {
  if (!profile.unlockedExpressions.includes(expressionId)) return profile;
  return { ...profile, selectedExpression: expressionId };
}

export function catSprite(expression: string, _frame = 0, mood: CatMood = "idle"): string[] {
  // Minimal three-line ASCII cat; keep it readable in narrow terminal sidebars.
  const face = expression === "love" ? "<3" : expression === "wizard" ? "o.*" : expression === "chaos" ? "x.x" : expression === "zoomies" ? "O.O" : mood === "happy" ? "^.^" : mood === "error" ? "x_x" : mood === "sleepy" ? "-.-" : mood === "thinking" ? "o.O" : "o.o";
  return [
    " /\_/\\",
    `( ${face.padEnd(3, " ").slice(0, 3)} )`,
    " > ^ <",
  ];
}

export function catProfileSummary(profile: CatProfile): string {
  return `Pets: ${profile.pets} · Treats: ${profile.treats} · Expressions: ${profile.unlockedExpressions.length}/${CAT_EXPRESSIONS.length} · Animations: ${profile.animationsEnabled ? "on" : "off"}`;
}
