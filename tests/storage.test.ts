import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore } from "../src/storage";

let directory = "";
let store: SessionStore | undefined;
afterEach(() => {
  store?.close();
  store = undefined;
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
});

describe("SessionStore", () => {
  test("creates sessions and persists messages", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    store = new SessionStore(join(directory, "test.sqlite"));
    const session = store.createSessionWithMessage("model-x", { role: "user", content: "hello mint" });
    store.addMessage(session.id, { role: "assistant", content: "mrrp" });
    expect(store.getMessages(session.id)).toEqual([
      { role: "user", content: "hello mint" },
      { role: "assistant", content: "mrrp" },
    ]);
    expect(store.getSession(session.id)?.title).toBe("hello mint");
  });

  test("createSessionWithMessage uses custom title when provided", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    store = new SessionStore(join(directory, "test.sqlite"));
    const session = store.createSessionWithMessage("model-x", { role: "user", content: "hello mint" }, "custom title");
    expect(store.getSession(session.id)?.title).toBe("custom title");
  });

  test("createSessionWithMessage truncates long titles", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    store = new SessionStore(join(directory, "test.sqlite"));
    const longTitle = "a".repeat(100);
    const session = store.createSessionWithMessage("model-x", { role: "user", content: "hello mint" }, longTitle);
    expect(store.getSession(session.id)?.title.length).toBe(64);
  });

  test("addMessage does not change session title", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    store = new SessionStore(join(directory, "test.sqlite"));
    const session = store.createSession("model-x", "my custom title");
    store.addMessage(session.id, { role: "user", content: "hello mint" });
    expect(store.getSession(session.id)?.title).toBe("my custom title");
  });

  test("persists cat progress and animation preference", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    store = new SessionStore(join(directory, "test.sqlite"));
    const profile = store.getCatProfile();
    expect(profile.pets).toBe(0);
    store.updateCatProfile({ ...profile, pets: 3, treats: 2, selectedExpression: "love", animationsEnabled: false, unlockedExpressions: ["idle", "happy", "love"] });
    expect(store.getCatProfile()).toEqual({ pets: 3, treats: 2, selectedExpression: "love", animationsEnabled: false, unlockedExpressions: ["idle", "happy", "love"] });
  });

  test("lists newest sessions first and deletes their messages", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    store = new SessionStore(join(directory, "test.sqlite"));
    const first = store.createSession("model-a");
    const second = store.createSession("model-b");
    store.addMessage(first.id, { role: "user", content: "persist me" });
    expect(store.listSessions().length).toBe(2);
    store.deleteSession(first.id);
    expect(store.getSession(first.id)).toBeNull();
    expect(store.getMessages(first.id)).toEqual([]);
    expect(store.getSession(second.id)?.model).toBe("model-b");
  });

  test("renameSession updates session title", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    store = new SessionStore(join(directory, "test.sqlite"));
    const session = store.createSession("model-x", "old title");
    store.renameSession(session.id, "new title");
    expect(store.getSession(session.id)?.title).toBe("new title");
  });

  test("renameSession truncates long titles", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    store = new SessionStore(join(directory, "test.sqlite"));
    const session = store.createSession("model-x", "old title");
    const longTitle = "a".repeat(100);
    store.renameSession(session.id, longTitle);
    expect(store.getSession(session.id)?.title.length).toBe(64);
  });
});
