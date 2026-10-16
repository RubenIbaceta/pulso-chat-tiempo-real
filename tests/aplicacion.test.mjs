import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, resolve, basename } from 'node:path';
import { WebSocket } from 'ws';
import { iniciarServidor } from '../dist/servidor.js';
import { BaseDatos } from '../dist/base-datos.js';
import { spawn } from 'node:child_process';
import { once } from 'node:events';

test('Pulso: cuentas, difusión, permisos, moderación y persistencia', { timeout: 60000 }, async t => {
  const directory = await mkdtemp(join(tmpdir(), 'pulso-test-'));
  const databasePath = join(directory, 'test.sqlite');
  const options = { databasePath, host: '127.0.0.1', adminEmail: 'admin@test.local', adminPassword: 'Admin-test-password-2026', adminName: 'Administrador' };
  let app = await iniciarServidor(0, options);
  let base = `http://127.0.0.1:${app.port}`;
  const sockets = [];
  t.after(async () => {
    for (const socket of sockets) socket.terminate();
    await app.close();
    if (resolve(dirname(directory)) === resolve(tmpdir()) && basename(directory).startsWith('pulso-test-')) await rm(directory, { recursive: true, force: true });
  });
  async function request(path, method = 'GET', body, cookie, extraHeaders = {}) {
    const response = await fetch(base + path, { method, headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...extraHeaders }, body: body ? JSON.stringify(body) : undefined });
    return { response, data: await response.json(), cookie: response.headers.getSetCookie().map(v => v.split(';')[0]).join('; ') };
  }
  function connect(cookie) {
    const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers: { Cookie: cookie } }); sockets.push(ws);
    const queue = []; const listeners = new Set();
    ws.on('message', raw => { queue.push(JSON.parse(raw)); for (const callback of [...listeners]) callback(); });
    ws.on('error', () => {});
    return { ws, next(type) { return new Promise((accept, reject) => {
      const timeout = setTimeout(() => { listeners.delete(check); reject(new Error(`No llegó ${type}`)); }, 4000);
      function check() { const index = queue.findIndex(item => item.type === type); if (index < 0) return; clearTimeout(timeout); listeners.delete(check); accept(queue.splice(index, 1)[0]); }
      listeners.add(check); check();
    }); }, send(data) { ws.send(JSON.stringify(data)); } };
  }
  async function rejectedSocket(cookie = '', origin) {
    return new Promise((accept, reject) => {
      const ws = new WebSocket(base.replace('http:', 'ws:') + '/ws', { headers: { Cookie: cookie, ...(origin ? { Origin: origin } : {}) } });
      ws.on('unexpected-response', (_req, response) => { response.resume(); ws.terminate(); accept(response.statusCode); });
      ws.on('error', () => {}); ws.on('open', () => { ws.terminate(); reject(new Error('Se aceptó una conexión sin permiso')); });
    });
  }
  let alice, bob, guest, admin, aliceSocket, bobSocket, guestSocket, adminSocket, message;
  const credentials = { email: 'alice@test.local', password: 'Alice-password-2026', name: 'Alicia' };

  await t.test('sirve la web y limita los archivos accesibles', async () => {
    const response = await fetch(base); assert.equal(response.status, 200); assert.match(await response.text(), /Pulso/); assert.match(response.headers.get('content-security-policy'), /script-src 'self'/);
    for (const path of ['/.env', '/data/pulso.sqlite', '/package.json']) assert.equal((await fetch(base + path)).status, 404);
    assert.equal((await request('/api/messages')).response.status, 401);
    assert.equal((await request('/api/admin')).response.status, 401);
  });
  await t.test('registra cuentas sin aceptar roles enviados por el navegador', async () => {
    alice = await request('/api/auth/register', 'POST', { ...credentials, role: 'admin' }); assert.equal(alice.response.status, 200); assert.equal(alice.data.user.role, 'user'); assert.ok(!('password_hash' in alice.data.user)); assert.match(alice.response.headers.get('set-cookie'), /HttpOnly/); assert.match(alice.response.headers.get('set-cookie'), /SameSite=Lax/);
    bob = await request('/api/auth/register', 'POST', { name: 'Bruno', email: 'bob@test.local', password: 'Bob-password-2026' }); assert.equal(bob.response.status, 200);
    assert.equal((await request('/api/auth/register', 'POST', credentials)).response.status, 409);
    assert.equal((await request('/api/auth/login', 'POST', { email: credentials.email, password: 'wrong-password-123' })).response.status, 401);
    admin = await request('/api/auth/login', 'POST', { email: 'admin@test.local', password: options.adminPassword }); assert.equal(admin.data.user.role, 'admin');
  });
  await t.test('invitados y usuarios no pueden acceder a administración; valida el origen', async () => {
    guest = await request('/api/auth/guest', 'POST', { name: 'Invitado curioso' }); assert.equal(guest.data.user.role, 'guest');
    assert.equal((await request('/api/admin', 'GET', undefined, alice.cookie)).response.status, 403);
    assert.equal((await request('/api/admin', 'GET', undefined, guest.cookie)).response.status, 403);
    assert.equal((await request('/api/auth/guest', 'POST', { name: 'Intruso' }, undefined, { Origin: 'https://otro-sitio.invalid' })).response.status, 403);
    assert.equal(await rejectedSocket(), 401); assert.equal(await rejectedSocket(alice.cookie, 'https://otro-sitio.invalid'), 403);
  });
  await t.test('difunde un mensaje a todos, incluido su autor', async () => {
    aliceSocket = connect(alice.cookie); bobSocket = connect(bob.cookie); guestSocket = connect(guest.cookie); adminSocket = connect(admin.cookie);
    for (const client of [aliceSocket, bobSocket, guestSocket, adminSocket]) await client.next('ready');
    aliceSocket.send({ type: 'message.send', text: 'Hola desde Alicia', requestId: 'test-message' });
    for (const client of [aliceSocket, bobSocket, guestSocket, adminSocket]) { const event = await client.next('message.created'); assert.equal(event.message.text, 'Hola desde Alicia'); assert.equal(event.requestId, 'test-message'); message = event.message; }
    assert.equal(message.author.id, alice.data.user.id);
  });
  await t.test('rechaza mensajes inválidos y la edición de mensajes ajenos', async () => {
    bobSocket.send({ type: 'message.edit', id: message.id, text: 'Me hago pasar por Alicia' }); assert.match((await bobSocket.next('error')).error, /propios/);
    guestSocket.send({ type: 'message.edit', id: message.id, text: 'No permitido' }); assert.match((await guestSocket.next('error')).error, /propios/);
    aliceSocket.send({ type: 'message.send', text: '   ' }); assert.match((await aliceSocket.next('error')).error, /caracteres/);
    aliceSocket.send({ type: 'message.send', text: 'a'.repeat(1001) }); assert.match((await aliceSocket.next('error')).error, /caracteres/);
    aliceSocket.ws.send('esto no es JSON'); assert.match((await aliceSocket.next('error')).error, /válido/);
  });
  await t.test('la edición se guarda y se sincroniza en todos los clientes', async () => {
    aliceSocket.send({ type: 'message.edit', id: message.id, text: 'Hola, mensaje editado' });
    for (const client of [aliceSocket, bobSocket, guestSocket, adminSocket]) { const event = await client.next('message.updated'); assert.equal(event.message.text, 'Hola, mensaje editado'); assert.ok(event.message.editedAt); }
    const history = await request('/api/messages', 'GET', undefined, alice.cookie); assert.equal(history.data.messages[0].text, 'Hola, mensaje editado');
    await request('/api/profile', 'PATCH', { name: 'Alicia nueva', color: 'violet' }, alice.cookie);
    const updated = await aliceSocket.next('profile.updated'); assert.equal(updated.user.name, 'Alicia nueva');
  });
  await t.test('los invitados tienen límites y no pueden editar sus mensajes', async () => {
    guestSocket.send({ type: 'message.send', text: 'Soy invitado' }); const created = await guestSocket.next('message.created');
    guestSocket.send({ type: 'message.edit', id: created.message.id, text: 'Cambio' }); assert.match((await guestSocket.next('error')).error, /propios/);
    guestSocket.send({ type: 'message.send', text: 'Muy rápido' }); assert.match((await guestSocket.next('error')).error, /intentos/);
    adminSocket.send({ type: 'message.delete', id: created.message.id });
    const deleted = await adminSocket.next('message.updated'); assert.equal(deleted.message.deleted, true); assert.equal(deleted.message.text, '');
  });
  await t.test('el administrador ve métricas y puede suspender y reactivar cuentas', async () => {
    const stats = await request('/api/admin', 'GET', undefined, admin.cookie); assert.equal(stats.data.activeConnections, 4); assert.equal(stats.data.totalUsers, 3); assert.equal(stats.data.database, 'SQLite');
    assert.equal((await request(`/api/admin/users/${bob.data.user.id}`, 'PATCH', { banned: true }, alice.cookie)).response.status, 403);
    assert.equal((await request(`/api/admin/users/${admin.data.user.id}`, 'PATCH', { banned: true }, admin.cookie)).response.status, 403);
    const closed = new Promise(accept => bobSocket.ws.once('close', (code) => accept(code)));
    assert.equal((await request(`/api/admin/users/${bob.data.user.id}`, 'PATCH', { banned: true }, admin.cookie)).response.status, 200); assert.equal(await closed, 4003);
    assert.equal((await request('/api/messages', 'GET', undefined, bob.cookie)).response.status, 401);
    assert.equal((await request('/api/auth/login', 'POST', { email: 'bob@test.local', password: 'Bob-password-2026' })).response.status, 403);
    await request(`/api/admin/users/${bob.data.user.id}`, 'PATCH', { banned: false }, admin.cookie);
    assert.equal((await request('/api/auth/login', 'POST', { email: 'bob@test.local', password: 'Bob-password-2026' })).response.status, 200);
  });
  await t.test('las contraseñas y tokens no se guardan en texto visible', () => {
    const db = new BaseDatos(databasePath); const user = db.byEmail(credentials.email); assert.match(user.password_hash, /^scrypt\$/); assert.ok(!user.password_hash.includes(credentials.password));
    const session = db.db.prepare('SELECT token_hash FROM sessions WHERE user_id = ?').get(user.id); assert.ok(session); assert.ok(!alice.cookie.includes(session.token_hash)); db.close();
  });
  await t.test('el historial y las cuentas sobreviven a reiniciar el servidor', async () => {
    await app.close(); app = await iniciarServidor(0, options); base = `http://127.0.0.1:${app.port}`;
    const history = await request('/api/messages', 'GET', undefined, alice.cookie); assert.equal(history.response.status, 200); assert.equal(history.data.messages[0].text, 'Hola, mensaje editado'); assert.equal(history.data.messages[0].author.name, 'Alicia nueva');
    assert.equal((await request('/api/me', 'GET', undefined, alice.cookie)).data.user.id, alice.data.user.id);
    const db = new BaseDatos(databasePath); for (let n = 0; n < 55; n++) db.addMessage(alice.data.user.id, `Mensaje de historial ${n}`); db.close();
    const page = await request('/api/messages', 'GET', undefined, alice.cookie); assert.equal(page.data.messages.length, 50); assert.equal(page.data.hasMore, true);
    const previous = await request(`/api/messages?before=${page.data.messages[0].id}`, 'GET', undefined, alice.cookie); assert.ok(previous.data.messages.length > 0); assert.ok(previous.data.messages.at(-1).id < page.data.messages[0].id);
  });
  await t.test('cerrar sesión revoca el acceso HTTP y WebSocket', async () => {
    assert.equal((await request('/api/auth/logout', 'POST', undefined, alice.cookie)).response.status, 200);
    assert.equal((await request('/api/me', 'GET', undefined, alice.cookie)).data.user, null);
    assert.equal((await request('/api/messages', 'GET', undefined, alice.cookie)).response.status, 401); assert.equal(await rejectedSocket(alice.cookie), 401);
  });
  await t.test('el cliente de terminal usa el mismo protocolo y el puerto elegido', { timeout: 15000 }, async () => {
    const observer = connect(admin.cookie); await observer.next('ready');
    const child = spawn(process.execPath, ['dist/index.js', 'connect', String(app.port), 'Terminal de prueba'], { cwd: resolve('.'), stdio: ['pipe', 'pipe', 'pipe'] });
    const exited = once(child, 'exit');
    t.after(() => { if (child.exitCode === null) child.kill(); });
    let output = ''; let diagnostics = '';
    child.stderr.on('data', data => { diagnostics += data.toString(); });
    await new Promise((accept, reject) => {
      const timeout = setTimeout(() => reject(new Error('El cliente de terminal no conectó: ' + output)), 6000);
      child.stdout.on('data', data => { output += data.toString(); if (output.includes('Conectado a Pulso')) { clearTimeout(timeout); accept(); } });
      child.once('error', error => { clearTimeout(timeout); reject(error); });
    });
    child.stdin.write('Mensaje desde la terminal\n');
    const event = await observer.next('message.created'); assert.equal(event.message.text, 'Mensaje desde la terminal'); assert.equal(event.message.author.role, 'guest');
    child.stdin.end('/salir\n');
    let deadline;
    const [code] = await Promise.race([exited, new Promise((_accept, reject) => { deadline = setTimeout(() => { child.kill(); reject(new Error('El cliente no terminó: ' + output + diagnostics)); }, 5000); })]);
    clearTimeout(deadline); assert.equal(code, 0);
  });
});
