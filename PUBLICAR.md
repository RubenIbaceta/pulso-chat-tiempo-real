# Publicar Pulso gratis en alwaysdata

El repositorio está en https://github.com/RubenIbaceta/pulso-chat-tiempo-real.

alwaysdata dispone de un plan **Free para uso personal**, con almacenamiento persistente, Node.js y WebSocket. Así podemos mantener SQLite sin contratar un disco de Render ni migrar la base. Revisa los límites vigentes al crear la cuenta: https://www.alwaysdata.com/en/offers/.

## 1. Crear o conectar tu cuenta

En https://admin.alwaysdata.com/ inicia sesión o crea una cuenta eligiendo **Free**, no una prueba de un plan de pago. El nombre de la cuenta determina la dirección `https://CUENTA.alwaysdata.net`.

La creación de la cuenta, elección de contraseña y aceptación de condiciones las completa el propietario. No compartas contraseñas ni claves API por el chat.

En los ejemplos siguientes, reemplaza `CUENTA` por el nombre real de tu cuenta; no es una dirección ya publicada.

## 2. Preparar el código por SSH

Selecciona **Node.js 24** en **Environment > Node.js**. Accede usando el usuario y servidor SSH que muestre el panel y ejecuta:

```sh
mkdir -p "$HOME/apps" "$HOME/data"
git clone https://github.com/RubenIbaceta/pulso-chat-tiempo-real.git "$HOME/apps/pulso"
cd "$HOME/apps/pulso"
sh scripts/preparar-alwaysdata.sh
```

El script instala las dependencias, compila TypeScript y retira herramientas de desarrollo del servidor. No copia la base ni las cuentas de tu equipo. La web pública comienza con una base nueva.

## 3. Crear el sitio Node.js

En **Web > Sites**, añade un sitio de tipo **Node.js** con:

| Campo | Valor |
| --- | --- |
| Dirección | `CUENTA.alwaysdata.net` |
| Comando | `node /home/CUENTA/apps/pulso/dist/index.js start` |
| Directorio de trabajo | `/home/CUENTA/apps/pulso` |

Añade estas variables de entorno en el panel:

```dotenv
NODEJS_VERSION=24
NODE_ENV=production
PUBLIC_ORIGIN=https://CUENTA.alwaysdata.net
DATABASE_PATH=/home/CUENTA/data/pulso.sqlite
ADMIN_EMAIL=tu-correo-real
ADMIN_PASSWORD=tu-contrasena-larga-y-unica
ADMIN_NAME=Tu nombre
```

Esos valores son ejemplos: establece tus credenciales en el panel, nunca en el repositorio. La contraseña necesita al menos 10 caracteres. Tras el primer inicio correcto, elimina **ambas** variables `ADMIN_EMAIL` y `ADMIN_PASSWORD`: el administrador ya estará guardado con un hash en SQLite.

El proveedor asigna la IP y el puerto internos mediante `IP`/`HOST` y `PORT`; Pulso los respeta. No fijes `8080` ni `0.0.0.0` si el panel indica otros valores. Activa HTTPS y la redirección de HTTP a HTTPS en la configuración del sitio. `PUBLIC_ORIGIN` debe coincidir exactamente con la dirección HTTPS que vayas a compartir.

La base está fuera de la carpeta del código y del alcance del servidor de archivos. Su directorio persistente permite conservar cuentas y mensajes al reiniciar.

## 4. Verificar antes de compartir

1. Abre `https://CUENTA.alwaysdata.net/api/health`: debe responder con `status: ok`.
2. Entra como invitado y envía un mensaje.
3. Abre una ventana privada y comprueba la difusión entre ambas.
4. Registra una cuenta y verifica que solo pueda editar sus mensajes.
5. Entra con tu administrador y comprueba las métricas y moderación.
6. Reinicia el sitio desde el panel: el historial debe continuar disponible.
7. Confirma que no se pueden descargar `/.env` ni `/data/pulso.sqlite`.

Solo después de esas comprobaciones añade la URL real al README y a tu portafolio. Esta guía no significa que la aplicación ya esté publicada.

## Actualizar la web

Por SSH:

```sh
cd "$HOME/apps/pulso"
git pull --ff-only
sh scripts/preparar-alwaysdata.sh
```

Después reinicia el sitio desde el panel. No borres `/home/CUENTA/data`. Para respaldar SQLite de forma sencilla, detén el sitio, copia el directorio de datos y vuelve a iniciarlo.

## Referencias

- Plan Free: https://www.alwaysdata.com/en/offers/
- Node.js: https://help.alwaysdata.com/en/docs/web-hosting/languages/nodejs/configuration/
- WebSocket: https://help.alwaysdata.com/en/blog/2023-03-14-hold-on-to-your-socks-high-speed-data-stream-hosting-with-websockets/
