import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export type StoredMessage = {
  role: "system" | "user" | "assistant";
  content: string;
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
    this.db.query("UPDATE sessions SET updated_at = ?, title = CASE WHEN title = 'New session' AND ? = 'user' THEN substr(?, 1, 64) ELSE title END WHERE id = ?")
      .run(now, message.role, message.content, sessionId);
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

  close() {
    this.db.close();
  }
}
