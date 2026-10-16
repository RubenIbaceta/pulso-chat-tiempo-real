import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import { hashToken, nuevoToken } from "./seguridad.js";
import { usuarioPublico, type UsuarioDB, type Rol, type Mensaje } from "./tipos.js";

export class BaseDatos {
  readonly db: DatabaseSync;
  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE,
        password_hash TEXT, role TEXT NOT NULL CHECK(role IN ('user','admin','guest')),
        color TEXT NOT NULL DEFAULT 'sage', banned INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT, user_id TEXT NOT NULL REFERENCES users(id),
        text TEXT NOT NULL, created_at TEXT NOT NULL, edited_at TEXT, deleted INTEGER NOT NULL DEFAULT 0
      );
      CREATE TABLE IF NOT EXISTS activity (id INTEGER PRIMARY KEY AUTOINCREMENT, text TEXT NOT NULL, created_at TEXT NOT NULL);
    `);
  }
  user(id: string): UsuarioDB | undefined { return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as unknown as UsuarioDB | undefined; }
  byEmail(email: string): UsuarioDB | undefined { return this.db.prepare("SELECT * FROM users WHERE email = ?").get(email) as unknown as UsuarioDB | undefined; }
  createUser(name: string, email: string | null, hash: string | null, role: Rol): UsuarioDB {
    const id = randomUUID();
    this.db.prepare("INSERT INTO users (id,name,email,password_hash,role,created_at) VALUES (?,?,?,?,?,?)").run(id, name, email, hash, role, new Date().toISOString());
    return this.user(id)!;
  }
  session(user: UsuarioDB): { token: string; expiresAt: number } {
    const token = nuevoToken(); const expiresAt = Date.now() + (user.role === "guest" ? 4 * 3600_000 : 7 * 86400_000);
    this.db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(hashToken(token), user.id, expiresAt);
    return { token, expiresAt };
  }
  authenticate(token: string): { user: UsuarioDB; expiresAt: number } | undefined {
    if (!/^[a-f0-9]{64}$/.test(token)) return;
    const session = this.db.prepare("SELECT user_id, expires_at FROM sessions WHERE token_hash = ? AND expires_at > ?").get(hashToken(token), Date.now());
    if (!session) return;
    const user = this.user(String(session.user_id));
    if (!user || user.banned) return;
    return { user, expiresAt: Number(session.expires_at) };
  }
  revoke(token: string): void { this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token)); }
  revokeUser(id: string): void { this.db.prepare("DELETE FROM sessions WHERE user_id = ?").run(id); }
  message(id: number): Mensaje | undefined {
    const row = this.db.prepare(`SELECT m.*, u.name, u.role, u.color, u.created_at AS user_created_at FROM messages m JOIN users u ON u.id = m.user_id WHERE m.id = ?`).get(id);
    if (!row) return;
    return { id: Number(row.id), text: row.deleted ? "" : String(row.text), createdAt: String(row.created_at), editedAt: row.edited_at ? String(row.edited_at) : null, deleted: Boolean(row.deleted),
      author: { id: String(row.user_id), name: String(row.name), role: row.role as Rol, color: String(row.color), createdAt: String(row.user_created_at) } };
  }
  history(before = Number.MAX_SAFE_INTEGER): Mensaje[] {
    const ids = this.db.prepare("SELECT id FROM messages WHERE id < ? ORDER BY id DESC LIMIT 50").all(before);
    return ids.reverse().map(row => this.message(Number(row.id))!);
  }
  addMessage(userId: string, text: string): Mensaje {
    const result = this.db.prepare("INSERT INTO messages (user_id,text,created_at) VALUES (?,?,?)").run(userId, text, new Date().toISOString());
    return this.message(Number(result.lastInsertRowid))!;
  }
  editMessage(id: number, text: string): Mensaje {
    this.db.prepare("UPDATE messages SET text = ?, edited_at = ? WHERE id = ?").run(text, new Date().toISOString(), id);
    return this.message(id)!;
  }
  deleteMessage(id: number): Mensaje {
    this.db.prepare("UPDATE messages SET text = '', deleted = 1 WHERE id = ?").run(id); return this.message(id)!;
  }
  activity(text: string): void {
    this.db.prepare("INSERT INTO activity (text,created_at) VALUES (?,?)").run(text, new Date().toISOString());
    this.db.exec("DELETE FROM activity WHERE id < (SELECT COALESCE(MAX(id),0) - 500 FROM activity)");
  }
  users() { return (this.db.prepare("SELECT * FROM users WHERE role != 'guest' ORDER BY created_at DESC LIMIT 100").all() as unknown as UsuarioDB[]).map(user => ({ ...usuarioPublico(user), email: user.email, banned: Boolean(user.banned) })); }
  count(sql: string): number { return Number(this.db.prepare(sql).get()!.count); }
  clean(): void { this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(Date.now()); }
  close(): void { this.db.close(); }
}
