/**
 * Terminal image capability detection.
 *
 * Mint renders PNGs through OpenTUI's `<image>` element, which negotiates the
 * protocol with the terminal (kitty graphics / sixel / blocks). This module
 * never emits image escape sequences itself: it reads OpenTUI's detected
 * capabilities, applies the user's renderer override, and decides between the
 * image widget and the ASCII fallback. Detection is conservative — no env-var
 * guessing — and unsupported terminals degrade quietly to ASCII.
 */
import type { TerminalCapabilities } from "@opentui/core";
import type { CatRendererName } from "./types.ts";

export interface RendererDecision {
  kind: "image" | "ascii";
  protocol: "auto" | "kitty" | "sixel" | "blocks";
  reason: string;
}

export function decideRenderer(configured: CatRendererName, capabilities: TerminalCapabilities | null): RendererDecision {
  if (configured === "ascii") return { kind: "ascii", protocol: "auto", reason: "renderer forced to ascii" };
  if (capabilities === null) {
    // No detection answer yet (e.g. redirected output): OpenTUI negotiates
    // and picks the safest protocol itself.
    return { kind: "image", protocol: "auto", reason: "detection pending" };
  }
  // Explicit override wins when the terminal supports it.
  if (configured !== "auto") {
    const supported =
      (configured === "kitty" && capabilities.kitty_graphics) ||
      (configured === "sixel" && capabilities.sixel) ||
      configured === "blocks";
    if (supported) return { kind: "image", protocol: configured, reason: `${configured} forced` };
    // Forced protocol unsupported here: keep image intent and let OpenTUI fall back.
    return { kind: "image", protocol: "auto", reason: `${configured} unsupported; auto` };
  }
  if (capabilities.kitty_graphics) return { kind: "image", protocol: "kitty", reason: "kitty detected" };
  if (capabilities.sixel) return { kind: "image", protocol: "sixel", reason: "sixel detected" };
  // Blocks still render real images (OpenTUI rasterizes to subcells).
  return { kind: "image", protocol: "blocks", reason: "no kitty/sixel; blocks" };
}

export function capabilitiesFrom(env: NodeJS.ProcessEnv = process.env): { term: string; program: string; tmux: boolean } {
  return {
    term: env.TERM ?? "",
    program: env.TERM_PROGRAM ?? "",
    tmux: Boolean(env.TMUX),
  };
}
