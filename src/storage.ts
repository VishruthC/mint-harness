import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type StoredMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};
export type CatProfile = {
  pets: number;
  treats: number;
  selectedExpression: string;
  animationsEnabled: boolean;
  unlockedExpressions: string[];
};

export type Session = {
  id: string;
  title: string;
  model: string;
  created_at: string;
  updated_at: string;
};

function defaultDbPath() {
  const root = process.env.MINT_DATA_DIR || join(homedir(), ".mint");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  return join(root, "mint.sqlite");
}

export class SessionStore {
  private db: Database;

  constructor(path = defaultDbPath()) {
    this.db = new Database(path, { create: true });
    try { chmodSync(path, 0o600); } catch { /* Some platforms do not support POSIX file modes. */ }
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        model TEXT NOT NULL DEFAULT '',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
        role TEXT NOT NULL CHECK(role IN ('system','user','assistant')),
        content TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_messages_session_id ON messages(session_id, id);
      CREATE TABLE IF NOT EXISTS cat_profile (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        pets INTEGER NOT NULL DEFAULT 0,
        treats INTEGER NOT NULL DEFAULT 0,
        selected_expression TEXT NOT NULL DEFAULT 'idle',
        animations_enabled INTEGER NOT NULL DEFAULT 1,
        unlocked_expressions TEXT NOT NULL DEFAULT '["idle","happy"]'
      );
      INSERT OR IGNORE INTO cat_profile (id) VALUES (1);
    `);
  }

  createSession(model = "", title = "New session") {
    const id = crypto.randomUUID().slice(0, 8);
    const now = new Date().toISOString();
    this.db.query(`INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id, title, model, now, now);
    return this.getSession(id)!;
  }

  getSession(id: string): Session | null {
    return (this.db.query("SELECT * FROM sessions WHERE id = ?").get(id) as Session | null) ?? null;
  }

  listSessions(limit = 20): Session[] {
    return this.db.query("SELECT * FROM sessions ORDER BY updated_at DESC LIMIT ?").all(limit) as Session[];
  }

  addMessage(sessionId: string, message: StoredMessage) {
    const now = new Date().toISOString();
    this.db.query("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)").run(sessionId, message.role, message.content, now);
    this.db.query("UPDATE sessions SET updated_at = ? WHERE id = ?").run(now, sessionId);
  }

  createSessionWithMessage(model: string, message: StoredMessage, title?: string): Session {
    const now = new Date().toISOString();
    const id = crypto.randomUUID().slice(0, 8);
    const sessionTitle = title && title.trim() ? title.trim().slice(0, 64) : message.content.trim().slice(0, 64);
    this.db.query(`INSERT INTO sessions (id, title, model, created_at, updated_at) VALUES (?, ?, ?, ?, ?)`).run(id, sessionTitle || "new session", model, now, now);
    this.db.query("INSERT INTO messages (session_id, role, content, created_at) VALUES (?, ?, ?, ?)").run(id, message.role, message.content, now);
    return this.getSession(id)!;
  }

  renameSession(sessionId: string, title: string) {
    const now = new Date().toISOString();
    this.db.query("UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?").run(title.trim().slice(0, 64), now, sessionId);
  }

  getMessages(sessionId: string): StoredMessage[] {
    return this.db.query("SELECT role, content FROM messages WHERE session_id = ? ORDER BY id ASC").all(sessionId) as StoredMessage[];
  }

  updateModel(sessionId: string, model: string) {
    this.db.query("UPDATE sessions SET model = ?, updated_at = ? WHERE id = ?").run(model, new Date().toISOString(), sessionId);
  }

  deleteSession(sessionId: string) {
    this.db.query("DELETE FROM sessions WHERE id = ?").run(sessionId);
  }

  getCatProfile(): CatProfile {
    const row = this.db.query("SELECT pets, treats, selected_expression, animations_enabled, unlocked_expressions FROM cat_profile WHERE id = 1").get() as {
      pets: number; treats: number; selected_expression: string; animations_enabled: number; unlocked_expressions: string;
    };
    let unlockedExpressions: string[] = ["idle", "happy"];
    try {
      const parsed: unknown = JSON.parse(row.unlocked_expressions);
      if (Array.isArray(parsed)) unlockedExpressions = parsed.filter((value): value is string => typeof value === "string");
    } catch { /* Use safe defaults if a local profile is malformed. */ }
    return {
      pets: row.pets,
      treats: row.treats,
      selectedExpression: row.selected_expression,
      animationsEnabled: row.animations_enabled === 1,
      unlockedExpressions,
    };
  }

  updateCatProfile(profile: CatProfile) {
    this.db.query(`UPDATE cat_profile SET pets = ?, treats = ?, selected_expression = ?, animations_enabled = ?, unlocked_expressions = ? WHERE id = 1`)
      .run(Math.max(0, Math.floor(profile.pets)), Math.max(0, Math.floor(profile.treats)), profile.selectedExpression,
        profile.animationsEnabled ? 1 : 0, JSON.stringify([...new Set(profile.unlockedExpressions)]));
  }

  close() {
    this.db.close();
  }
}
