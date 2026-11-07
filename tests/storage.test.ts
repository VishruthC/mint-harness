import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SessionStore, normalizeWorkspace } from "../src/storage";

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

  test("scopes sessions to the exact workspace they were created in", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    const workspaceA = join(directory, "project-a");
    const workspaceB = join(directory, "project-b");
    mkdirSync(workspaceA);
    mkdirSync(workspaceB);
    store = new SessionStore(join(directory, "test.sqlite"));

    const first = store.createSessionWithMessage("model-x", { role: "user", content: "in a" }, undefined, workspaceA);
    const second = store.createSessionWithMessage("model-x", { role: "user", content: "in b" }, undefined, workspaceB);

    expect(store.listSessions(50, workspaceA).map((session) => session.id)).toEqual([first.id]);
    expect(store.listSessions(50, workspaceB).map((session) => session.id)).toEqual([second.id]);
    expect(store.listSessions(50, join(workspaceA, "subdirectory"))).toEqual([]);
    expect(store.listSessions(50, directory)).toEqual([]);
  });

  test("normalizes workspace paths when storing and querying", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    const workspace = join(directory, "project");
    mkdirSync(workspace);
    store = new SessionStore(join(directory, "test.sqlite"));
    const session = store.createSessionWithMessage("model-x", { role: "user", content: "hello" }, undefined, `${workspace}/`);

    expect(store.listSessions(50, workspace).map((item) => item.id)).toEqual([session.id]);
    expect(store.listSessions(50, normalizeWorkspace(workspace)).map((item) => item.id)).toEqual([session.id]);
  });

  test("backfills legacy sessions with the current workspace once", () => {
    directory = mkdtempSync(join(tmpdir(), "mint-test-"));
    const workspace = join(directory, "legacy-project");
    mkdirSync(workspace);
    const path = join(directory, "test.sqlite");
    const db = new Database(path);
    db.exec(`
      CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
      CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE cat_profile (id INTEGER PRIMARY KEY CHECK (id = 1), pets INTEGER NOT NULL DEFAULT 0, treats INTEGER NOT NULL DEFAULT 0, selected_expression TEXT NOT NULL DEFAULT 'idle', animations_enabled INTEGER NOT NULL DEFAULT 1, unlocked_expressions TEXT NOT NULL DEFAULT '["idle","happy"]');
      INSERT INTO cat_profile (id) VALUES (1);
    `);
    db.query("INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("legacy", "title", "model-a", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    db.close();

    const previous = process.env.MINT_WORKSPACE;
    process.env.MINT_WORKSPACE = workspace;
    try {
      store = new SessionStore(path);
      expect(store.listSessions(50, workspace).map((session) => session.id)).toEqual(["legacy"]);
      expect(store.getSession("legacy")?.workspace).toBe(normalizeWorkspace(workspace));
    } finally {
      if (previous === undefined) delete process.env.MINT_WORKSPACE;
      else process.env.MINT_WORKSPACE = previous;
    }
  });
});
test("tracks token usage per session", () => {
  directory = mkdtempSync(join(tmpdir(), "mint-test-"));
  store = new SessionStore(join(directory, "test.sqlite"));
  const first = store.createSession("model-a");
  const second = store.createSession("model-b");
  store.addSessionTokenUsage(first.id, { prompt: 5, completion: 3, total: 8 });
  store.addSessionTokenUsage(first.id, { prompt: 2, completion: 1, total: 3 });
  expect(store.getSessionTokenUsage(first.id)).toEqual({ prompt: 7, completion: 4, total: 11 });
  expect(store.getSessionTokenUsage(second.id)).toEqual({ prompt: 0, completion: 0, total: 0 });
});

test("token usage persists across reopen", () => {
  directory = mkdtempSync(join(tmpdir(), "mint-test-"));
  const path = join(directory, "test.sqlite");
  store = new SessionStore(path);
  const session = store.createSession("model-a");
  store.addSessionTokenUsage(session.id, { prompt: 9, completion: 4, total: 13 });
  store.close();
  store = undefined;
  store = new SessionStore(path);
  expect(store.getSessionTokenUsage(session.id)).toEqual({ prompt: 9, completion: 4, total: 13 });
});

test("migrates legacy databases with token columns", () => {
  directory = mkdtempSync(join(tmpdir(), "mint-test-"));
  const path = join(directory, "test.sqlite");
  const db = new Database(path);
  db.exec(`
    CREATE TABLE sessions (id TEXT PRIMARY KEY, title TEXT NOT NULL, model TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
    CREATE TABLE messages (id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, role TEXT NOT NULL, content TEXT NOT NULL, created_at TEXT NOT NULL);
    CREATE TABLE cat_profile (id INTEGER PRIMARY KEY CHECK (id = 1), pets INTEGER NOT NULL DEFAULT 0, treats INTEGER NOT NULL DEFAULT 0, selected_expression TEXT NOT NULL DEFAULT 'idle', animations_enabled INTEGER NOT NULL DEFAULT 1, unlocked_expressions TEXT NOT NULL DEFAULT '["idle","happy"]');
    INSERT INTO cat_profile (id) VALUES (1);
  `);
  db.query("INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)").run("legacy", "title", "model-a", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
  db.close();

  store = new SessionStore(path);
  expect(store.getSessionTokenUsage("legacy")).toEqual({ prompt: 0, completion: 0, total: 0 });
  store.addSessionTokenUsage("legacy", { prompt: 1, completion: 1, total: 2 });
  expect(store.getSessionTokenUsage("legacy")).toEqual({ prompt: 1, completion: 1, total: 2 });
});
