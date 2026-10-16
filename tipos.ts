export type Rol = "user" | "admin" | "guest";
export interface Usuario { id: string; name: string; role: Rol; color: string; createdAt: string }
export interface UsuarioDB { id: string; name: string; email: string | null; password_hash: string | null; role: Rol; color: string; banned: number; created_at: string }
export interface Mensaje { id: number; text: string; createdAt: string; editedAt: string | null; deleted: boolean; author: Usuario }
export function usuarioPublico(user: UsuarioDB): Usuario {
  return { id: user.id, name: user.name, role: user.role, color: user.color, createdAt: user.created_at };
}
export class ErrorApp extends Error {
  constructor(public status: number, message: string) { super(message); }
}
