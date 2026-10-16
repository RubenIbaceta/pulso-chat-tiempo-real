import { WebSocket } from "ws";
import { createInterface } from "node:readline";
export async function conectarCliente(puerto = 8080, name = "Invitado de terminal") {
  try {
    const response = await fetch(`http://localhost:${puerto}/api/auth/guest`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    const result = await response.json() as { error?: string }; if (!response.ok) throw new Error(result.error || "No se pudo iniciar la sesión de invitado.");
    const cookie = response.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
    const socket = new WebSocket(`ws://localhost:${puerto}/ws?client=terminal`, { headers: { Cookie: cookie } });
    let terminal: ReturnType<typeof createInterface> | undefined;
    socket.on("open", () => {
      console.log(`Conectado a Pulso como ${name}. Escribe y pulsa Enter. /salir para terminar.`);
      terminal = createInterface({ input: process.stdin, output: process.stdout });
      terminal.on("line", line => { const text = line.trim(); if (text === "/salir") { socket.close(); terminal?.close(); return; } if (text && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "message.send", text })); });
      terminal.on("close", () => socket.close());
      terminal.on("SIGINT", () => { socket.close(1000, "Hasta pronto"); terminal?.close(); });
    });
    socket.on("message", raw => {
      const event = JSON.parse(raw.toString());
      if (event.type === "ready") console.log(`Hay ${event.presence.length} conexión(es) activa(s).`);
      if (event.type === "message.created" || event.type === "message.updated") { const msg = event.message; const time = new Date(msg.createdAt).toLocaleTimeString("es-CL", { hour: "2-digit", minute: "2-digit" }); console.log(`[${time}] ${msg.author.name}: ${msg.deleted ? "[Mensaje eliminado]" : msg.text}${msg.editedAt ? " (editado)" : ""}`); }
      if (event.type === "error") console.log(event.error);
    });
    socket.on("error", () => { console.error("Se perdió la conexión con Pulso."); process.exitCode = 1; });
    socket.on("close", (_code, reason) => { console.log(reason.toString() || "Conexión cerrada"); terminal?.close(); });
  } catch (error) { console.error(`No se pudo conectar al puerto ${puerto}:`, error instanceof Error ? error.message : error); process.exitCode = 1; }
}
