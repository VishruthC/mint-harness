export type ApprovalRequestKind = "permission" | "apply" | "update";

export type ApprovalAction =
  | "allow-once"
  | "allow-always"
  | "reject"
  | "apply"
  | "update"
  | "cancel";

export type FileApplyDetails = {
  kind: "file-apply";
  proposalId: string;
  path: string;
  preview: string;
  additions: number;
  deletions: number;
  totalLines: number;
  tool?: string;
};

export type CommandPermissionDetails = {
  kind: "command";
  proposalId: string;
  command: string;
  cwd: string;
  timeoutMs: number;
};

export type UpdateDetails = {
  kind: "update";
  fromVersion: string;
  toVersion: string;
  command: string;
};

export type ApprovalDetails = FileApplyDetails | CommandPermissionDetails | UpdateDetails;

export type ApprovalRequest = {
  id: string;
  seq: number;
  kind: ApprovalRequestKind;
  title: string;
  description: string;
  resource: string;
  patterns: string[];
  details: ApprovalDetails;
  scopeKey: string;
  actions: ApprovalAction[];
  defaultAction: ApprovalAction;
  fullscreenDetails: string[];
  createdAt: number;
  stale: boolean;
};

export function createApplyRequest(
  seq: number,
  details: FileApplyDetails,
): ApprovalRequest {
  const title = "△ Apply changes?";
  const description = `Apply proposed changes to ${details.path}`;
  const patterns = [details.path];
  const fullscreenDetails = [
    `Proposal: ${details.proposalId}`,
    `Path: ${details.path}`,
    `Additions: +${details.additions}`,
    `Deletions: -${details.deletions}`,
    `Total lines: ${details.totalLines}`,
    details.tool ? `Tool: ${details.tool}` : "",
    "",
    "Preview:",
    details.preview || "(no preview)",
  ].filter((line): line is string => line !== undefined);
  return {
    id: `approval-file-${details.proposalId}`,
    seq,
    kind: "apply",
    title,
    description,
    resource: details.path,
    patterns,
    details,
    scopeKey: `file:${details.path}`,
    actions: ["apply", "reject"],
    defaultAction: "apply",
    fullscreenDetails,
    createdAt: Date.now(),
    stale: false,
  };
}

export function createCommandPermissionRequest(
  seq: number,
  details: CommandPermissionDetails,
): ApprovalRequest {
  const resource = `${details.cwd}$ ${details.command}`;
  const pattern = `command:${details.cwd}:${details.command}`;
  return {
    id: `approval-command-${details.proposalId}`,
    seq,
    kind: "permission",
    title: "△ Permission required",
    description: "Run approved terminal command",
    resource,
    patterns: [pattern],
    details,
    scopeKey: pattern,
    actions: ["allow-once", "allow-always", "reject"],
    defaultAction: "allow-once",
    fullscreenDetails: [
      "Request: terminal command",
      `Proposal ID: ${details.proposalId}`,
      `Command: ${details.command}`,
      `Working directory: ${details.cwd}`,
      `Timeout: ${details.timeoutMs} ms`,
      "",
      "Permission patterns:",
      `- ${pattern}`,
      "",
      "This command will run only after explicit approval.",
    ],
    createdAt: Date.now(),
    stale: false,
  };
}

export function createUpdateRequest(
  seq: number,
  details: UpdateDetails,
): ApprovalRequest {
  return {
    id: `approval-update-${details.toVersion}`,
    seq,
    kind: "update",
    title: "✨ MINT update available!",
    description: `Update MINT from ${details.fromVersion} to ${details.toVersion}?`,
    resource: "mint-harness · npm registry",
    patterns: [details.command],
    details,
    scopeKey: `update:${details.toVersion}`,
    actions: ["update", "cancel"],
    defaultAction: "update",
    fullscreenDetails: [
      `Installed: ${details.fromVersion}`,
      `Latest stable: ${details.toVersion}`,
      "",
      "MINT will run:",
      details.command,
      "",
      "The update is downloaded from the public npm registry.",
      "MINT will not restart automatically; restart it after the update.",
    ],
    createdAt: Date.now(),
    stale: false,
  };
}

export function moveActionIndex(current: number, delta: number, count: number): number {
  if (count <= 0) return 0;
  return (current + delta + count) % count;
}

export function actionLabel(action: ApprovalAction): string {
  switch (action) {
    case "allow-once":
      return "Allow once";
    case "allow-always":
      return "Allow always";
    case "reject":
      return "Reject";
    case "apply":
      return "Apply";
    case "update":
      return "Yes, update";
    case "cancel":
      return "Cancel";
  }
}

export function footerHint(kind: ApprovalRequestKind): string {
  if (kind === "apply") {
    return "Apply   Reject   ctrl+f fullscreen   ⇆ select   enter confirm";
  }
  if (kind === "update") {
    return "Yes, update   Cancel   ctrl+f fullscreen   ⇆ select   enter confirm";
  }
  return "Allow once   Allow always   Reject   ctrl+f fullscreen   ⇆ select   enter confirm";
}

export class ApprovalQueue {
  private items: ApprovalRequest[] = [];
  private nextSeq = 1;

  enqueue(request: Omit<ApprovalRequest, "seq">): ApprovalRequest {
    const queued: ApprovalRequest = { ...request, seq: this.nextSeq++ };
    this.items.push(queued);
    return queued;
  }

  current(): ApprovalRequest | undefined {
    return this.items[0];
  }

  all(): ApprovalRequest[] {
    return [...this.items];
  }

  size(): number {
    return this.items.length;
  }

  /** Resolve and remove the current request only if it still matches. */
  resolveCurrent(request: ApprovalRequest): ApprovalRequest | undefined {
    const current = this.items[0];
    if (!current) return undefined;
    if (current.id !== request.id || current.seq !== request.seq) return undefined;
    this.items.shift();
    return current;
  }

  /** Mark matching requests stale and remove them (e.g. replaced by newer state). */
  removeByPredicate(predicate: (request: ApprovalRequest) => boolean): ApprovalRequest[] {
    const removed: ApprovalRequest[] = [];
    const kept: ApprovalRequest[] = [];
    for (const item of this.items) {
      if (predicate(item)) removed.push({ ...item, stale: true });
      else kept.push(item);
    }
    this.items = kept;
    return removed;
  }

  clear(): ApprovalRequest[] {
    const removed = this.items.map((item) => ({ ...item, stale: true }));
    this.items = [];
    return removed;
  }
}

export function shouldAutoApprove(scopeKey: string, allowed: Set<string> | { has: (key: string) => boolean }): boolean {
  return allowed.has(scopeKey);
}
