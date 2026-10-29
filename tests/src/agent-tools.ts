import type { FunctionTool } from "./nvidia";
import type { WorkspaceTools } from "./tools";
import type { ApprovedTerminal } from "./terminal";

export type HarnessCapability = {
  id: string;
  available: boolean;
  description: string;
  access: "read" | "approval-required" | "unavailable";
};

type ToolExecution = { ok: true; output: string } | { ok: false; error: string };

const stringProperty = (description: string) => ({ type: "string", description });

/** This registry is the source of truth for what the model can actually invoke. */
export function getCapabilities(workspaceReady: boolean): HarnessCapability[] {
  return [
    { id: "workspace.list", available: workspaceReady, description: "List files and directories inside the configured workspace.", access: workspaceReady ? "read" : "unavailable" },
    { id: "workspace.read", available: workspaceReady, description: "Read bounded, recognized text files inside the configured workspace; sensitive files are blocked.", access: workspaceReady ? "read" : "unavailable" },
    { id: "workspace.search", available: workspaceReady, description: "Search recognized text files inside the configured workspace with size and result limits.", access: workspaceReady ? "read" : "unavailable" },
    { id: "workspace.propose_write", available: workspaceReady, description: "Prepare a full-file replacement proposal. It does not change the file until the user reviews it and explicitly runs /apply.", access: workspaceReady ? "approval-required" : "unavailable" },
    { id: "workspace.propose_patch", available: workspaceReady, description: "Prepare a targeted exact-text patch proposal. Changes still require /apply.", access: workspaceReady ? "approval-required" : "unavailable" },
    { id: "workspace.project_context", available: workspaceReady, description: "Discover project manifests, README/AGENTS documents, project type, and .gitignore.", access: workspaceReady ? "read" : "unavailable" },
    { id: "terminal.approved_execute", available: workspaceReady, description: "Run a restricted command only after the user inspects its preview and explicitly types /run. The model cannot approve execution.", access: workspaceReady ? "approval-required" : "unavailable" },
    { id: "web.browse", available: false, description: "Browse the public internet. No browser/search tool is registered in this version.", access: "unavailable" },
    { id: "external_apps", available: false, description: "Act on external apps or accounts. No external connectors are registered in this version.", access: "unavailable" },
  ];
}

export function buildSystemPrompt(workspaceReady: boolean, workspaceRoot?: string): string {
  const capabilities = getCapabilities(workspaceReady);
  const available = capabilities.filter((capability) => capability.available);
  const unavailable = capabilities.filter((capability) => !capability.available);
  return [
    "You are MINT, a friendly and practical coding assistant running inside the MINT harness.",
    "Be concise, accurate, and transparent. Never reveal private chain-of-thought or provide an internal reasoning transcript; give the answer and a brief rationale when useful.",
    "CAPABILITY RULES:",
    "- This list is generated from the active harness registry. Treat it as the source of truth; do not replace it with generic assumptions.",
    "- Use registered tools when they materially help. A tool call is an action request, not proof of success; rely on the returned tool result.",
    "- The harness limits a user turn to six tool rounds and twelve calls. Repeated identical calls are suppressed after two attempts; use prior results rather than looping.",
    "- Never claim a file was read/changed, a command was run, a website was browsed, or an external action was completed unless a tool result confirms it.",
    "- Workspace paths are restricted to the configured root. Do not claim access to arbitrary files elsewhere on the user's machine.",
    "- File edits must use the proposal workflow. Prefer targeted exact-text patches for small edits; use full-file replacement only when appropriate. Never bypass approval; explain that the user must review the diff and run /apply.",
    "- Terminal commands may only be proposed through terminal_propose. Never execute a command directly. The user must inspect the exact command and working directory, then explicitly type /run.",
    "- Use workspace_project_context before making broad project changes when project structure or conventions are unclear. Respect .gitignore and sensitive-file exclusions.",
    "- If a capability is unavailable, say exactly which capability is unavailable in this harness. Do not imply that changing the prompt alone enables it.",
    `WORKSPACE: ${workspaceReady ? `ready at ${workspaceRoot ?? "the configured root"}` : "not ready; workspace tools are currently unavailable"}.`,
    `AVAILABLE CAPABILITIES:\n${available.map((capability) => `- ${capability.id} (${capability.access}): ${capability.description}`).join("\n") || "- none"}`,
    `UNAVAILABLE CAPABILITIES:\n${unavailable.map((capability) => `- ${capability.id}: ${capability.description}`).join("\n")}`,
  ].join("\n\n");
}

export function getModelTools(workspaceReady: boolean): FunctionTool[] {
  if (!workspaceReady) return [];
  return [
    {
      type: "function",
      function: {
        name: "workspace_list",
        description: "List files and directories inside MINT's configured workspace. Paths must be relative to the workspace root.",
        parameters: { type: "object", properties: { path: stringProperty("Relative directory path; defaults to the workspace root.") }, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "workspace_read",
        description: "Read a recognized text file inside MINT's configured workspace. Sensitive files and paths outside the workspace are blocked.",
        parameters: { type: "object", properties: { path: stringProperty("Relative file path to read.") }, required: ["path"], additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "workspace_search",
        description: "Search text in recognized files inside MINT's configured workspace.",
        parameters: { type: "object", properties: { query: stringProperty("Text to search for.") }, required: ["query"], additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "workspace_propose_write",
        description: "Prepare a full-file replacement proposal inside the workspace. This does not write the file. The user must inspect the diff and explicitly run /apply before changes are applied.",
        parameters: { type: "object", properties: { path: stringProperty("Relative path of the text file to replace."), content: stringProperty("Complete replacement file contents.") }, required: ["path", "content"], additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "workspace_propose_patch",
        description: "Prepare an approval-gated targeted exact-text patch. Each find string must occur exactly once in the current file. The user must inspect the preview and run /apply.",
        parameters: { type: "object", properties: { path: stringProperty("Relative path to edit."), edits: { type: "array", items: { type: "object", properties: { find: stringProperty("Exact existing text; must occur once."), replace: stringProperty("Replacement text; may be empty." ) }, required: ["find", "replace"], additionalProperties: false } } }, required: ["path", "edits"], additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "workspace_project_context",
        description: "Discover project type and read common README/AGENTS/manifests plus .gitignore within safe size limits.",
        parameters: { type: "object", properties: {}, additionalProperties: false },
      },
    },
    {
      type: "function",
      function: {
        name: "terminal_propose",
        description: "Prepare a restricted terminal command for user review. This NEVER runs it. The user must inspect command and working directory and type /run to approve.",
        parameters: { type: "object", properties: { command: stringProperty("One executable and its arguments; no shell operators or redirection."), cwd: stringProperty("Workspace-relative working directory; defaults to ."), timeoutMs: { type: "integer", description: "Timeout between 1000 and 120000 milliseconds; defaults to 120000." } }, required: ["command"], additionalProperties: false },
      },
    },
  ];
}

export async function executeModelTool(
  name: string,
  rawArguments: string,
  workspace: WorkspaceTools | undefined,
  onProposalCreated: (id: string) => void,
  terminal?: ApprovedTerminal,
  onCommandCreated: (id: string) => void = () => {},
): Promise<ToolExecution> {
  if (!workspace) return { ok: false, error: "Workspace tools are unavailable because workspace initialization has not succeeded." };
  let args: Record<string, unknown>;
  try {
    const parsed: unknown = JSON.parse(rawArguments || "{}");
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: "Tool arguments must be a JSON object." };
    args = parsed as Record<string, unknown>;
  } catch { return { ok: false, error: "Tool arguments were not valid JSON." }; }
  const path = typeof args.path === "string" ? args.path : "";
  switch (name) {
    case "workspace_list":
      return workspace.list(typeof args.path === "string" ? args.path : ".");
    case "workspace_read":
      if (!path) return { ok: false, error: "Missing required argument: path." };
      return workspace.read(path);
    case "workspace_search":
      if (typeof args.query !== "string" || !args.query.trim()) return { ok: false, error: "Missing required argument: query." };
      return workspace.search(args.query);
    case "workspace_propose_write": {
      if (!path || typeof args.content !== "string") return { ok: false, error: "Required arguments: path and content." };
      const result = await workspace.proposeWrite(path, args.content);
      if (!result.ok) return result;
      onProposalCreated(result.proposal.id);
      return { ok: true, output: `PROPOSAL CREATED — no file has been changed.\nPath: ${result.proposal.path}\nProposal ID: ${result.proposal.id}\nReview the preview below. The user must explicitly run /apply to apply this change.\n\n${result.proposal.preview}` };
    }
    case "workspace_project_context":
      return workspace.projectContext();
    case "workspace_propose_patch": {
      if (!path || !Array.isArray(args.edits)) return { ok: false, error: "Required arguments: path and edits array." };
      const edits = args.edits as Array<{ find: string; replace: string }>;
      const result = await workspace.proposePatch(path, edits);
      if (!result.ok) return result;
      onProposalCreated(result.proposal.id);
      return { ok: true, output: `PATCH PROPOSAL CREATED — no file has been changed.\nPath: ${result.proposal.path}\nProposal ID: ${result.proposal.id}\nReview the preview and explicitly run /apply.\n\n${result.proposal.preview}` };
    }
    case "terminal_propose": {
      if (!terminal) return { ok: false, error: "Terminal commands are unavailable." };
      if (typeof args.command !== "string") return { ok: false, error: "Required argument: command." };
      const result = await terminal.propose(args.command, typeof args.cwd === "string" ? args.cwd : ".", typeof args.timeoutMs === "number" ? args.timeoutMs : 120_000);
      if (!result.ok) return result;
      onCommandCreated(result.proposal.id);
      return { ok: true, output: `COMMAND PROPOSAL — NOT EXECUTED\nID: ${result.proposal.id}\nCommand: ${result.proposal.command}\nWorking directory: ${result.proposal.cwd}\nTimeout: ${result.proposal.timeoutMs} ms\nInspect this command, then the user must explicitly type /run to execute it.` };
    }
    default:
      return { ok: false, error: `Tool '${name}' is not registered in this harness.` };
  }
}
