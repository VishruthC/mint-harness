/**
 * Single source of truth for slash-command discovery.
 *
 * The inline palette and `/help` both read this list so newly implemented
 * commands cannot silently disappear from either surface.
 */
export type CommandEntry = {
  command: string;
  description: string;
};

export const COMMANDS: readonly CommandEntry[] = [
  { command: "/help", description: "Show all commands" },
  { command: "/update", description: "Check for and install the latest stable MINT release" },
  { command: "/version", description: "Display the installed version and update status" },
  { command: "/models", description: "List NVIDIA models" },
  { command: "/model", description: "Choose a model (opens picker)" },
  { command: "/retry", description: "Retry the last user message" },
  { command: "/connect", description: "Configure NVIDIA API credentials" },
  { command: "/session", description: "List or resume sessions" },
  { command: "/sessions", description: "List or resume sessions (alias)" },
  { command: "/session new", description: "Start a fresh session" },
  { command: "/new", description: "Start a fresh session (alias)" },
  { command: "/session delete ", description: "Delete a session" },
  { command: "/session rename ", description: "Rename the active session" },
  { command: "/workspace", description: "Show workspace root" },
  { command: "/capabilities", description: "Show real harness capabilities" },
  { command: "/limits", description: "Show current agent limits (rounds/calls) and config keys" },
  { command: "/project", description: "Inspect project type, manifests, README, and .gitignore" },
  { command: "/command ", description: "Preview a restricted terminal command" },
  { command: "/run", description: "Approve and run the pending command" },
  { command: "/reject-command", description: "Discard the pending terminal command" },
  { command: "/ls ", description: "List workspace files" },
  { command: "/read ", description: "Read a workspace file" },
  { command: "/search ", description: "Search workspace text" },
  { command: "/propose ", description: "Propose a file change" },
  { command: "/apply", description: "Approve the pending change" },
  { command: "/approve", description: "Approve the pending file change or command" },
  { command: "/reject", description: "Discard the pending change" },
  { command: "/autoapply", description: "Show or change auto-apply mode" },
  { command: "/cancel-write", description: "Cancel file proposal input" },
  { command: "/cancel", description: "Stop the current response" },
  { command: "/clear", description: "Start a fresh session" },
  { command: "/quit", description: "Exit MINT" },
  { command: "/exit", description: "Exit MINT (alias)" },
];

/**
 * Filter commands by the current input. Subcommand entries such as
 * `/session new` remain visible after the user types `/session `.
 */
export function filterCommands(value: string): CommandEntry[] {
  const query = value.trimStart();
  if (!query.startsWith("/")) return [];
  return COMMANDS.filter((entry) => entry.command.trim().startsWith(query));
}

export function formatCommandHelp(): string {
  return COMMANDS.map((entry) => entry.command.trim()).join(" · ");
}
