#!/usr/bin/env node
import { existsSync } from "node:fs";
import { loadEnvFile } from "node:process";
import { iniciarServidor } from "./servidor.js";
import { conectarCliente } from "./cliente-terminal.js";
if (existsSync(".env")) loadEnvFile(".env");
const command = process.argv[2] || "start";
const port = Number(process.argv[3] ?? process.env.PORT ?? 8080);
if (!["start", "connect"].includes(command)) {
  console.log("Pulso — conversaciones que conectan\n\nUso: pulso start [puerto]\n     pulso connect [puerto] [nombre]\n\nTambién puedes usar broadcast-server.");
} else if (!Number.isInteger(port) || port < 1 || port > 65535) {
  console.error("Puerto inválido: escribe un número entero entre 1 y 65535."); process.exitCode = 1;
} else {
  try {
    if (command === "connect") await conectarCliente(port, process.argv[4]);
    else {
      const app = await iniciarServidor(port);
      const stop = () => { console.log("Cerrando Pulso…"); void app.close().then(() => console.log("Servidor cerrado")); };
      process.once("SIGINT", stop); process.once("SIGTERM", stop);
    }
  } catch (error) { console.error("No se pudo iniciar Pulso:", error instanceof Error ? error.message : error); process.exitCode = 1; }
}
