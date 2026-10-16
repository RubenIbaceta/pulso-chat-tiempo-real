const $ = selector => document.querySelector(selector);
const state = { user: null, socket: null, messages: new Map(), presence: [], mode: 'login', view: 'chat', editing: null, pending: null, connected: false, retry: 0, retryTimer: null, hasMore: false, authBusy: false };
const roles = { user: 'Usuario', admin: 'Administrador', guest: 'Invitado' };
let toastTimer;
let adminTimer;

function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.classList.add('icon'); svg.setAttribute('aria-hidden', 'true');
  const use = document.createElementNS(svg.namespaceURI, 'use'); use.setAttribute('href', `#i-${name}`); svg.append(use); return svg;
}
function el(tag, className, text) { const element = document.createElement(tag); if (className) element.className = className; if (text !== undefined) element.textContent = text; return element; }
function initials(name) { return name.trim().split(/\s+/).map(part => [...part][0]).slice(0, 2).join('').toUpperCase(); }
function avatar(user) { const span = el('span', 'avatar', initials(user.name)); span.dataset.color = user.color || 'sage'; span.setAttribute('aria-hidden', 'true'); return span; }
const hour = date => new Date(date).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
const day = date => new Date(date).toLocaleDateString('es-CL', { day: 'numeric', month: 'long', year: 'numeric' });
function toast(text, error = false) { clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').classList.toggle('error', error); $('#toast').hidden = false; toastTimer = setTimeout(() => $('#toast').hidden = true, 5000); }
function errorAt(id, message) { $(id).textContent = message; $(id).hidden = !message; }
async function api(path, options = {}) {
  const response = await fetch(path, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers }, body: options.body ? JSON.stringify(options.body) : undefined });
  const data = await response.json();
  if (!response.ok) { const error = new Error(data.error || 'No se pudo completar la solicitud.'); error.status = response.status; throw error; }
  return data;
}
function themeToggle() { const value = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'; document.documentElement.dataset.theme = value; try { localStorage.setItem('pulso-theme', value); } catch {} }
try { document.documentElement.dataset.theme = localStorage.getItem('pulso-theme') || 'light'; } catch {}
$('#theme-toggle').addEventListener('click', themeToggle); $('#access-theme').addEventListener('click', themeToggle);

function authMode(mode) {
  state.mode = mode;
  $('#tab-login').setAttribute('aria-pressed', String(mode === 'login')); $('#tab-register').setAttribute('aria-pressed', String(mode === 'register'));
  $('#register-name-field').hidden = mode !== 'register'; $('#register-name').required = mode === 'register';
  $('#auth-title').textContent = mode === 'login' ? 'Qué bueno verte.' : 'Haz espacio para tu voz.';
  $('#auth-subtitle').textContent = mode === 'login' ? 'Entra a tu cuenta y sigue el hilo.' : 'Crea tu cuenta. Dale vida a la conversación.';
  $('#auth-submit').replaceChildren(document.createTextNode(mode === 'login' ? 'Entrar a Pulso' : 'Crear mi cuenta'), icon('arrow'));
  $('#password').autocomplete = mode === 'login' ? 'current-password' : 'new-password'; errorAt('#auth-error', '');
}
$('#tab-login').addEventListener('click', () => authMode('login')); $('#tab-register').addEventListener('click', () => authMode('register'));
$('#auth-form').addEventListener('submit', async event => {
  event.preventDefault(); if (state.authBusy) return; state.authBusy = true; $('#auth-submit').disabled = true; errorAt('#auth-error', '');
  try { const data = await api(`/api/auth/${state.mode}`, { method: 'POST', body: { name: $('#register-name').value, email: $('#email').value, password: $('#password').value } }); $('#password').value = ''; enter(data.user); }
  catch (error) { errorAt('#auth-error', error.message); } finally { state.authBusy = false; $('#auth-submit').disabled = false; }
});
$('#guest-form').addEventListener('submit', async event => {
  event.preventDefault(); const button = event.currentTarget.querySelector('button'); button.disabled = true; errorAt('#guest-error', '');
  try { const data = await api('/api/auth/guest', { method: 'POST', body: { name: $('#guest-name').value } }); enter(data.user); }
  catch (error) { errorAt('#guest-error', error.message); } finally { button.disabled = false; }
});
function updateSelf() {
  const user = state.user; if (!user) return;
  $('#self-name').textContent = user.name; $('#self-role').textContent = roles[user.role]; $('#self-avatar').textContent = initials(user.name); $('#self-avatar').dataset.color = user.color;
  $('#nav-admin').hidden = user.role !== 'admin'; $('#guest-banner').hidden = user.role !== 'guest'; $('#nav-profile').setAttribute('aria-label', user.role === 'guest' ? 'Crear una cuenta' : 'Mi perfil');
  $('#compose-help').textContent = user.role === 'guest' ? 'Invitado · 30 mensajes/h · 2 segundos entre envíos' : 'Enter para enviar · Shift + Enter para un salto de línea';
}
function enter(user) { state.user = user; state.retry = 0; $('#boot').hidden = true; $('#access').hidden = true; $('#app').hidden = false; window.scrollTo(0, 0); updateSelf(); setView('chat'); connect(); }
function showAccess() {
  clearTimeout(state.retryTimer); clearInterval(adminTimer); state.user = null; state.connected = false;
  if (state.socket) { const old = state.socket; state.socket = null; old.close(); }
  clearPending(); state.messages.clear(); state.editing = null; $('#message-input').value = ''; $('#editing-banner').hidden = true;
  $('#boot').hidden = true; $('#app').hidden = true; $('#access').hidden = false;
  window.scrollTo(0, 0);
}
async function logout() { try { await api('/api/auth/logout', { method: 'POST' }); showAccess(); } catch (error) { toast(error.message, true); } }
$('#logout').addEventListener('click', logout);
$('#logout-mobile').addEventListener('click', logout);
$('#room-count').addEventListener('click', () => {
  const expanded = $('#people-panel').classList.toggle('expanded');
  $('#room-count').setAttribute('aria-expanded', String(expanded));
  if (expanded && window.innerWidth <= 900) $('#people-panel').scrollIntoView({ block: 'nearest' });
});
$('#upgrade-account').addEventListener('click', () => { showAccess(); authMode('register'); });

function connectionStatus(connected, label) { state.connected = connected; $('#connection-status').classList.toggle('offline', !connected); $('#connection-text').textContent = label; $('#message-input').disabled = !connected; $('#send-button').disabled = !connected || Boolean(state.pending); $('#reconnect').hidden = connected; }
function connect() {
  if (!state.user) return; clearTimeout(state.retryTimer);
  if (state.socket) { const old = state.socket; state.socket = null; old.close(); }
  connectionStatus(false, 'Conectando…'); $('#reconnect').hidden = true;
  const socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`); state.socket = socket;
  socket.addEventListener('open', () => { if (socket !== state.socket) return; state.retry = 0; connectionStatus(true, 'Conectado'); });
  socket.addEventListener('message', event => {
    if (socket !== state.socket) return;
    let data; try { data = JSON.parse(event.data); } catch { return; }
    if (data.type === 'ready') { state.user = data.user; state.messages = new Map(data.messages.map(message => [message.id, message])); state.hasMore = data.messages.length === 50; state.presence = data.presence; updateSelf(); renderMessages(true); renderPresence(); if (state.user.role === 'admin') void loadAdmin(); }
    if (data.type === 'presence') { state.presence = data.users; renderPresence(); }
    if (data.type === 'message.created' || data.type === 'message.updated') {
      const scroll = $('#message-scroll'); const nearBottom = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 100;
      state.messages.set(data.message.id, data.message);
      if (state.pending && ((data.type === 'message.created' && data.requestId === state.pending.id) || (data.type === 'message.updated' && data.message.id === state.editing))) { clearPending(); cancelEditing(true); }
      renderMessages(nearBottom || data.message.author.id === state.user.id);
    }
    if (data.type === 'profile.updated') { if (data.user.id === state.user.id) { state.user = data.user; updateSelf(); } for (const message of state.messages.values()) if (message.author.id === data.user.id) message.author = data.user; renderMessages(); }
    if (data.type === 'admin.stats' && state.user.role === 'admin') renderAdmin(data.stats);
    if (data.type === 'error') { clearPending(); toast(data.error, true); }
  });
  socket.addEventListener('close', async event => {
    if (socket !== state.socket || !state.user) return;
    clearPending(); connectionStatus(false, event.reason || 'Conexión cerrada'); state.presence = []; renderPresence();
    if (event.code === 4001 || event.code === 4003) { showAccess(); toast(event.reason || 'Tu sesión terminó.', true); return; }
    try { const data = await api('/api/me'); if (socket !== state.socket) return; if (!data.user) { showAccess(); toast('Tu sesión terminó. Vuelve a entrar.', true); return; } } catch {}
    if (state.retry < 5 && state.user) { const delay = Math.min(1000 * 2 ** state.retry++, 16000); state.retryTimer = setTimeout(connect, delay); }
  });
  socket.addEventListener('error', () => { if (socket === state.socket) connectionStatus(false, 'No se pudo conectar'); });
}
$('#reconnect').addEventListener('click', () => { state.retry = 0; connect(); });
function renderPresence() {
  const unique = [...new Map(state.presence.map(user => [user.id, user])).values()];
  $('#room-count').textContent = `${unique.length} en línea`; $('#people-count').textContent = String(unique.length);
  const list = $('#online-users'); list.replaceChildren();
  if (!unique.length) { list.append(el('p', 'small-text muted', state.connected ? 'Esperando a la comunidad…' : 'Sin conexión por ahora.')); return; }
  unique.sort((a, b) => (b.id === state.user?.id) - (a.id === state.user?.id)).forEach(user => { const row = el('div', 'online-person'); const details = el('div'); details.append(el('strong', '', user.name + (user.id === state.user?.id ? ' · tú' : ''))); const small = el('small', '', `${roles[user.role]} · ${user.client === 'terminal' ? 'terminal' : 'web'}`); details.append(small); row.append(avatar(user), details, el('span', 'live-dot')); list.append(row); });
}
function renderMessages(scrollBottom = false) {
  const list = $('#messages'); const scroll = $('#message-scroll'); const oldPosition = scroll.scrollTop; list.replaceChildren(); let lastDay = '';
  [...state.messages.values()].sort((a, b) => a.id - b.id).forEach(message => {
    const date = day(message.createdAt); if (date !== lastDay) { list.append(el('div', 'date-separator', date)); lastDay = date; }
    const own = message.author.id === state.user?.id;
    const row = el('article', `message${own ? ' own' : ''}${message.deleted ? ' deleted' : ''}`); const content = el('div', 'message-content'); const meta = el('div', 'message-meta');
    meta.append(el('span', 'message-author', message.author.name + (own ? ' · tú' : '')));
    if (message.author.role !== 'user') meta.append(el('span', 'role-tag', roles[message.author.role]));
    const time = el('time', '', hour(message.createdAt) + (message.editedAt ? ' · editado' : '')); time.dateTime = message.createdAt; time.title = new Date(message.createdAt).toLocaleString('es-CL'); meta.append(time);
    content.append(meta, el('div', 'message-bubble', message.deleted ? 'Este mensaje fue eliminado.' : message.text));
    if (!message.deleted && state.user?.role !== 'guest' && (own || state.user?.role === 'admin')) {
      const actions = el('div', 'message-actions');
      if (own) { const edit = el('button', 'message-action', 'Editar'); edit.type = 'button'; edit.prepend(icon('edit')); edit.addEventListener('click', () => startEditing(message)); actions.append(edit); }
      const remove = el('button', 'message-action delete', own ? 'Eliminar' : 'Moderar'); remove.type = 'button'; remove.prepend(icon('trash')); remove.addEventListener('click', async () => { if (await confirmAction('¿Eliminar este mensaje?', 'Se retirará su contenido del historial para todos los clientes. Esta acción no se puede deshacer.')) send({ type: 'message.delete', id: message.id }); }); actions.append(remove); content.append(actions);
    }
    row.append(avatar(message.author), content); list.append(row);
  });
  $('#empty-chat').hidden = state.messages.size > 0; $('#load-history').hidden = !state.hasMore;
  scroll.scrollTop = scrollBottom ? scroll.scrollHeight : oldPosition;
}
$('#load-history').addEventListener('click', async () => {
  const button = $('#load-history'); button.disabled = true;
  try { const before = Math.min(...state.messages.keys()); const data = await api(`/api/messages?before=${before}`); const scroll = $('#message-scroll'); const height = scroll.scrollHeight; const top = scroll.scrollTop; for (const message of data.messages) if (!state.messages.has(message.id)) state.messages.set(message.id, message); state.hasMore = data.hasMore; renderMessages(); scroll.scrollTop = top + scroll.scrollHeight - height; }
  catch (error) { toast(error.message, true); } finally { button.disabled = false; }
});
function send(payload) { if (!state.connected || state.socket?.readyState !== WebSocket.OPEN) { toast('Espera a que se restablezca la conexión.', true); return false; } state.socket.send(JSON.stringify(payload)); return true; }
function clearPending() { if (state.pending) clearTimeout(state.pending.timeout); state.pending = null; $('#send-button').disabled = !state.connected; }
function startEditing(message) { if (state.pending) return; state.editing = message.id; $('#editing-banner').hidden = false; $('#message-input').value = message.text; $('#message-input').focus(); updateInput(); }
function cancelEditing(clear = false) { state.editing = null; $('#editing-banner').hidden = true; if (clear) $('#message-input').value = ''; updateInput(); }
$('#cancel-edit').addEventListener('click', () => cancelEditing(true));
function updateInput() { const input = $('#message-input'); $('#character-count').textContent = `${input.value.length} / 1000`; input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 120)}px`; }
$('#message-input').addEventListener('input', updateInput);
$('#message-input').addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#message-form').requestSubmit(); } });
$('#message-form').addEventListener('submit', event => {
  event.preventDefault(); const text = $('#message-input').value.trim(); if (!text || state.pending) return;
  const id = crypto.randomUUID(); const payload = state.editing ? { type: 'message.edit', id: state.editing, text } : { type: 'message.send', text, requestId: id };
  if (!send(payload)) return;
  state.pending = { id, timeout: setTimeout(() => { clearPending(); toast('No llegó la confirmación. Tu texto sigue aquí; comprueba la conexión antes de reenviar.', true); }, 8000) }; $('#send-button').disabled = true;
});

function setView(view) {
  if (view === 'admin' && state.user?.role !== 'admin') return;
  state.view = view; $('#chat-view').hidden = view !== 'chat'; $('#admin-view').hidden = view !== 'admin'; $('#nav-chat').classList.toggle('active', view === 'chat'); $('#nav-admin').classList.toggle('active', view === 'admin'); $('#page-label').textContent = view === 'chat' ? 'Conversaciones' : 'Administración';
  clearInterval(adminTimer); if (view === 'admin') { void loadAdmin(); adminTimer = setInterval(loadAdmin, 15000); }
}
$('#nav-chat').addEventListener('click', () => setView('chat')); $('#nav-admin').addEventListener('click', () => setView('admin')); $('#refresh-admin').addEventListener('click', loadAdmin);
async function loadAdmin() { if (state.user?.role !== 'admin') return; try { renderAdmin(await api('/api/admin')); } catch (error) { toast(error.message, true); } }
function renderAdmin(data) {
  $('#metric-connections').textContent = data.activeConnections; $('#metric-unique').textContent = `${data.uniqueOnline} persona(s) conectada(s)`;
  $('#metric-messages').textContent = data.messagesToday; $('#metric-total').textContent = `${data.totalMessages} en el historial`; $('#metric-users').textContent = data.totalUsers;
  $('#metric-uptime').textContent = data.uptime < 3600 ? `${Math.floor(data.uptime / 60)} min` : `${Math.floor(data.uptime / 3600)} h ${Math.floor(data.uptime % 3600 / 60)} m`; $('#metric-memory').textContent = `${data.memoryMB} MB de memoria`;
  const connections = $('#admin-connections'); connections.replaceChildren();
  data.connections.forEach(user => { const row = el('div', 'admin-connection'); const details = el('div'); details.append(el('strong', '', user.name), el('small', '', `${roles[user.role]} · ${user.client === 'terminal' ? 'Terminal' : 'Navegador'} · ${hour(user.joinedAt)}`)); row.append(avatar(user), details); if (user.role !== 'admin') { const button = el('button', 'button secondary', 'Desconectar'); button.type = 'button'; button.addEventListener('click', async () => { if (!await confirmAction(`¿Desconectar a ${user.name}?`, 'Se cerrarán sus sesiones. Podrá volver a iniciar sesión si su cuenta está activa.')) return; try { await api('/api/admin/disconnect', { method: 'POST', body: { userId: user.id } }); toast('Sesiones cerradas.'); await loadAdmin(); } catch (error) { toast(error.message, true); } }); row.append(button); } connections.append(row); });
  if (!data.connections.length) connections.append(el('p', 'list-empty', 'No hay sesiones conectadas.'));
  const activity = $('#admin-activity'); activity.replaceChildren(); data.activity.forEach(item => { const row = el('div', 'activity-item'); const time = el('time', '', hour(item.createdAt)); time.title = day(item.createdAt); row.append(time, el('span', '', item.text)); activity.append(row); });
  const users = $('#admin-users'); users.replaceChildren(); data.users.forEach(user => { const row = el('tr'); const person = el('td'); const identity = el('div', 'table-person'); identity.append(avatar(user), el('span', '', user.name)); person.append(identity); const status = el('td'); status.append(el('span', 'status-tag' + (user.banned ? ' banned' : ''), user.banned ? 'Suspendida' : 'Activa')); const action = el('td');
    if (user.role !== 'admin') { const button = el('button', 'button secondary', user.banned ? 'Reactivar' : 'Suspender'); button.type = 'button'; button.addEventListener('click', async () => { if (!await confirmAction(`${user.banned ? '¿Reactivar' : '¿Suspender'} a ${user.name}?`, user.banned ? 'La persona podrá volver a iniciar sesión.' : 'Se cerrarán sus sesiones y no podrá entrar hasta que reactives su cuenta.')) return; try { await api(`/api/admin/users/${user.id}`, { method: 'PATCH', body: { banned: !user.banned } }); toast('Cuenta actualizada.'); await loadAdmin(); } catch (error) { toast(error.message, true); } }); action.append(button); } else action.textContent = 'Protegida';
    row.append(person, el('td', 'muted', user.email), el('td', '', roles[user.role]), status, action); users.append(row);
  });
  $('#database-info').replaceChildren(el('span', '', `SQLite · ${(data.databaseBytes / 1024).toFixed(0)} KB`), el('span', '', `Puerto ${data.port}`), el('span', '', `Actualizado a las ${hour(new Date())}`));
}
function confirmAction(title, description) {
  const dialog = $('#confirm-dialog'); if (dialog.open) return Promise.resolve(false);
  $('#confirm-title').textContent = title; $('#confirm-description').textContent = description;
  return new Promise(resolve => { const done = answer => { dialog.close(); $('#confirm-ok').removeEventListener('click', ok); $('#confirm-cancel').removeEventListener('click', cancel); dialog.removeEventListener('cancel', esc); resolve(answer); }; const ok = () => done(true); const cancel = () => done(false); const esc = event => { event.preventDefault(); done(false); }; $('#confirm-ok').addEventListener('click', ok); $('#confirm-cancel').addEventListener('click', cancel); dialog.addEventListener('cancel', esc); dialog.showModal(); $('#confirm-cancel').focus(); });
}
function openProfile() {
  if (state.user.role === 'guest') { showAccess(); authMode('register'); return; }
  $('#profile-name').value = state.user.name; document.querySelector(`input[name=color][value="${state.user.color}"]`).checked = true; errorAt('#profile-error', ''); updateProfilePreview(); $('#profile-dialog').showModal();
}
function updateProfilePreview() { const preview = $('#profile-avatar'); preview.textContent = initials($('#profile-name').value || 'Tú'); preview.dataset.color = $('input[name=color]:checked').value; }
$('#nav-profile').addEventListener('click', openProfile); $('#profile-shortcut').addEventListener('click', openProfile); $('#profile-close').addEventListener('click', () => $('#profile-dialog').close()); $('#profile-name').addEventListener('input', updateProfilePreview); document.querySelectorAll('input[name=color]').forEach(input => input.addEventListener('change', updateProfilePreview));
$('#profile-form').addEventListener('submit', async event => { event.preventDefault(); const button = event.currentTarget.querySelector('button[type=submit]'); button.disabled = true; try { const result = await api('/api/profile', { method: 'PATCH', body: { name: $('#profile-name').value, color: $('input[name=color]:checked').value } }); state.user = result.user; updateSelf(); $('#profile-dialog').close(); toast('Tu perfil ya tiene un nuevo pulso.'); } catch (error) { errorAt('#profile-error', error.message); } finally { button.disabled = false; } });

try { const result = await api('/api/me'); if (result.user) enter(result.user); else showAccess(); }
catch { $('#boot').hidden = true; $('#access').hidden = false; errorAt('#auth-error', 'No se pudo contactar con el servidor. Recarga la página cuando vuelva a estar disponible.'); }
