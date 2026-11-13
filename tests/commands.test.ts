import { describe, expect, test } from "bun:test";
import { COMMANDS, filterCommands, formatCommandHelp } from "../src/commands";
import { visibleWindow } from "../src/models";

describe("slash command palette", () => {
  test("includes every implemented command, including aliases and approval commands", () => {
    const names = COMMANDS.map((entry) => entry.command.trim());
    for (const expected of [
      "/help",
      "/update",
      "/version",
      "/models",
      "/model",
      "/retry",
      "/connect",
      "/session",
      "/sessions",
      "/session new",
      "/new",
      "/session delete",
      "/session rename",
      "/workspace",
      "/capabilities",
      "/limits",
      "/project",
      "/command",
      "/run",
      "/reject-command",
      "/ls",
      "/read",
      "/search",
      "/propose",
      "/apply",
      "/approve",
      "/reject",
      "/autoapply",
      "/cancel-write",
      "/cancel",
      "/clear",
      "/quit",
      "/exit",
    ]) {
      expect(names).toContain(expected);
    }
    expect(new Set(names).size).toBe(names.length);
  });

  test("typing only / returns the complete list instead of the first page", () => {
    const all = filterCommands("/");
    expect(all).toHaveLength(COMMANDS.length);
    expect(all.length).toBeGreaterThan(7);
    expect(all.at(-1)?.command.trim()).toBe("/exit");
  });

  test("filters by prefix and keeps subcommands visible after a space", () => {
    expect(filterCommands("/sess").map((entry) => entry.command.trim())).toEqual(
      expect.arrayContaining(["/session", "/sessions", "/session new"]),
    );
    expect(filterCommands("/session ").map((entry) => entry.command.trim())).toEqual(
      expect.arrayContaining(["/session new", "/session delete", "/session rename"]),
    );
    expect(filterCommands("hello")).toEqual([]);
    expect(filterCommands(" /upd").map((entry) => entry.command.trim())).toEqual(["/update"]);
  });

  test("the help text is generated from the same command list", () => {
    const help = formatCommandHelp();
    for (const name of ["/help", "/approve", "/autoapply", "/reject-command", "/new", "/exit"]) {
      expect(help).toContain(name);
    }
  });

  test("the visible window follows the selection through the whole list", () => {
    const rows = 7;
    const last = COMMANDS.length - 1;
    const endWindow = visibleWindow(last, rows, COMMANDS.length);
    expect(endWindow.length).toBeLessThanOrEqual(rows);
    expect(endWindow).toContain(last);
    expect(endWindow[0]).toBe(COMMANDS.length - rows);

    const middleWindow = visibleWindow(16, rows, COMMANDS.length);
    expect(middleWindow).toContain(16);
    expect(middleWindow.length).toBe(rows);
  });
});
