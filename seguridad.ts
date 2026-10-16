import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { ErrorApp } from "./tipos.js";

let hashesActivos = 0;
const parametros = { N: 32768, r: 8, p: 3, maxmem: 64 * 1024 * 1024 };
async function derivar(password: string, salt: string): Promise<Buffer> {
  if (hashesActivos >= 4) throw new ErrorApp(429, "Hay muchos intentos. Espera unos segundos.");
  hashesActivos++;
  try {
    return await new Promise<Buffer>((resolve, reject) => {
      scrypt(password, salt, 64, parametros, (error, key) => error ? reject(error) : resolve(key));
    });
  } finally { hashesActivos--; }
}
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  return `scrypt$32768$8$3$${salt}$${(await derivar(password, salt)).toString("hex")}`;
}
export async function verificarPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, n, r, p, salt, hex] = stored.split("$");
  if (algorithm !== "scrypt" || n !== "32768" || r !== "8" || p !== "3" || !salt || !hex) return false;
  const esperado = Buffer.from(hex, "hex");
  const recibido = await derivar(password, salt);
  return esperado.length === recibido.length && timingSafeEqual(esperado, recibido);
}
export const hashToken = (token: string): string => createHash("sha256").update(token).digest("hex");
export const nuevoToken = (): string => randomBytes(32).toString("hex");
export function texto(value: unknown, max = 1000): string {
  if (typeof value !== "string") throw new ErrorApp(400, `Escribe entre 1 y ${max} caracteres.`);
  // Conserva saltos de línea y tabulaciones, pero retira controles de terminal.
  const clean = value.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").trim();
  if (!clean || clean.length > max) throw new ErrorApp(400, `Escribe entre 1 y ${max} caracteres.`);
  return clean;
}
export function nombre(value: unknown): string {
  const name = texto(value, 32).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (name.length < 2) throw new ErrorApp(400, "El nombre debe tener entre 2 y 32 caracteres.");
  return name;
}
export function correo(value: unknown): string {
  if (typeof value !== "string") throw new ErrorApp(400, "Escribe un correo válido.");
  const email = value.trim().toLowerCase();
  if (email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ErrorApp(400, "Escribe un correo válido.");
  return email;
}
export function passwordValido(value: unknown): string {
  if (typeof value !== "string" || value.length < 10 || value.length > 128) throw new ErrorApp(400, "La contraseña debe tener entre 10 y 128 caracteres.");
  return value;
}
export class Limites {
  private entradas = new Map<string, { count: number; until: number }>();
  comprobar(key: string, max: number, ventana: number): void {
    const now = Date.now();
    let entry = this.entradas.get(key);
    if (!entry || entry.until <= now) {
      if (this.entradas.size > 10000) this.limpiar();
      if (this.entradas.size >= 20000) throw new ErrorApp(429, "El servicio está ocupado. Inténtalo más tarde.");
      entry = { count: 0, until: now + ventana }; this.entradas.set(key, entry);
    }
    if (entry.count >= max) throw new ErrorApp(429, "Demasiados intentos. Espera un momento antes de continuar.");
    entry.count++;
  }
  limpiar(): void { for (const [key, entry] of this.entradas) if (entry.until <= Date.now()) this.entradas.delete(key); }
}
