import { describe, expect, test } from "bun:test";
import {
  ApprovalQueue,
  actionLabel,
  createApplyRequest,
  createCommandPermissionRequest,
  footerHint,
  moveActionIndex,
  shouldAutoApprove,
} from "../src/approval";

describe("approval requests", () => {
  test("creates apply request with apply/reject actions and file scope", () => {
    const request = createApplyRequest(1, {
      kind: "file-apply",
      proposalId: "abc12345",
      path: "src/app.ts",
      preview: "--- a/src/app.ts\n+++ b/src/app.ts\n@@\n-old\n+new",
      additions: 1,
      deletions: 1,
      totalLines: 4,
      tool: "workspace_propose_patch",
    });
    expect(request.kind).toBe("apply");
    expect(request.title).toContain("Apply changes");
    expect(request.resource).toBe("src/app.ts");
    expect(request.patterns).toEqual(["src/app.ts"]);
    expect(request.actions).toEqual(["apply", "reject"]);
    expect(request.defaultAction).toBe("apply");
    expect(request.scopeKey).toBe("file:src/app.ts");
    expect(request.fullscreenDetails.join("\n")).toContain("Preview:");
    expect(request.fullscreenDetails.join("\n")).toContain("Proposal: abc12345");
  });

  test("creates command permission request with allow-once/allow-always/reject", () => {
    const request = createCommandPermissionRequest(2, {
      kind: "command",
      proposalId: "cmd12345",
      command: "bun run typecheck",
      cwd: ".",
      timeoutMs: 120000,
    });
    expect(request.kind).toBe("permission");
    expect(request.title).toContain("Permission required");
    expect(request.resource).toContain("bun run typecheck");
    expect(request.patterns[0]).toContain("command:");
    expect(request.actions).toEqual(["allow-once", "allow-always", "reject"]);
    expect(request.defaultAction).toBe("allow-once");
    expect(request.scopeKey).toBe("command:.:bun run typecheck");
  });

  test("moves selected action with wrapping", () => {
    expect(moveActionIndex(0, 1, 3)).toBe(1);
    expect(moveActionIndex(2, 1, 3)).toBe(0);
    expect(moveActionIndex(0, -1, 3)).toBe(2);
    expect(moveActionIndex(1, -1, 3)).toBe(0);
    expect(moveActionIndex(0, 1, 0)).toBe(0);
  });

  test("formats action labels and footer hints", () => {
    expect(actionLabel("allow-once")).toBe("Allow once");
    expect(actionLabel("allow-always")).toBe("Allow always");
    expect(actionLabel("reject")).toBe("Reject");
    expect(actionLabel("apply")).toBe("Apply");
    expect(footerHint("permission")).toContain("Allow once");
    expect(footerHint("permission")).toContain("ctrl+f fullscreen");
    expect(footerHint("apply")).toContain("Apply   Reject");
    expect(footerHint("apply")).not.toContain("Allow always");
  });
});

describe("approval queue", () => {
  test("queues multiple requests and resolves only the current matching request", () => {
    const queue = new ApprovalQueue();
    const first = queue.enqueue(createApplyRequest(0, {
      kind: "file-apply",
      proposalId: "a",
      path: "a.ts",
      preview: "diff",
      additions: 1,
      deletions: 0,
      totalLines: 1,
    }));
    const second = queue.enqueue(createCommandPermissionRequest(0, {
      kind: "command",
      proposalId: "b",
      command: "bun --version",
      cwd: ".",
      timeoutMs: 120000,
    }));

    expect(queue.size()).toBe(2);
    expect(queue.current()?.id).toBe(first.id);
    expect(queue.resolveCurrent({ ...second })).toBeUndefined();
    expect(queue.size()).toBe(2);

    expect(queue.resolveCurrent(first)?.id).toBe(first.id);
    expect(queue.current()?.id).toBe(second.id);
    expect(queue.size()).toBe(1);
  });

  test("removes and marks requests stale by predicate", () => {
    const queue = new ApprovalQueue();
    queue.enqueue(createApplyRequest(0, {
      kind: "file-apply",
      proposalId: "a",
      path: "a.ts",
      preview: "diff",
      additions: 1,
      deletions: 0,
      totalLines: 1,
    }));
    queue.enqueue(createApplyRequest(0, {
      kind: "file-apply",
      proposalId: "b",
      path: "b.ts",
      preview: "diff",
      additions: 1,
      deletions: 0,
      totalLines: 1,
    }));
    const removed = queue.removeByPredicate((req) => req.details.proposalId === "a");
    expect(removed).toHaveLength(1);
    expect(removed[0]?.stale).toBe(true);
    expect(queue.size()).toBe(1);
    expect(queue.current()?.details.proposalId).toBe("b");
  });

  test("clear empties the queue and marks items stale", () => {
    const queue = new ApprovalQueue();
    queue.enqueue(createApplyRequest(0, {
      kind: "file-apply",
      proposalId: "a",
      path: "a.ts",
      preview: "diff",
      additions: 1,
      deletions: 0,
      totalLines: 1,
    }));
    const removed = queue.clear();
    expect(removed).toHaveLength(1);
    expect(removed[0]?.stale).toBe(true);
    expect(queue.size()).toBe(0);
  });

  test("auto-approve checks exact scope keys only", () => {
    const allowed = new Set(["command:.:bun --version"]);
    expect(shouldAutoApprove("command:.:bun --version", allowed)).toBe(true);
    expect(shouldAutoApprove("command:.:bun test", allowed)).toBe(false);
  });
});
