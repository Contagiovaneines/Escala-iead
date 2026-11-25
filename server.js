const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { suggestAssignments, nextCandidate } = require('./scheduler');

const HOST = process.env.HOST || '127.0.0.1';
const PORT = Number(process.env.PORT || 4173);
const DATA_DIR = path.join(__dirname, 'data');
const DATA_FILE = path.join(DATA_DIR, 'store.json');
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;
const ROLES = ['photo', 'live', 'projector'];
const MIME = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8' };
const SESSION_SECRET = process.env.SESSION_SECRET || (process.env.VERCEL ? '' : 'local-demo-secret-change-before-deploy');
let db = null;
let dbVersion = 0;
let neonClientPromise = null;
let neonSchemaReady = false;

function passwordRecord(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { salt, hash: crypto.scryptSync(password, salt, 64).toString('hex') };
}

function userRecord({ id, username, password, name, phone, departmentId, skills = [], role = 'member' }) {
  const secret = passwordRecord(password);
  return { id, username, name, phone, departmentId, skills, role, passwordSalt: secret.salt, passwordHash: secret.hash, createdAt: new Date().toISOString() };
}

function seedSchedule(events, users) {
  const suggested = suggestAssignments({ events, people: users });
  for (const event of suggested) events.find(item => item.id === event.id).assignments = event.assignments;
}

function demoMemberSpecs() {
  return [
    { id: 'u-carol', username: 'carol', password: 'carol123', name: 'Carolina Mendes', phone: '11990000010', departmentId: 'multimedia', skills: ['photo'] },
    { id: 'u-fernanda', username: 'fernanda', password: 'fernanda123', name: 'Fernanda Alves', phone: '11990000011', departmentId: 'multimedia', skills: ['photo'] },
    { id: 'u-eduardo', username: 'eduardo', password: 'eduardo123', name: 'Eduardo Lima', phone: '11990000012', departmentId: 'multimedia', skills: ['live'] },
    { id: 'u-felipe', username: 'felipe', password: 'felipe123', name: 'Felipe Santos', phone: '11990000013', departmentId: 'multimedia', skills: ['live'] },
    { id: 'u-gabriel', username: 'gabriel', password: 'gabriel123', name: 'Gabriel Oliveira', phone: '11990000014', departmentId: 'multimedia', skills: ['projector'] },
    { id: 'u-igor', username: 'igor', password: 'igor123', name: 'Igor Almeida', phone: '11990000015', departmentId: 'multimedia', skills: ['projector'] },
  ];
}

function seedDatabase() {
  const demoMode = !process.env.VERCEL || process.env.SEED_DEMO_ACCOUNTS === 'true';
  const initialAdminPassword = process.env.VERCEL ? process.env.INITIAL_ADMIN_PASSWORD : 'admin';
  if (!initialAdminPassword) throw Object.assign(new Error('Configure INITIAL_ADMIN_PASSWORD antes de inicializar o banco no Vercel.'), { status: 503 });
  const users = [
    userRecord({ id: 'u-ti', username: 'admin', password: initialAdminPassword, name: 'Administrador TI', phone: '11990000001', departmentId: 'multimedia', role: 'ti' }),
  ];
  if (demoMode) users.push(
    userRecord({ id: 'u-leader', username: 'lider', password: 'lider123', name: 'Mariana Alves', phone: '11990000002', departmentId: 'multimedia', skills: ['live'], role: 'leader' }),
    userRecord({ id: 'u-ana', username: 'ana', password: 'ana123', name: 'Ana Lima', phone: '11990000003', departmentId: 'multimedia', skills: ['photo'] }),
    userRecord({ id: 'u-bia', username: 'bia', password: 'bia123', name: 'Beatriz Souza', phone: '11990000004', departmentId: 'multimedia', skills: ['photo'] }),
    userRecord({ id: 'u-bruno', username: 'bruno', password: 'bruno123', name: 'Bruno Costa', phone: '11990000005', departmentId: 'multimedia', skills: ['live'] }),
    userRecord({ id: 'u-camila', username: 'camila', password: 'camila123', name: 'Camila Rocha', phone: '11990000006', departmentId: 'multimedia', skills: ['projector'] }),
    userRecord({ id: 'u-davi', username: 'davi', password: 'davi123', name: 'Davi Martins', phone: '11990000007', departmentId: 'multimedia', skills: ['live', 'projector'] }),
    userRecord({ id: 'u-demo', username: 'user', password: 'user', name: 'Usuário Demonstração', phone: '11990000009', departmentId: 'multimedia', skills: ['live', 'projector'] }),
    userRecord({ id: 'u-louvor', username: 'louvor', password: 'louvor123', name: 'Lucas Ferreira', phone: '11990000008', departmentId: 'louvor', skills: ['live'] }),
    ...demoMemberSpecs().map(person => userRecord(person)),
  );
  const events = (demoMode ? [
    ['e-ceia', 'Ceia', '2026-12-05'],
    ['e-culto-06', 'Culto de domingo', '2026-12-06'],
    ['e-culto-13', 'Culto de domingo', '2026-12-13'],
    ['e-natal', 'Natal', '2026-12-20'],
    ['e-culto-27', 'Culto de domingo', '2026-12-27'],
    ['e-ano-novo', 'Ano Novo', '2026-12-31'],
  ] : []).map(([id, name, date]) => ({ id, name, date, time: '18:30', departmentId: 'multimedia', assignments: {} }));
  if (demoMode) seedSchedule(events, users);
  const now = new Date().toISOString();
  const scales = demoMode ? { 'multimedia|2026-12': { departmentId: 'multimedia', month: '2026-12', status: 'published', responsibleUserId: 'u-ti', confirmedById: 'u-ti', publishedAt: now, updatedAt: now } } : {};
  return { demoVersion: 3, departments: [{ id: 'multimedia', name: 'Multimídia' }, ...(demoMode ? [{ id: 'louvor', name: 'Louvor (exemplo)' }] : [])], users, events, availability: [], scales };
}

function migrateDatabase(database) {
  let changed = false;
  database.departments ||= [{ id: 'multimedia', name: 'Multimídia' }, { id: 'louvor', name: 'Louvor (exemplo)' }];
  database.users ||= [];
  database.events ||= [];
  database.availability ||= [];
  database.scales ||= {};
  const demoMode = !process.env.VERCEL || process.env.SEED_DEMO_ACCOUNTS === 'true';
  if (demoMode) {
    const demoUsers = [
      { id: 'u-demo', username: 'user', password: 'user', name: 'Usuário Demonstração', phone: '11990000009', departmentId: 'multimedia', skills: ['live', 'projector'] },
      ...demoMemberSpecs(),
    ];
    for (const person of demoUsers) if (!database.users.some(user => user.username === person.username)) {
      database.users.push(userRecord(person));
      changed = true;
    }
  }
  if ((database.demoVersion || 0) < 3) {
    seedSchedule(database.events, database.users);
    const now = new Date().toISOString();
    const scale = database.scales['multimedia|2026-12'] ||= { departmentId: 'multimedia', month: '2026-12', responsibleUserId: 'u-ti' };
    scale.status = 'published';
    scale.confirmedById ||= 'u-ti';
    scale.publishedAt ||= now;
    scale.updatedAt = now;
    database.demoVersion = 3;
    changed = true;
  }
  if ((database.demoVersion || 0) < 4) {
    database.demoVersion = 4;
    changed = true;
  }
  return changed;
}

function readLocalDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(DATA_FILE)) {
    const initial = seedDatabase();
    fs.writeFileSync(DATA_FILE, JSON.stringify(initial, null, 2), { mode: 0o600 });
    return initial;
  }
  try { return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8')); }
  catch (error) { throw new Error(`Não foi possível ler ${DATA_FILE}: ${error.message}`); }
}

function writeLocalDatabase() {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  const temp = `${DATA_FILE}.${process.pid}.tmp`;
  fs.writeFileSync(temp, JSON.stringify(db, null, 2), { mode: 0o600 });
  fs.renameSync(temp, DATA_FILE);
}

async function neonSql() {
  if (!neonClientPromise) neonClientPromise = import('@neondatabase/serverless').then(({ neon }) => neon(process.env.DATABASE_URL));
  return neonClientPromise;
}

async function refreshDatabase() {
  if (!process.env.DATABASE_URL) {
    db = readLocalDatabase();
    dbVersion = 0;
    if (migrateDatabase(db)) writeLocalDatabase();
    return;
  }
  const sql = await neonSql();
  if (!neonSchemaReady) {
    await sql`CREATE TABLE IF NOT EXISTS escala_app_state (id integer PRIMARY KEY CHECK (id = 1), payload jsonb NOT NULL, version bigint NOT NULL DEFAULT 1)`;
    neonSchemaReady = true;
  }
  let rows = await sql`SELECT payload, version FROM escala_app_state WHERE id = 1`;
  if (!rows.length) {
    const initial = seedDatabase();
    await sql`INSERT INTO escala_app_state (id, payload, version) VALUES (1, ${JSON.stringify(initial)}::jsonb, 1) ON CONFLICT (id) DO NOTHING`;
    rows = await sql`SELECT payload, version FROM escala_app_state WHERE id = 1`;
  }
  db = typeof rows[0].payload === 'string' ? JSON.parse(rows[0].payload) : rows[0].payload;
  dbVersion = Number(rows[0].version);
  if (migrateDatabase(db)) await persist();
}

async function persist() {
  if (!process.env.DATABASE_URL) { writeLocalDatabase(); return; }
  const sql = await neonSql();
  const rows = await sql`UPDATE escala_app_state SET payload = ${JSON.stringify(db)}::jsonb, version = version + 1 WHERE id = 1 AND version = ${dbVersion} RETURNING version`;
  if (!rows.length) throw Object.assign(new Error('Outra pessoa alterou os dados ao mesmo tempo. Atualize a página e tente novamente.'), { status: 409 });
  dbVersion = Number(rows[0].version);
}

function publicUser(user, includePhone = false) {
  const result = { id: user.id, username: user.username, name: user.name, departmentId: user.departmentId, skills: user.skills, role: user.role };
  if (includePhone) result.phone = user.phone;
  return result;
}

function isManager(user) { return ['ti', 'admin', 'leader'].includes(user.role); }
function scaleKey(departmentId, month) { return `${departmentId}|${month}`; }
function getScale(departmentId, month) {
  const key = scaleKey(departmentId, month);
  if (!db.scales[key]) db.scales[key] = { departmentId, month, status: 'draft', responsibleUserId: db.users.find(user => user.role === 'ti')?.id || null, updatedAt: new Date().toISOString() };
  return db.scales[key];
}
function monthIsValid(month) { return /^\d{4}-(0[1-9]|1[0-2])$/.test(month || ''); }
function eventMonth(event) { return event.date.slice(0, 7); }
function nameOfRole(role) { return ({ photo: 'Fotos', live: 'Live', projector: 'Projetor' })[role] || role; }
function assignedElsewhere(userId, event, role) {
  return db.events.some(other => other.date === event.date && other.departmentId === event.departmentId && ROLES.some(otherRole => !(other.id === event.id && otherRole === role) && other.assignments?.[otherRole] === userId));
}
function unavailable(userId, date) { return db.availability.some(item => item.userId === userId && item.date === date && item.status === 'pending'); }
function saoPauloDate() {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const part = Object.fromEntries(parts.map(item => [item.type, item.value]));
  return `${part.year}-${part.month}-${part.day}`;
}
function markDraft(departmentId, month) {
  const scale = getScale(departmentId, month);
  scale.status = 'draft';
  scale.publishedAt = null;
  scale.updatedAt = new Date().toISOString();
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(part => part.trim()).filter(Boolean).map(part => {
    const index = part.indexOf('=');
    return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
  }));
}

function currentUser(req) {
  const token = parseCookies(req.headers.cookie).sid;
  if (!token || !SESSION_SECRET) return null;
  const [payload, signature, extra] = token.split('.');
  if (!payload || !signature || extra) return null;
  const expected = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest();
  let received;
  try { received = Buffer.from(signature, 'base64url'); } catch { return null; }
  if (received.length !== expected.length || !crypto.timingSafeEqual(received, expected)) return null;
  try {
    const session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    if (!session.sub || session.exp < Date.now()) return null;
    return db.users.find(user => user.id === session.sub) || null;
  } catch { return null; }
}

function setSession(res, user) {
  if (!SESSION_SECRET) throw Object.assign(new Error('Configure SESSION_SECRET no projeto.'), { status: 503 });
  const payload = Buffer.from(JSON.stringify({ sub: user.id, exp: Date.now() + SESSION_MS })).toString('base64url');
  const signature = crypto.createHmac('sha256', SESSION_SECRET).update(payload).digest('base64url');
  const token = `${payload}.${signature}`;
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(SESSION_MS / 1000)}${secure}`);
}

function clearSession(res) {
  const secure = process.env.NODE_ENV === 'production' || process.env.VERCEL ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0${secure}`);
}

function sendJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, { 'Content-Type': MIME['.json'], 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
  res.end(body);
}

function fail(res, status, message) { sendJson(res, status, { error: message }); }

function readBody(req) {
  if (req.body !== undefined) {
    if (req.body && typeof req.body === 'object') return Promise.resolve(req.body);
    try { return Promise.resolve(JSON.parse(String(req.body))); } catch { return Promise.reject(Object.assign(new Error('Formato de dados inválido.'), { status: 400 })); }
  }
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 1024 * 1024) { reject(Object.assign(new Error('A solicitação é muito grande.'), { status: 413 })); req.destroy(); }
    });
    req.on('end', () => {
      if (!body) return resolve({});
      try { resolve(JSON.parse(body)); } catch { reject(Object.assign(new Error('Formato de dados inválido.'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}

function scopedBootstrap(user) {
  const manager = isManager(user);
  const departmentId = manager ? null : user.departmentId;
  const visibleScales = Object.values(db.scales).filter(scale => manager || (scale.departmentId === departmentId && scale.status === 'published'));
  const visibleEvents = db.events.filter(event => {
    if (manager) return true;
    const scale = db.scales[scaleKey(event.departmentId, eventMonth(event))];
    return event.departmentId === departmentId && scale?.status === 'published';
  });
  const visibleUsers = manager ? db.users : db.users.filter(person => person.departmentId === departmentId);
  return {
    user: publicUser(user),
    departments: manager ? db.departments : db.departments.filter(dept => dept.id === departmentId),
    users: visibleUsers.map(person => publicUser(person, manager)),
    events: visibleEvents,
    scales: visibleScales,
    availability: db.availability.filter(item => manager || item.userId === user.id).map(item => ({ ...item, user: publicUser(db.users.find(person => person.id === item.userId) || { id: item.userId, name: 'Conta removida', departmentId: '', skills: [], role: 'member' }, manager) })),
    isManager: manager,
    canManageRoles: user.role === 'ti',
  };
}

function validateEventInput(body, departmentId) {
  const name = String(body.name || '').trim();
  const date = String(body.date || '');
  const time = String(body.time || '18:30');
  if (name.length < 2 || name.length > 80) return 'O nome do evento deve ter de 2 a 80 caracteres.';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(`${date}T12:00:00`))) return 'Informe uma data válida.';
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return 'Informe um horário válido.';
  if (!db.departments.some(dept => dept.id === departmentId)) return 'Departamento inválido.';
  return null;
}

function randomId(prefix) { return `${prefix}-${crypto.randomBytes(7).toString('hex')}`; }

async function handleApi(req, res, url) {
  if (process.env.VERCEL && (!process.env.DATABASE_URL || !SESSION_SECRET)) return fail(res, 503, 'Configure DATABASE_URL e SESSION_SECRET nas variáveis do projeto Vercel.');
  await refreshDatabase();
  const method = req.method;
  const route = url.pathname;

  if (route === '/api/meta' && method === 'GET') {
    return sendJson(res, 200, { departments: db.departments, roles: ROLES.map(id => ({ id, name: nameOfRole(id) })) });
  }

  if (route === '/api/signup' && method === 'POST') {
    const body = await readBody(req);
    const name = String(body.name || '').trim();
    const username = String(body.username || '').trim().toLowerCase();
    const phone = String(body.phone || '').replace(/\D/g, '');
    const password = String(body.password || '');
    const departmentId = String(body.departmentId || '');
    const skills = Array.isArray(body.skills) ? [...new Set(body.skills)] : [];
    if (name.length < 2 || name.length > 80) return fail(res, 400, 'Informe seu nome completo.');
    if (!/^[a-z0-9._-]{3,24}$/.test(username)) return fail(res, 400, 'O login deve ter de 3 a 24 letras, números, ponto, hífen ou sublinhado.');
    if (phone.length < 10 || phone.length > 15) return fail(res, 400, 'Informe um telefone com DDD.');
    if (password.length < 6 || password.length > 100) return fail(res, 400, 'A senha deve ter pelo menos 6 caracteres.');
    if (db.users.some(user => user.username === username)) return fail(res, 409, 'Esse login já está em uso.');
    if (!db.departments.some(dept => dept.id === departmentId)) return fail(res, 400, 'Escolha um departamento válido.');
    if (!skills.length || skills.some(skill => !ROLES.includes(skill))) return fail(res, 400, 'Escolha ao menos uma função válida.');
    if (skills.includes('photo') && skills.length > 1) return fail(res, 400, 'Fotos é uma equipe separada. Escolha Fotos ou funções de Live/Projetor.');
    const secret = passwordRecord(password);
    const user = { id: randomId('u'), username, name, phone, departmentId, skills, role: 'member', passwordSalt: secret.salt, passwordHash: secret.hash, createdAt: new Date().toISOString() };
    db.users.push(user);
    await persist();
    setSession(res, user);
    return sendJson(res, 201, { user: publicUser(user) });
  }

  if (route === '/api/login' && method === 'POST') {
    const body = await readBody(req);
    const username = String(body.username || '').trim().toLowerCase();
    const password = String(body.password || '');
    const user = db.users.find(entry => entry.username === username);
    if (!user) return fail(res, 401, 'Login ou senha incorretos.');
    const attempt = crypto.scryptSync(password, user.passwordSalt, 64);
    const expected = Buffer.from(user.passwordHash, 'hex');
    if (attempt.length !== expected.length || !crypto.timingSafeEqual(attempt, expected)) return fail(res, 401, 'Login ou senha incorretos.');
    setSession(res, user);
    return sendJson(res, 200, { user: publicUser(user) });
  }

  if (route === '/api/logout' && method === 'POST') {
    clearSession(res);
    return sendJson(res, 200, { ok: true });
  }

  const user = currentUser(req);
  if (route === '/api/me' && method === 'GET') {
    if (!user) return fail(res, 401, 'Entre na sua conta.');
    return sendJson(res, 200, scopedBootstrap(user));
  }
  if (!user) return fail(res, 401, 'Entre na sua conta.');

  if (route === '/api/signup' || route === '/api/login') return fail(res, 405, 'Método não permitido.');
  const manager = isManager(user);

  if (route === '/api/events' && method === 'POST') {
    if (!manager) return fail(res, 403, 'Só líder, administrador ou TI pode cadastrar eventos.');
    const body = await readBody(req);
    const departmentId = String(body.departmentId || 'multimedia');
    const invalid = validateEventInput(body, departmentId);
    if (invalid) return fail(res, 400, invalid);
    const event = { id: randomId('e'), name: String(body.name).trim(), date: body.date, time: body.time || '18:30', departmentId, assignments: {} };
    db.events.push(event);
    markDraft(departmentId, eventMonth(event));
    await persist();
    return sendJson(res, 201, event);
  }

  const eventRoute = route.match(/^\/api\/events\/([a-zA-Z0-9-]+)$/);
  if (eventRoute && method === 'PUT') {
    if (!manager) return fail(res, 403, 'Só líder, administrador ou TI pode editar eventos.');
    const event = db.events.find(entry => entry.id === eventRoute[1]);
    if (!event) return fail(res, 404, 'Evento não encontrado.');
    const body = await readBody(req);
    const invalid = validateEventInput(body, String(body.departmentId || event.departmentId));
    if (invalid) return fail(res, 400, invalid);
    const beforeMonth = eventMonth(event);
    event.name = String(body.name).trim();
    event.date = body.date;
    event.time = body.time || '18:30';
    const nextDepartment = String(body.departmentId || event.departmentId);
    if (nextDepartment !== event.departmentId || eventMonth(event) !== beforeMonth) event.assignments = {};
    const oldDepartment = event.departmentId;
    event.departmentId = nextDepartment;
    markDraft(oldDepartment, beforeMonth);
    markDraft(event.departmentId, eventMonth(event));
    for (const role of ROLES) {
      const personId = event.assignments[role];
      if (personId && (assignedElsewhere(personId, event, role) || unavailable(personId, event.date))) event.assignments[role] = '';
    }
    await persist();
    return sendJson(res, 200, event);
  }

  if (eventRoute && method === 'DELETE') {
    if (!manager) return fail(res, 403, 'Só líder, administrador ou TI pode excluir eventos.');
    const index = db.events.findIndex(entry => entry.id === eventRoute[1]);
    if (index < 0) return fail(res, 404, 'Evento não encontrado.');
    const [event] = db.events.splice(index, 1);
    markDraft(event.departmentId, eventMonth(event));
    await persist();
    return sendJson(res, 200, { ok: true });
  }

  const assignmentRoute = route.match(/^\/api\/events\/([a-zA-Z0-9-]+)\/assignment$/);
  if (assignmentRoute && method === 'PUT') {
    if (!manager) return fail(res, 403, 'Só líder, administrador ou TI pode editar a escala.');
    const event = db.events.find(entry => entry.id === assignmentRoute[1]);
    if (!event) return fail(res, 404, 'Evento não encontrado.');
    const body = await readBody(req);
    const role = String(body.role || '');
    const personId = String(body.personId || '');
    if (!ROLES.includes(role)) return fail(res, 400, 'Função inválida.');
    const previousPersonId = event.assignments?.[role] || '';
    let replacement = '';
    if (personId) {
      const person = db.users.find(entry => entry.id === personId);
      if (!person || person.departmentId !== event.departmentId || !person.skills.includes(role)) return fail(res, 400, 'Essa pessoa não está habilitada para essa função neste departamento.');
      if (assignedElsewhere(person.id, event, role)) return fail(res, 409, 'Essa pessoa já está em outra função na mesma data.');
      if (unavailable(person.id, event.date)) return fail(res, 409, 'Essa pessoa avisou que não pode servir nessa data.');
      replacement = personId;
    } else replacement = nextCandidate({ event, role, people: db.users.filter(person => person.departmentId === event.departmentId), events: db.events, availability: db.availability, excludeUserId: previousPersonId });
    event.assignments = event.assignments || {};
    event.assignments[role] = replacement;
    const month = eventMonth(event);
    const deptPeople = db.users.filter(person => person.departmentId === event.departmentId);
    const reservedEvents = db.events.filter(item => item.departmentId === event.departmentId && eventMonth(item) === month && item.date <= event.date);
    const futureEvents = db.events.filter(item => item.departmentId === event.departmentId && eventMonth(item) === month && item.date > event.date);
    const rebalance = suggestAssignments({ events: futureEvents, people: deptPeople, availability: db.availability, reservedEvents });
    for (const suggested of rebalance) db.events.find(item => item.id === suggested.id).assignments = suggested.assignments;
    markDraft(event.departmentId, eventMonth(event));
    await persist();
    return sendJson(res, 200, { event, previousPersonId, replacement, rebalancedEvents: futureEvents.length });
  }

  const suggestRoute = route.match(/^\/api\/scales\/(\d{4}-\d{2})\/([a-zA-Z0-9-]+)\/suggest$/);
  if (suggestRoute && method === 'POST') {
    if (!manager) return fail(res, 403, 'Só líder, administrador ou TI pode sugerir escalas.');
    const [, month, departmentId] = suggestRoute;
    if (!monthIsValid(month) || !db.departments.some(dept => dept.id === departmentId)) return fail(res, 400, 'Mês ou departamento inválido.');
    const events = db.events.filter(event => event.departmentId === departmentId && eventMonth(event) === month).sort((a, b) => a.date.localeCompare(b.date) || a.name.localeCompare(b.name));
    if (!events.length) return fail(res, 400, 'Cadastre os eventos desse mês antes de sugerir a escala.');
    const people = db.users.filter(person => person.departmentId === departmentId);
    const reservedEvents = db.events.filter(event => event.departmentId === departmentId && eventMonth(event) !== month);
    const suggestions = suggestAssignments({ events, people, availability: db.availability, reservedEvents });
    let assigned = 0;
    for (const suggested of suggestions) {
      db.events.find(event => event.id === suggested.id).assignments = suggested.assignments;
      assigned += ROLES.filter(role => suggested.assignments[role]).length;
    }
    const open = suggestions.reduce((total, event) => total + ROLES.filter(role => !event.assignments[role]).length, 0);
    const scale = getScale(departmentId, month);
    scale.status = 'draft';
    scale.publishedAt = null;
    scale.updatedAt = new Date().toISOString();
    await persist();
    return sendJson(res, 200, { events, assigned, open });
  }

  const publishRoute = route.match(/^\/api\/scales\/(\d{4}-\d{2})\/([a-zA-Z0-9-]+)\/publish$/);
  if (publishRoute && method === 'POST') {
    if (!manager) return fail(res, 403, 'Só líder, administrador ou TI pode confirmar a escala.');
    const [, month, departmentId] = publishRoute;
    const events = db.events.filter(event => event.departmentId === departmentId && eventMonth(event) === month);
    if (!events.length) return fail(res, 400, 'Esse mês não tem eventos cadastrados.');
    const unavailableCount = events.reduce((total, event) => total + ROLES.filter(role => event.assignments?.[role] && unavailable(event.assignments[role], event.date)).length, 0);
    const missing = events.reduce((total, event) => total + ROLES.filter(role => !event.assignments?.[role]).length, 0);
    if (missing) return fail(res, 409, `Ainda faltam ${missing} função${missing === 1 ? '' : 'ões'} para preencher.`);
    if (unavailableCount) return fail(res, 409, `${unavailableCount} pessoa${unavailableCount === 1 ? ' avisou' : 's avisaram'} que não pode${unavailableCount === 1 ? '' : 'm'} servir nessa data. Ajuste a escala antes de publicar.`);
    const scale = getScale(departmentId, month);
    scale.status = 'published';
    scale.publishedAt = new Date().toISOString();
    scale.updatedAt = scale.publishedAt;
    scale.confirmedById = user.id;
    await persist();
    return sendJson(res, 200, scale);
  }

  const responsibleRoute = route.match(/^\/api\/scales\/(\d{4}-\d{2})\/([a-zA-Z0-9-]+)\/responsible$/);
  if (responsibleRoute && method === 'PUT') {
    if (!manager) return fail(res, 403, 'Só líder, administrador ou TI pode indicar o responsável.');
    const [, month, departmentId] = responsibleRoute;
    if (!monthIsValid(month) || !db.departments.some(dept => dept.id === departmentId)) return fail(res, 400, 'Mês ou departamento inválido.');
    const body = await readBody(req);
    const responsible = db.users.find(person => person.id === body.userId && isManager(person));
    if (!responsible) return fail(res, 400, 'Escolha um líder, administrador ou TI responsável.');
    const scale = getScale(departmentId, month);
    scale.responsibleUserId = responsible.id;
    scale.updatedAt = new Date().toISOString();
    await persist();
    return sendJson(res, 200, scale);
  }

  if (route === '/api/availability' && method === 'POST') {
    const body = await readBody(req);
    const targetUserId = manager && body.userId ? String(body.userId) : user.id;
    const target = db.users.find(person => person.id === targetUserId);
    const date = String(body.date || '');
    if (!target || target.departmentId !== user.departmentId && !manager) return fail(res, 403, 'Você não pode registrar aviso para essa pessoa.');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < saoPauloDate()) return fail(res, 400, 'Informe uma data de hoje em diante.');
    if (db.availability.some(item => item.userId === target.id && item.date === date && item.status === 'pending')) return fail(res, 409, 'Já existe um aviso para essa pessoa nessa data.');
    const item = { id: randomId('a'), userId: target.id, date, note: String(body.note || '').trim().slice(0, 180), status: 'pending', createdAt: new Date().toISOString() };
    db.availability.push(item);
    await persist();
    return sendJson(res, 201, item);
  }

  const availabilityRoute = route.match(/^\/api\/availability\/([a-zA-Z0-9-]+)$/);
  if (availabilityRoute && method === 'PATCH') {
    if (!manager) return fail(res, 403, 'Só líder, administrador ou TI pode resolver avisos.');
    const item = db.availability.find(entry => entry.id === availabilityRoute[1]);
    if (!item) return fail(res, 404, 'Aviso não encontrado.');
    item.status = 'resolved';
    item.resolvedById = user.id;
    item.resolvedAt = new Date().toISOString();
    await persist();
    return sendJson(res, 200, item);
  }

  const userRoleRoute = route.match(/^\/api\/users\/([a-zA-Z0-9-]+)\/role$/);
  if (userRoleRoute && method === 'PATCH') {
    if (user.role !== 'ti') return fail(res, 403, 'Somente TI pode alterar o nível de acesso.');
    const body = await readBody(req);
    const target = db.users.find(person => person.id === userRoleRoute[1]);
    const nextRole = String(body.role || '');
    if (!target) return fail(res, 404, 'Pessoa não encontrada.');
    if (target.id === user.id) return fail(res, 409, 'A conta de TI não pode remover o próprio acesso de TI.');
    if (!['member', 'leader', 'admin'].includes(nextRole)) return fail(res, 400, 'Nível de acesso inválido.');
    target.role = nextRole;
    await persist();
    return sendJson(res, 200, publicUser(target, true));
  }

  return fail(res, 404, 'Rota não encontrada.');
}

function serveStatic(req, res, pathname) {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', 'styles.css', 'app.js'].includes(relative)) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('Not found');
  }
  const file = path.join(__dirname, relative);
  fs.readFile(file, (error, content) => {
    if (error) { res.writeHead(500); return res.end('Não foi possível abrir o app.'); }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(file)], 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    res.end(content);
  });
}

async function handler(req, res) {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname.startsWith('/api/')) {
    try { await handleApi(req, res, url); }
    catch (error) {
      if (!res.headersSent) fail(res, error.status || 500, error.status ? error.message : 'O servidor encontrou um erro.');
      else res.destroy();
      if (!error.status) console.error(error);
    }
    return;
  }
  if (req.method === 'GET') return serveStatic(req, res, url.pathname);
  res.writeHead(405); res.end();
}

if (require.main === module) {
  refreshDatabase().then(() => {
    http.createServer(handler).listen(PORT, HOST, () => {
      console.log(`Escala rodando em http://${HOST}:${PORT}`);
      console.log('Demonstração: login admin / senha admin');
    });
  }).catch(error => { console.error(error); process.exitCode = 1; });
}

module.exports = { handler };
