import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { WebSocket, WebSocketServer } from "ws";
import { BaseDatos } from "./base-datos.js";
import { correo, hashPassword, Limites, nombre, passwordValido, texto, verificarPassword } from "./seguridad.js";
import { ErrorApp, usuarioPublico, type UsuarioDB } from "./tipos.js";

interface Conexion { userId: string; token: string; expiresAt: number; client: string; joinedAt: string; alive: boolean }
interface Opciones { databasePath?: string; host?: string; publicOrigin?: string; secureCookie?: boolean; adminEmail?: string; adminPassword?: string; adminName?: string }
const web = fileURLToPath(new URL("../web/", import.meta.url));
const staticFiles: Record<string, [string, string]> = {
  "/": ["index.html", "text/html; charset=utf-8"], "/index.html": ["index.html", "text/html; charset=utf-8"],
  "/cliente.js": ["cliente.js", "text/javascript; charset=utf-8"], "/estilos.css": ["estilos.css", "text/css; charset=utf-8"], "/marca.svg": ["marca.svg", "image/svg+xml"],
};
function cookieToken(req: IncomingMessage): string {
  return (req.headers.cookie || "").split(";").map(v => v.trim()).find(v => v.startsWith("pulso_session="))?.slice(14) || "";
}
async function body(req: IncomingMessage): Promise<Record<string, unknown>> {
  if (!req.headers["content-type"]?.startsWith("application/json")) throw new ErrorApp(415, "Se requiere JSON.");
  const chunks: Buffer[] = []; let length = 0;
  for await (const chunk of req) { length += chunk.length; if (length <= 8192) chunks.push(Buffer.from(chunk)); }
  if (length > 8192) throw new ErrorApp(413, "La solicitud es demasiado grande.");
  try { const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error(); return parsed; }
  catch { throw new ErrorApp(400, "El contenido JSON no es válido."); }
}

export async function iniciarServidor(puerto = 8080, options: Opciones = {}) {
  const databasePath = options.databasePath ?? process.env.DATABASE_PATH ?? resolve("data/pulso.sqlite");
  const publicOrigin = options.publicOrigin ?? process.env.PUBLIC_ORIGIN;
  const secureCookie = options.secureCookie ?? (process.env.NODE_ENV === "production");
  if (secureCookie && (!publicOrigin || !publicOrigin.startsWith("https://"))) throw new Error("En producción configura PUBLIC_ORIGIN con tu dirección HTTPS.");
  const store = new BaseDatos(databasePath); const limits = new Limites(); const connections = new Map<WebSocket, Conexion>(); const startedAt = Date.now();
  const dummyHash = await hashPassword("pulso-dummy-not-an-account");
  const adminEmail = options.adminEmail ?? process.env.ADMIN_EMAIL; const adminPassword = options.adminPassword ?? process.env.ADMIN_PASSWORD;
  if (adminEmail || adminPassword) {
    if (!adminEmail || !adminPassword) { store.close(); throw new Error("Configura ADMIN_EMAIL y ADMIN_PASSWORD juntos."); }
    const email = correo(adminEmail);
    if (!store.byEmail(email)) { store.createUser(nombre(options.adminName ?? process.env.ADMIN_NAME ?? "Administrador"), email, await hashPassword(passwordValido(adminPassword)), "admin"); store.activity("Cuenta de administrador creada"); }
  }
  const sessionCookie = (token: string, expiresAt: number) => `pulso_session=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.max(0, Math.floor((expiresAt - Date.now()) / 1000))}${secureCookie ? "; Secure" : ""}`;
  const send = (socket: WebSocket, data: unknown) => {
    if (socket.readyState !== WebSocket.OPEN) return;
    if (socket.bufferedAmount > 1024 * 1024) { socket.close(1013, "Conexión lenta"); return; }
    socket.send(JSON.stringify(data), error => { if (error) socket.terminate(); });
  };
  const broadcast = (data: unknown) => { for (const socket of connections.keys()) send(socket, data); };
  const presence = () => [...connections.values()].map(conn => ({ ...usuarioPublico(store.user(conn.userId)!), client: conn.client, joinedAt: conn.joinedAt }));
  let actualPort = puerto;
  const stats = () => ({
    activeConnections: connections.size, uniqueOnline: new Set([...connections.values()].map(c => c.userId)).size,
    totalUsers: store.count("SELECT COUNT(*) AS count FROM users WHERE role != 'guest'"), totalMessages: store.count("SELECT COUNT(*) AS count FROM messages WHERE deleted = 0"),
    messagesToday: Number(store.db.prepare("SELECT COUNT(*) AS count FROM messages WHERE deleted = 0 AND created_at >= ?").get(new Date(Date.now() - 86400_000).toISOString())!.count),
    uptime: Math.floor((Date.now() - startedAt) / 1000), memoryMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    databaseBytes: Number(store.db.prepare("PRAGMA page_count").get()!.page_count) * Number(store.db.prepare("PRAGMA page_size").get()!.page_size),
    port: actualPort, database: "SQLite", connections: presence(), activity: store.db.prepare("SELECT text, created_at AS createdAt FROM activity ORDER BY id DESC LIMIT 20").all(), users: store.users(),
  });
  const notifyAdmins = () => { for (const [socket, conn] of connections) if (store.user(conn.userId)?.role === "admin") send(socket, { type: "admin.stats", stats: stats() }); };
  const notifyPresence = () => { broadcast({ type: "presence", users: presence() }); notifyAdmins(); };
  const closeUser = (id: string, reason: string) => { for (const [socket, conn] of connections) if (conn.userId === id) socket.close(4003, reason); };
  const authorize = (req: IncomingMessage, admin = false) => {
    const session = store.authenticate(cookieToken(req));
    if (!session) throw new ErrorApp(401, "Tu sesión terminó. Vuelve a entrar.");
    if (admin && session.user.role !== "admin") throw new ErrorApp(403, "Esta vista requiere una cuenta de administrador.");
    return session.user;
  };
  const allowedOrigin = (req: IncomingMessage) => {
    const origin = req.headers.origin; if (!origin) return true;
    return origin === (publicOrigin ? new URL(publicOrigin).origin : `http://${req.headers.host}`);
  };
  const ip = (req: IncomingMessage) => process.env.TRUST_PROXY === "1" ? String(req.headers["x-forwarded-for"] || req.socket.remoteAddress).split(",")[0].trim() : req.socket.remoteAddress || "unknown";
  const json = (res: ServerResponse, status: number, data: unknown) => { res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" }); res.end(JSON.stringify(data)); };

  const server = createServer((req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff"); res.setHeader("X-Frame-Options", "DENY"); res.setHeader("Referrer-Policy", "same-origin"); res.setHeader("Cache-Control", "no-store");
    res.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
    res.setHeader("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'");
    if (secureCookie) res.setHeader("Strict-Transport-Security", "max-age=31536000");
    void (async () => {
      const url = new URL(req.url || "/", "http://localhost"); const method = req.method || "GET";
      if (!["GET","HEAD"].includes(method) && !allowedOrigin(req)) throw new ErrorApp(403, "Origen no permitido.");
      if (url.pathname === "/api/health" && method === "GET") return json(res, 200, { status: "ok", app: "Pulso" });
      if (url.pathname === "/api/me" && method === "GET") { const session = store.authenticate(cookieToken(req)); return json(res, 200, { user: session ? usuarioPublico(session.user) : null }); }
      if (["/api/auth/register", "/api/auth/login", "/api/auth/guest"].includes(url.pathname) && method === "POST") {
        limits.comprobar(`auth:${ip(req)}`, 25, 15 * 60_000); const data = await body(req); let user: UsuarioDB;
        if (url.pathname.endsWith("/guest")) { limits.comprobar(`guest:${ip(req)}`, 10, 3600_000); user = store.createUser(nombre(data.name), null, null, "guest"); }
        else {
          const email = correo(data.email); limits.comprobar(`email:${email}`, 12, 15 * 60_000); const password = passwordValido(data.password); const existing = store.byEmail(email);
          if (url.pathname.endsWith("/register")) {
            const name = nombre(data.name); if (existing) throw new ErrorApp(409, "No se pudo crear la cuenta con ese correo. Prueba iniciar sesión.");
            const hash = await hashPassword(password); if (store.byEmail(email)) throw new ErrorApp(409, "No se pudo crear la cuenta con ese correo.");
            user = store.createUser(name, email, hash, "user"); store.activity(`${user.name} creó una cuenta`);
          } else {
            const valid = await verificarPassword(password, existing?.password_hash ?? dummyHash);
            if (!existing || !valid) throw new ErrorApp(401, "Correo o contraseña incorrectos.");
            if (existing.banned) throw new ErrorApp(403, "Esta cuenta está suspendida."); user = existing;
          }
        }
        const old = cookieToken(req); if (old) { store.revoke(old); for (const [socket, conn] of connections) if (conn.token === old) socket.close(4001, "Sesión reemplazada"); }
        const session = store.session(user); res.setHeader("Set-Cookie", sessionCookie(session.token, session.expiresAt)); return json(res, 200, { user: usuarioPublico(user) });
      }
      if (url.pathname === "/api/auth/logout" && method === "POST") {
        const token = cookieToken(req); store.revoke(token); for (const [socket, conn] of connections) if (conn.token === token) socket.close(4001, "Sesión cerrada");
        res.setHeader("Set-Cookie", sessionCookie("", 0)); return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/messages" && method === "GET") {
        authorize(req); const before = url.searchParams.has("before") ? Number(url.searchParams.get("before")) : Number.MAX_SAFE_INTEGER;
        if (!Number.isSafeInteger(before) || before < 1) throw new ErrorApp(400, "Página no válida.");
        const messages = store.history(before); return json(res, 200, { messages, hasMore: messages.length === 50 });
      }
      if (url.pathname === "/api/profile" && method === "PATCH") {
        const user = authorize(req); if (user.role === "guest") throw new ErrorApp(403, "Crea una cuenta para personalizar tu perfil.");
        const data = await body(req); const name = nombre(data.name); const colors = ["sage", "violet", "amber", "blue", "rose"];
        if (typeof data.color !== "string" || !colors.includes(data.color)) throw new ErrorApp(400, "Color de avatar no válido.");
        store.db.prepare("UPDATE users SET name = ?, color = ? WHERE id = ?").run(name, data.color, user.id);
        const updated = usuarioPublico(store.user(user.id)!); broadcast({ type: "profile.updated", user: updated }); notifyPresence(); return json(res, 200, { user: updated });
      }
      if (url.pathname === "/api/admin" && method === "GET") { authorize(req, true); return json(res, 200, stats()); }
      const userRoute = url.pathname.match(/^\/api\/admin\/users\/([a-f0-9-]+)$/);
      if (userRoute && method === "PATCH") {
        const admin = authorize(req, true); const target = store.user(userRoute[1]); if (!target) throw new ErrorApp(404, "Usuario no encontrado.");
        if (target.id === admin.id || target.role === "admin") throw new ErrorApp(403, "No puedes suspender cuentas de administrador.");
        const data = await body(req); if (typeof data.banned !== "boolean") throw new ErrorApp(400, "Estado no válido.");
        store.db.prepare("UPDATE users SET banned = ? WHERE id = ?").run(data.banned ? 1 : 0, target.id);
        if (data.banned) { store.revokeUser(target.id); closeUser(target.id, "Cuenta suspendida"); }
        store.activity(`${admin.name} ${data.banned ? "suspendió" : "reactivó"} a ${target.name}`); notifyAdmins(); return json(res, 200, { ok: true });
      }
      if (url.pathname === "/api/admin/disconnect" && method === "POST") {
        const admin = authorize(req, true); const data = await body(req); if (typeof data.userId !== "string") throw new ErrorApp(400, "Usuario no válido.");
        const target = store.user(data.userId); if (!target) throw new ErrorApp(404, "Usuario no encontrado."); if (target.role === "admin") throw new ErrorApp(403, "No puedes desconectar administradores.");
        store.revokeUser(target.id); closeUser(target.id, "Sesión finalizada por un administrador"); store.activity(`${admin.name} desconectó a ${target.name}`); notifyAdmins(); return json(res, 200, { ok: true });
      }
      if (url.pathname.startsWith("/api/")) throw new ErrorApp(404, "Ruta no encontrada.");
      const asset = staticFiles[url.pathname]; if (!asset || !["GET", "HEAD"].includes(method)) throw new ErrorApp(404, "Página no encontrada.");
      const content = await readFile(resolve(web, asset[0])); res.writeHead(200, { "Content-Type": asset[1] }); res.end(method === "HEAD" ? undefined : content);
    })().catch(error => {
      if (res.headersSent || res.destroyed) return;
      if (!(error instanceof ErrorApp)) console.error("Error de solicitud:", error);
      json(res, error instanceof ErrorApp ? error.status : 500, { error: error instanceof ErrorApp ? error.message : "Ocurrió un error. Inténtalo nuevamente." });
    });
  });
  server.requestTimeout = 15_000; server.headersTimeout = 10_000;
  const sockets = new WebSocketServer({ noServer: true, maxPayload: 8192, perMessageDeflate: false });
  server.on("upgrade", (req, socket, head) => {
    try {
      if (new URL(req.url || "/", "http://localhost").pathname !== "/ws" || !allowedOrigin(req)) throw new ErrorApp(403, "Acceso no permitido");
      const token = cookieToken(req); const session = store.authenticate(token); if (!session) throw new ErrorApp(401, "Sesión requerida");
      limits.comprobar(`ws:${session.user.id}`, 15, 60_000);
      if (connections.size >= 200 || [...connections.values()].filter(c => c.userId === session.user.id).length >= 5) throw new ErrorApp(429, "Límite de conexiones");
      const client = new URL(req.url || "/", "http://localhost").searchParams.get("client") === "terminal" ? "terminal" : "web";
      sockets.handleUpgrade(req, socket, head, ws => { connections.set(ws, { userId: session.user.id, token, expiresAt: session.expiresAt, client, joinedAt: new Date().toISOString(), alive: true }); sockets.emit("connection", ws); });
    } catch (error) { const code = error instanceof ErrorApp ? error.status : 400; socket.end(`HTTP/1.1 ${code} Rejected\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); }
  });
  sockets.on("connection", socket => {
    const connection = connections.get(socket)!; const user = store.user(connection.userId)!;
    store.activity(`${user.name} se conectó desde ${connection.client === "web" ? "el navegador" : "la terminal"}`);
    send(socket, { type: "ready", user: usuarioPublico(user), messages: store.history(), presence: presence() }); notifyPresence();
    socket.on("pong", () => { connection.alive = true; }); socket.on("error", () => socket.terminate());
    socket.on("message", (raw, binary) => {
      try {
        const authenticated = store.authenticate(connection.token); if (!authenticated) { socket.close(4001, "Tu sesión terminó"); return; }
        if (binary) throw new ErrorApp(400, "Solo se permiten mensajes de texto."); limits.comprobar(`frames:${user.id}`, 60, 60_000);
        let data: Record<string, unknown>; try { data = JSON.parse(raw.toString()); } catch { throw new ErrorApp(400, "Mensaje no válido."); }
        if (!data || typeof data !== "object") throw new ErrorApp(400, "Mensaje no válido."); const current = authenticated.user;
        if (data.type === "message.send") {
          const content = texto(data.text); limits.comprobar(`send:${current.id}`, 1, current.role === "guest" ? 2000 : 300);
          if (current.role === "guest") limits.comprobar(`guest-messages:${current.id}`, 30, 3600_000);
          const message = store.addMessage(current.id, content); broadcast({ type: "message.created", message, requestId: typeof data.requestId === "string" ? data.requestId.slice(0, 64) : null }); notifyAdmins();
        } else if (data.type === "message.edit" || data.type === "message.delete") {
          if (!Number.isSafeInteger(data.id)) throw new ErrorApp(400, "Mensaje no válido."); const original = store.message(Number(data.id));
          if (!original || original.deleted) throw new ErrorApp(404, "El mensaje ya no está disponible."); const own = original.author.id === current.id;
          if (data.type === "message.edit") {
            if (!own || current.role === "guest") throw new ErrorApp(403, "Solo puedes editar tus propios mensajes con una cuenta registrada.");
            const message = store.editMessage(original.id, texto(data.text)); broadcast({ type: "message.updated", message });
          } else {
            if (current.role !== "admin" && (!own || current.role === "guest")) throw new ErrorApp(403, "No tienes permiso para eliminar este mensaje.");
            const message = store.deleteMessage(original.id); broadcast({ type: "message.updated", message }); if (!own) store.activity(`${current.name} moderó el mensaje #${original.id}`);
          }
          notifyAdmins();
        } else throw new ErrorApp(400, "Acción no reconocida.");
      } catch (error) { if (!(error instanceof ErrorApp)) console.error("Error de mensaje:", error); send(socket, { type: "error", error: error instanceof ErrorApp ? error.message : "No se pudo procesar el mensaje." }); }
    });
    socket.on("close", () => { connections.delete(socket); store.activity(`${store.user(connection.userId)?.name || "Un usuario"} se desconectó`); notifyPresence(); });
  });
  const heartbeat = setInterval(() => {
    for (const [socket, conn] of connections) { if (!conn.alive || !store.authenticate(conn.token)) { socket.terminate(); continue; } conn.alive = false; socket.ping(); }
    store.clean(); limits.limpiar(); notifyAdmins();
  }, 30_000); heartbeat.unref();
  await new Promise<void>((accept, reject) => { server.once("error", reject); server.listen(puerto, options.host ?? process.env.HOST ?? "0.0.0.0", () => { server.removeListener("error", reject); accept(); }); }).catch(error => { clearInterval(heartbeat); sockets.close(); store.close(); throw error; });
  actualPort = (server.address() as { port: number }).port; store.activity(`Servidor iniciado en el puerto ${actualPort}`); console.log(`Pulso · http://localhost:${actualPort}`);
  let closing: Promise<void> | undefined;
  const close = (): Promise<void> => closing ??= new Promise<void>(accept => {
    clearInterval(heartbeat); for (const socket of connections.keys()) socket.close(1001, "El servidor se está cerrando");
    const force = setTimeout(() => { for (const socket of connections.keys()) socket.terminate(); }, 1500); force.unref();
    server.close(() => { sockets.close(() => { clearTimeout(force); store.close(); accept(); }); }); server.closeIdleConnections();
  });
  return { server, port: actualPort, close, databasePath };
}
