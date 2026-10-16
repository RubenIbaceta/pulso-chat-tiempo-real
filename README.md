# Pulso

**Conversaciones que conectan.** Chat en tiempo real construido sobre el Broadcast Server original, con Node.js, TypeScript, WebSocket y una interfaz sin frameworks.

**[Probar Pulso](https://rubenibaceta25.alwaysdata.net)** · **[Ver el código](https://github.com/RubenIbaceta/pulso-chat-tiempo-real)**

Proyecto de aprendizaje y portafolio que nació como un servidor de difusión desde la terminal y evolucionó a una aplicación web con cuentas, historial y administración.

## Probar la demo

1. Abre [Pulso](https://rubenibaceta25.alwaysdata.net).
2. Escribe un nombre y selecciona **Probar como invitado**, o crea una cuenta.
3. Envía un mensaje. Las personas conectadas a la sala lo reciben en tiempo real.

Con una cuenta puedes personalizar tu perfil y editar o eliminar tus mensajes. La vista **Administración** está reservada al administrador; registrarse no concede ese permiso. La sala es pública y compartida, así que evita enviar información privada.

## Tecnologías

- **Servidor:** Node.js y TypeScript, con HTTP y WebSocket mediante `ws`.
- **Interfaz:** HTML, CSS y JavaScript, sin frameworks.
- **Persistencia:** SQLite mediante `node:sqlite`.
- **Autenticación:** contraseñas protegidas con scrypt y sesiones en cookies HttpOnly.
- **Publicación:** alwaysdata para la aplicación y la base de datos; GitHub para el código.

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

Requiere **Node.js 22.16 o superior**. El proyecto fija Node.js 24 en `.node-version` y lo utiliza en el alojamiento y la integración continua. En Node 22, `node:sqlite` puede mostrar un aviso de función experimental; no impide su ejecución.

```powershell
git clone https://github.com/RubenIbaceta/pulso-chat-tiempo-real.git
cd pulso-chat-tiempo-real
npm ci
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

Estos comandos conectan con el servidor de tu equipo (`localhost`). Para probar la demo publicada, utiliza el navegador.

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
| `PUBLICAR.md` | Instalación, configuración y actualizaciones en alwaysdata |
| `.github/workflows/ci.yml` | Compilación y pruebas automáticas en GitHub Actions |

El flujo es: navegador/terminal → sesión → WebSocket autenticado → validación → SQLite → difusión a todos. Las ediciones se sincronizan por el mismo canal. Los permisos se comprueban en el servidor, no solo en los botones.

## Desarrollo y pruebas

```powershell
npm run build
npm test
```

Después de cambiar TypeScript, compila y reinicia el servidor. Para HTML/CSS/JS basta con guardar y recargar. `npm run dev` arranca con vigilancia de los archivos compilados; debes volver a compilar cuando cambies TypeScript.

Las pruebas usan una base temporal y verifican autenticación, permisos, difusión, edición, moderación, sesiones e historial tras reiniciar. No usan ni borran la base de tu aplicación.

GitHub Actions ejecuta la compilación y las pruebas en cada envío de cambios y solicitud de incorporación.

## Datos y límites de esta versión

La base se crea en `data/pulso.sqlite`. Cuentas, mensajes y sesiones sobreviven al reinicio. Una sesión de invitado es temporal, pero sus mensajes permanecen en el historial del chat compartido. Las sesiones registradas duran 7 días. Las cuentas no verifican todavía la propiedad del correo y no hay recuperación de contraseña ni subida de fotos; los avatares usan iniciales y colores.

La aplicación usa una sola instancia y un solo chat público para sus participantes. No publiques datos privados en él. La administración muestra métricas del proceso, no métricas de toda la máquina. El registro de actividad conserva las últimas 500 entradas aproximadamente.

## Alojamiento y publicación

La demo está alojada en el plan gratuito de **alwaysdata**:

- **Aplicación:** https://rubenibaceta25.alwaysdata.net
- **Estado del servidor:** https://rubenibaceta25.alwaysdata.net/api/health
- **Guía de instalación y actualización:** [PUBLICAR.md](PUBLICAR.md).

El mismo servidor ofrece la web, la API y las conexiones WebSocket con HTTPS/WSS. SQLite se guarda en el almacenamiento persistente del alojamiento, fuera de la carpeta del código. GitHub almacena el código fuente; la aplicación se ejecuta en alwaysdata.

Se verificaron el acceso como invitado, los mensajes entre dos pestañas, el panel de administración y la conservación de la cuenta y el historial después de reiniciar el sitio. Las credenciales usadas para crear el administrador se retiraron de la configuración tras comprobar su acceso.

### Desplegar tu propia instancia

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

Una ampliación a varias instancias necesitará una base y un canal de difusión compartidos.

## Posibles mejoras

- Verificación de correo y recuperación de contraseña.
- Subida de imágenes para el avatar.
- Salas y conversaciones privadas.
- Automatización del despliegue y gestión de copias de seguridad.

Estas mejoras todavía no están implementadas.

## Autor y licencia

Creado por [Rubén Ibaceta](https://github.com/RubenIbaceta). Distribuido bajo la [licencia ISC](LICENSE).

## Referencias

- [SQLite en Node.js](https://nodejs.org/download/release/v22.16.0/docs/api/sqlite.html)
- [Almacenamiento de contraseñas — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html)
- [Seguridad de WebSocket — OWASP](https://cheatsheetseries.owasp.org/cheatsheets/WebSocket_Security_Cheat_Sheet.html)
