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
    const session = store.createSession("model-x");
    store.addMessage(session.id, { role: "user", content: "hello mint" });
    store.addMessage(session.id, { role: "assistant", content: "mrrp" });
    expect(store.getMessages(session.id)).toEqual([
      { role: "user", content: "hello mint" },
      { role: "assistant", content: "mrrp" },
    ]);
    expect(store.getSession(session.id)?.title).toBe("hello mint");
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
});
