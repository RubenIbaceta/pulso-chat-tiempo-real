# Pulso

**Conversaciones que conectan.** Chat en tiempo real construido sobre el Broadcast Server original, con Node.js, TypeScript, WebSocket y una interfaz sin frameworks.

**Demo en línea:** https://rubenibaceta25.alwaysdata.net

**Código:** https://github.com/RubenIbaceta/pulso-chat-tiempo-real · **Publicación gratuita:** [guía para alwaysdata](PUBLICAR.md).

## Qué incluye

- Registro e inicio de sesión con correo y contraseña.
- Invitados con nombre temporal, sesiones de 4 horas, hasta 30 mensajes por hora y 2 segundos entre envíos.
- Sala compartida entre navegadores y clientes de terminal.
- Historial persistente con páginas de 50 mensajes, autores, avatares, fechas e indicador de edición.
- Editar y eliminar mensajes propios con una cuenta registrada; los administradores pueden moderar mensajes ajenos.
- Perfil con nombre y color de avatar.
- Presencia, reconexión automática, tema claro/oscuro y diseño adaptable.
- Administración con conexiones, cuentas, suspensión/reactivación, cierre de sesiones, actividad, memoria y estado de la base de datos.
- SQLite, contraseñas con scrypt, sesiones en cookies HttpOnly, controles de origen y límites de solicitudes y mensajes.

## Ejecutar en tu equipo

Requiere **Node.js 22.16 o superior**. En Node 22, `node:sqlite` puede mostrar un aviso de función experimental; no impide su ejecución.

```powershell
npm install
npm run build
npm start
```

Abre **http://localhost:8080**. La aplicación sirve el frontend y WebSocket desde el mismo puerto. Ahora la web se abre por HTTP, no haciendo doble clic en `web/index.html`.

Para cambiar el puerto:

```powershell
npm start -- start 9090
```

La dirección WebSocket del navegador se adapta al puerto y usa WSS cuando se publica con HTTPS.

## Crear tu administrador

Copia `.env.example` como `.env` y completa:

```dotenv
ADMIN_EMAIL=tu-correo@ejemplo.com
ADMIN_PASSWORD=elige-una-contrasena-larga-y-unica
ADMIN_NAME=Tu nombre
```

Reinicia la aplicación. La cuenta se crea solo si ese correo no existe. No hay contraseña predeterminada y la primera persona que se registra **no** obtiene permisos de administrador. Si el correo ya pertenece a un usuario normal, utiliza otro correo para el administrador.

Después de crear la cuenta, elimina `ADMIN_PASSWORD` y `ADMIN_EMAIL` de `.env`: el inicio de sesión usará el hash ya guardado. La configuración inicial no modifica ni restablece cuentas existentes. No subas `.env` a Git ni compartas credenciales reales en capturas.

Inicia sesión desde la web con esa cuenta para ver **Administración**. Un usuario o invitado no puede entrar a las rutas administrativas aunque fabrique una solicitud.

## Cliente de terminal

Con el servidor activo:

```powershell
node dist/index.js connect 8080 "Rubén terminal"
```

O registra los comandos:

```powershell
npm link
pulso start 9090
# En otra terminal:
pulso connect 9090 "Mi nombre"
```

También se conserva `broadcast-server start` y `broadcast-server connect`. El cliente de terminal crea una sesión de invitado y comparte sus límites. Escribe `/salir` o pulsa Ctrl + C para terminar.

## Estructura

| Archivo | Responsabilidad |
| --- | --- |
| `index.ts` | Comandos, configuración y cierre del proceso |
| `servidor.ts` | HTTP, autenticación, WebSocket y permisos |
| `base-datos.ts` | Tablas, consultas e historial de SQLite |
| `seguridad.ts` | Contraseñas, validación y límites |
| `tipos.ts` | Datos compartidos y errores de aplicación |
| `cliente-terminal.ts` | Cliente de terminal |
| `web/` | Pantallas, estilos y cliente del navegador |
| `tests/` | Pruebas de integración y permisos |

El flujo es: navegador/terminal → sesión → WebSocket autenticado → validación → SQLite → difusión a todos. Las ediciones se sincronizan por el mismo canal. Los permisos se comprueban en el servidor, no solo en los botones.

## Desarrollo y pruebas

```powershell
npm run build
npm test
```

Después de cambiar TypeScript, compila y reinicia el servidor. Para HTML/CSS/JS basta con guardar y recargar. `npm run dev` arranca con vigilancia de los archivos compilados; debes volver a compilar cuando cambies TypeScript.

Las pruebas usan una base temporal y verifican autenticación, permisos, difusión, edición, moderación, sesiones e historial tras reiniciar. No usan ni borran la base de tu aplicación.

## Datos y límites de esta versión

La base se crea en `data/pulso.sqlite`. Cuentas, mensajes y sesiones sobreviven al reinicio. Una sesión de invitado es temporal, pero sus mensajes permanecen en el historial del chat compartido. Las sesiones registradas duran 7 días. Las cuentas no verifican todavía la propiedad del correo y no hay recuperación de contraseña ni subida de fotos; los avatares usan iniciales y colores.

La aplicación usa una sola instancia y un solo chat público para sus participantes. No publiques datos privados en él. La administración muestra métricas del proceso, no métricas de toda la máquina. El registro de actividad conserva las últimas 500 entradas aproximadamente.

## Preparar la publicación

Se incluye `Dockerfile`. El alojamiento necesita un proceso Node persistente, soporte para WebSocket y un volumen persistente para SQLite. No sirve un alojamiento que solo publique HTML estático ni un disco que se borre al reiniciar.

Configura estas variables en tu proveedor:

```dotenv
NODE_ENV=production
PORT=8080
DATABASE_PATH=/app/data/pulso.sqlite
PUBLIC_ORIGIN=https://tu-dominio.example
```

Pon HTTPS delante de Node y permite las actualizaciones de WebSocket. `PUBLIC_ORIGIN` debe ser el origen exacto, sin rutas. En producción se requieren HTTPS y cookies Secure. Usa `TRUST_PROXY=1` únicamente si el proveedor controla el proxy y reemplaza la cabecera de IP del cliente.

El punto de salud es `GET /api/health`. Monta el volumen en `/app/data`, crea el administrador con variables del proveedor y luego retira sus credenciales de configuración. Para una copia sencilla y coherente, detén la aplicación antes de copiar el directorio `data`; SQLite usa archivos WAL mientras está en ejecución.

La demo está publicada en alwaysdata con HTTPS y almacenamiento persistente. Se comprobó el acceso como invitado, la difusión entre dos pestañas y la conservación del historial tras reiniciar el sitio. Una ampliación a varias instancias necesitará una base y un canal de difusión compartidos.

## Referencias

- [SQLite en Node.js](https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html)
- [Almacenamiento de contraseñas — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Seguridad de WebSocket — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
