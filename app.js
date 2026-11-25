const ROLE_LABELS = { photo: 'Fotos', live: 'Live', projector: 'Projetor' };
const ROLE_ORDER = ['photo', 'live', 'projector'];
const appState = { data: null, view: 'schedule', month: '2026-12', departmentId: 'multimedia', editingEventId: null, toastTimer: null, calendarMode: 'calendar', calendarDate: null, pendingConflict: null, conflictTimer: null, conflictTarget: null };
const SERVICE_VERSES = [
  { text: 'Sirvam uns aos outros, cada um conforme o dom que recebeu.', reference: '1 Pedro 4:10' },
  { text: 'Tudo o que fizerem, façam de todo o coração.', reference: 'Colossenses 3:23' },
  { text: 'Sirvam ao Senhor com alegria.', reference: 'Salmos 100:2' },
  { text: 'Sejam sempre abundantes na obra do Senhor.', reference: '1 Coríntios 15:58' },
];

function updateServiceVerse() {
  const quote = document.getElementById('service-verse');
  const reference = document.getElementById('verse-reference');
  if (!quote || !reference) return;
  const verse = SERVICE_VERSES[Math.floor(Date.now() / 3600000) % SERVICE_VERSES.length];
  quote.textContent = `“${verse.text}”`;
  reference.textContent = verse.reference;
}

function scheduleVerseUpdate() {
  setTimeout(() => { updateServiceVerse(); scheduleVerseUpdate(); }, 3600000 - (Date.now() % 3600000) + 50);
}

function esc(value = '') { return String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]); }
function initials(name = '') { return name.trim().split(/\s+/).slice(0, 2).map(word => word[0]?.toUpperCase() || '').join(''); }
function localDate(date = new Date()) { return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 10); }
function parseDate(value) { return new Date(`${value}T12:00:00`); }
function formatDate(value, options) { return new Intl.DateTimeFormat('pt-BR', options).format(parseDate(value)); }
function fullRoleName(role) { return ROLE_LABELS[role] || role; }
function isManager() { return Boolean(appState.data?.isManager); }
function currentUser() { return appState.data?.user; }
function departmentName(id) { return appState.data?.departments.find(department => department.id === id)?.name || 'Departamento'; }
function monthLabel(value) { const [year, month] = value.split('-').map(Number); return new Intl.DateTimeFormat('pt-BR', { month: 'long', year: 'numeric' }).format(new Date(year, month - 1, 1)); }

async function api(route, options = {}) {
  const response = await fetch(route, {
    method: options.method || 'GET',
    credentials: 'same-origin',
    headers: options.body ? { 'Content-Type': 'application/json' } : undefined,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const payload = response.status === 204 ? {} : await response.json().catch(() => ({}));
  if (!response.ok) {
    if (response.status === 401 && route !== '/api/login' && route !== '/api/signup') showAuth('login');
    const error = new Error(payload.error || 'Não foi possível concluir essa ação.');
    error.status = response.status;
    throw error;
  }
  return payload;
}

function toast(message) {
  const node = document.getElementById('toast');
  node.textContent = message;
  node.classList.add('visible');
  clearTimeout(appState.toastTimer);
  appState.toastTimer = setTimeout(() => node.classList.remove('visible'), 3500);
}

function showConflictModal() {
  const conflict = appState.pendingConflict;
  if (!conflict) return;
  const dialog = document.getElementById('conflict-dialog');
  const person = conflict.personName || lookupPerson(conflict.personId)?.name || 'Essa pessoa';
  const targetEvent = appState.data.events.find(event => event.id === conflict.eventId);
  const otherEvent = appState.data.events.find(event => event.id === conflict.otherEventId);
  const targetName = targetEvent?.name || conflict.eventName || 'este evento';
  if (conflict.kind === 'availability') {
    document.getElementById('conflict-message').textContent = `${person} avisou que não pode servir em ${formatDate(conflict.date, { day: 'numeric', month: 'long' })}. Escolha outra pessoa para ${fullRoleName(conflict.role)} em ${targetName}.`;
  } else if (conflict.otherRole) {
    const otherName = otherEvent?.name || conflict.otherEventName || targetName;
    document.getElementById('conflict-message').textContent = `${person} já está em ${fullRoleName(conflict.otherRole)} no evento “${otherName}”. A escala bloqueia uma segunda função em ${formatDate(conflict.date, { day: 'numeric', month: 'long' })}.`;
  } else {
    document.getElementById('conflict-message').textContent = conflict.message || 'Há um conflito de função nesta data. Ajuste a escala para continuar.';
  }
  document.getElementById('conflict-detail').textContent = `Vaga a revisar: ${fullRoleName(conflict.role)} · ${targetName} · ${formatDate(conflict.date, { weekday: 'long', day: 'numeric', month: 'long' })}.`;
  if (!dialog.open) dialog.showModal();
}

function scheduleConflictReminder(delay = 60000) {
  clearTimeout(appState.conflictTimer);
  if (!appState.pendingConflict) return;
  appState.conflictTimer = setTimeout(() => {
    if (!appState.pendingConflict) return;
    api('/api/me').then(data => {
      if (!appState.pendingConflict) return;
      appState.data = data;
      render();
      syncConflictState();
      if (appState.pendingConflict) {
        showConflictModal();
        scheduleConflictReminder(60000);
      }
    }).catch(() => {
      if (!appState.pendingConflict) return;
      showConflictModal();
      scheduleConflictReminder(60000);
    });
  }, delay);
}

function clearConflict(showMessage = false) {
  if (!appState.pendingConflict) return;
  clearTimeout(appState.conflictTimer);
  appState.conflictTimer = null;
  appState.pendingConflict = null;
  appState.conflictTarget = null;
  localStorage.removeItem(`escala-conflict-${currentUser()?.id || 'guest'}`);
  const dialog = document.getElementById('conflict-dialog');
  if (dialog.open) dialog.close();
  if (showMessage) toast('Conflito resolvido. O alerta foi desativado.');
  if (appState.data) renderSchedule();
}

function findPersistedConflict() {
  const seen = new Map();
  for (const event of appState.data.events) for (const role of ROLE_ORDER) {
    const personId = event.assignments?.[role];
    if (!personId) continue;
    const key = `${event.departmentId}|${event.date}|${personId}`;
    const previous = seen.get(key);
    if (previous) return {
      source: 'actual', personId, personName: lookupPerson(personId)?.name, date: event.date,
      departmentId: event.departmentId, eventId: event.id, eventName: event.name, role,
      otherEventId: previous.eventId, otherEventName: previous.eventName, otherRole: previous.role,
      initialTargetPersonId: personId, initialOtherPersonId: personId,
    };
    seen.set(key, { eventId: event.id, eventName: event.name, role });
  }
  return null;
}

function beginConflict(conflict) {
  const user = currentUser();
  if (!user) return;
  appState.pendingConflict = { ...conflict, userId: user.id, createdAt: Date.now() };
  localStorage.setItem(`escala-conflict-${user.id}`, JSON.stringify(appState.pendingConflict));
  showConflictModal();
  scheduleConflictReminder(60000);
}

function beginBlockedConflict(event, role, personId, message, source = 'blocked') {
  if (!event || !personId) return;
  const other = appState.data.events.flatMap(candidate => ROLE_ORDER.map(otherRole => ({ candidate, otherRole }))).find(({ candidate, otherRole }) => candidate.departmentId === event.departmentId && candidate.date === event.date && !(candidate.id === event.id && otherRole === role) && candidate.assignments?.[otherRole] === personId);
  const person = lookupPerson(personId);
  beginConflict({
    source,
    kind: message.toLocaleLowerCase('pt-BR').includes('avisou que não pode') ? 'availability' : 'assignment',
    personId,
    personName: person?.name || 'Essa pessoa',
    date: event.date,
    departmentId: event.departmentId,
    eventId: event.id,
    eventName: event.name,
    role,
    otherEventId: other?.candidate.id || '',
    otherEventName: other?.candidate.name || '',
    otherRole: other?.otherRole || '',
    initialTargetPersonId: event.assignments?.[role] || '',
    initialOtherPersonId: other?.candidate.assignments?.[other.otherRole] || '',
    message,
  });
}

function restoreConflict() {
  const user = currentUser();
  if (!user) return;
  if (appState.pendingConflict?.userId === user.id) return;
  appState.pendingConflict = null;
  try {
    const stored = JSON.parse(localStorage.getItem(`escala-conflict-${user.id}`) || 'null');
    if (stored?.userId === user.id) appState.pendingConflict = stored;
  } catch { localStorage.removeItem(`escala-conflict-${user.id}`); }
}

function syncConflictState() {
  restoreConflict();
  const actual = isManager() ? findPersistedConflict() : null;
  let pending = appState.pendingConflict;
  if (actual && !pending) {
    beginConflict(actual);
    return;
  }
  if (!pending) return;
  if (pending.userId !== currentUser()?.id) { clearConflict(); return; }
  if (pending.source === 'actual') {
    const stillPresent = actual && actual.personId === pending.personId && actual.date === pending.date && actual.eventId === pending.eventId && actual.role === pending.role;
    if (!stillPresent) { clearConflict(true); return; }
  } else {
    const target = appState.data.events.find(event => event.id === pending.eventId);
    const other = appState.data.events.find(event => event.id === pending.otherEventId);
    const targetValue = target?.assignments?.[pending.role] || '';
    const otherValue = other?.assignments?.[pending.otherRole] || '';
    const targetChanged = target && targetValue !== (pending.initialTargetPersonId || '');
    const otherChanged = other && pending.otherRole && otherValue !== (pending.initialOtherPersonId || '');
    if (targetChanged || otherChanged) { clearConflict(true); return; }
  }
  if (!document.getElementById('conflict-dialog').open) scheduleConflictReminder(60000);
}

async function testConflict() {
  const events = eventsForMonth();
  const people = usersForDepartment();
  for (const event of events) {
    for (const existingRole of ['live', 'projector']) {
      const personId = event.assignments?.[existingRole];
      const person = people.find(entry => entry.id === personId && entry.skills.includes('live') && entry.skills.includes('projector'));
      if (!person) continue;
      const targetRole = existingRole === 'live' ? 'projector' : 'live';
      const alternative = people.find(entry => entry.id !== person.id && entry.skills.includes(targetRole) && entry.id !== event.assignments?.[targetRole] && !isAssignedOnDate(entry.id, event.date, event.departmentId) && !appState.data.availability.some(item => item.userId === entry.id && item.date === event.date && item.status === 'pending'));
      if (!alternative) continue;
      try {
        await api(`/api/events/${event.id}/assignment`, { method: 'PUT', body: { role: targetRole, personId: person.id } });
        await loadApp();
        toast('O teste encontrou uma falha no bloqueio de conflito.');
      } catch (error) {
        if (error.status === 409) beginBlockedConflict(event, targetRole, person.id, error.message, 'demo');
        else toast(error.message);
      }
      return;
    }
  }
  toast('Cadastre ou sugira a escala para testar um conflito.');
}

function closeConflictAndWait() {
  const dialog = document.getElementById('conflict-dialog');
  if (dialog.open) dialog.close();
  scheduleConflictReminder(60000);
}

function goToConflict() {
  const conflict = appState.pendingConflict;
  if (!conflict) return;
  appState.conflictTarget = { eventId: conflict.eventId, role: conflict.role };
  appState.month = conflict.date.slice(0, 7);
  appState.departmentId = conflict.departmentId;
  appState.calendarMode = isManager() ? 'list' : 'calendar';
  document.getElementById('conflict-dialog').close();
  switchView('schedule');
  requestAnimationFrame(() => {
    const target = [...document.querySelectorAll('[data-conflict-slot]')].find(element => element.dataset.conflictSlot === `${conflict.eventId}|${conflict.role}`);
    target?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  });
  scheduleConflictReminder(60000);
}

function showAuth(panel = 'login') {
  document.getElementById('auth-screen').hidden = false;
  document.getElementById('app-shell').hidden = true;
  document.getElementById('login-panel').hidden = panel !== 'login';
  document.getElementById('signup-panel').hidden = panel !== 'signup';
  document.getElementById('login-password').value = '';
  if (panel === 'signup') loadDepartmentsForSignup();
}

async function loadDepartmentsForSignup() {
  try {
    const { departments } = await api('/api/meta');
    const select = document.getElementById('signup-department');
    select.innerHTML = departments.map(department => `<option value="${esc(department.id)}">${esc(department.name)}</option>`).join('');
  } catch (error) { toast(error.message); }
}

async function loadApp() {
  const data = await api('/api/me');
  appState.data = data;
  document.getElementById('auth-screen').hidden = true;
  document.getElementById('app-shell').hidden = false;
  if (!data.isManager) appState.departmentId = data.user.departmentId;
  else if (!data.departments.some(department => department.id === appState.departmentId)) appState.departmentId = data.departments[0]?.id || 'multimedia';
  render();
  syncConflictState();
  checkBrowserReminders();
}

function roleTitle(role) { return ({ member: 'Membro', leader: 'Líder', admin: 'Administrador', ti: 'TI' })[role] || 'Membro'; }

function render() {
  if (!appState.data) return;
  const user = currentUser();
  const manager = isManager();
  const dept = departmentName(appState.departmentId);
  document.getElementById('workspace-name').textContent = manager ? dept : departmentName(user.departmentId);
  document.getElementById('breadcrumb-department').textContent = manager ? dept : departmentName(user.departmentId);
  document.getElementById('profile-name').textContent = user.name;
  document.getElementById('profile-role').textContent = roleTitle(user.role);
  document.getElementById('user-avatar').textContent = initials(user.name);
  document.getElementById('open-count').textContent = appState.data.availability.filter(item => item.status === 'pending').length;
  document.getElementById('connection-label').textContent = 'Conectado';
  document.querySelectorAll('.manager-only,.manager-controls').forEach(element => { element.style.display = manager ? '' : 'none'; });
  document.querySelectorAll('.ti-only').forEach(element => { element.style.display = appState.data.canManageRoles ? '' : 'none'; });
  document.querySelectorAll('.nav-item').forEach(button => button.classList.toggle('active', button.dataset.view === appState.view));
  document.querySelectorAll('.view-panel').forEach(panel => panel.classList.toggle('active', panel.id === `view-${appState.view}`));
  const titles = { schedule: 'Escala', team: 'Equipe', events: 'Eventos', availability: 'Indisponibilidades' };
  document.getElementById('breadcrumb-current').textContent = titles[appState.view];
  document.getElementById('schedule-title').textContent = manager ? `Escala de ${dept}` : 'Minha equipe';
  document.getElementById('schedule-subtitle').textContent = manager ? 'Revise as sugestões e confirme a escala do mês.' : 'Veja a escala publicada do seu departamento.';
  document.getElementById('schedule-eyebrow').textContent = manager ? 'GESTÃO DA EQUIPE' : 'DEPARTAMENTO MULTIMÍDIA';
  renderDepartmentPicker();
  renderSchedule();
  renderTeam();
  renderEvents();
  renderAvailability();
  renderReminders();
}

function renderDepartmentPicker() {
  const select = document.getElementById('department-select');
  select.innerHTML = appState.data.departments.map(department => `<option value="${esc(department.id)}">${esc(department.name)}</option>`).join('');
  select.value = appState.departmentId;
  select.disabled = appState.data.departments.length < 2;
  document.getElementById('month-select').value = appState.month;
}

function currentScale() {
  return appState.data.scales.find(scale => scale.departmentId === appState.departmentId && scale.month === appState.month) || { status: 'draft', responsibleUserId: '' };
}

function usersForDepartment() { return appState.data.users.filter(person => person.departmentId === appState.departmentId); }
function eventsForMonth() { return appState.data.events.filter(event => event.departmentId === appState.departmentId && event.date.startsWith(appState.month)).sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time)); }
function lookupPerson(id) { return appState.data.users.find(person => person.id === id); }

function renderSchedule() {
  const manager = isManager();
  const events = eventsForMonth();
  const tbody = document.getElementById('schedule-rows');
  const scale = currentScale();
  const openSlots = events.reduce((sum, event) => sum + ROLE_ORDER.filter(role => !event.assignments?.[role]).length, 0);
  document.getElementById('stat-events').textContent = events.length;
  document.getElementById('stat-people').textContent = usersForDepartment().filter(person => person.role !== 'admin' && person.role !== 'ti').length;
  document.getElementById('stat-open').textContent = openSlots;
  document.getElementById('balance-note').textContent = scale.status === 'published' ? 'Escala confirmada para o departamento.' : 'A sugestão distribui as funções com equilíbrio.';
  document.getElementById('scale-status').innerHTML = `<span class="status-pill ${scale.status === 'published' ? 'done' : ''}">${scale.status === 'published' ? 'PUBLICADA' : 'RASCUNHO'}</span>`;
  document.getElementById('schedule-empty').classList.toggle('visible', !events.length);
  document.getElementById('empty-add-event').style.display = manager ? '' : 'none';
  document.getElementById('list-heading').textContent = `Eventos de ${monthLabel(appState.month)}`;
  document.getElementById('list-caption').textContent = manager ? 'Ajuste os nomes; uma pessoa só ocupa uma função por data.' : 'A escala publicada do seu departamento.';
  document.getElementById('calendar-view').hidden = appState.calendarMode !== 'calendar';
  document.getElementById('schedule-list-view').hidden = appState.calendarMode !== 'list';
  document.getElementById('calendar-toggle').classList.toggle('active', appState.calendarMode === 'calendar');
  document.getElementById('list-toggle').classList.toggle('active', appState.calendarMode === 'list');
  renderResponsible();
  tbody.innerHTML = events.map(event => {
    const date = parseDate(event.date);
    const eventAssignments = ROLE_ORDER.map(role => {
      const highlighted = appState.conflictTarget?.eventId === event.id && appState.conflictTarget?.role === role;
      return `<td><div class="conflict-slot ${highlighted ? 'conflict-target' : ''}" data-conflict-slot="${esc(event.id)}|${role}">${renderAssignment(event, role)}</div></td>`;
    }).join('');
    return `<tr><td class="event-date"><div class="date-day">${String(date.getDate()).padStart(2, '0')}</div><div class="date-month">${new Intl.DateTimeFormat('pt-BR', { weekday: 'short', month: 'short' }).format(date).replace('.', '')} · ${esc(event.time)}</div></td><td class="event-name">${esc(event.name)}<span class="event-weekday">${esc(departmentName(event.departmentId))}</span></td>${eventAssignments}<td>${manager ? `<button class="row-menu" data-edit-event="${esc(event.id)}" title="Editar evento">⋯</button>` : ''}</td></tr>`;
  }).join('');
  renderCalendar(events);
  if (appState.calendarDate && document.getElementById('calendar-day-dialog').open) renderCalendarDayDetails();
  document.querySelectorAll('[data-assignment]').forEach(select => select.addEventListener('change', () => saveAssignment(select)));
  tbody.querySelectorAll('[data-edit-event]').forEach(button => button.addEventListener('click', () => openEventDialog(appState.data.events.find(event => event.id === button.dataset.editEvent))));
}

function renderAssignment(event, role) {
  const selectedId = event.assignments?.[role] || '';
  if (!isManager()) return `<span class="assignment-person ${selectedId ? '' : 'unassigned'}">${esc(lookupPerson(selectedId)?.name || (selectedId ? 'Conta removida' : 'A definir'))}</span>`;
  const candidates = usersForDepartment().filter(person => person.skills.includes(role));
  const emptyLabel = selectedId ? 'Remover e sugerir próxima pessoa' : candidates.length ? 'Sugerir próxima pessoa' : 'Sem inscrito';
  const options = [`<option value="">${candidates.length ? emptyLabel : 'Sem inscrito'}</option>`, ...candidates.map(person => {
    const conflict = isAssignedOnDate(person.id, event.date, event.departmentId, event.id, role);
    const disabled = conflict && person.id !== selectedId;
    return `<option value="${esc(person.id)}" ${person.id === selectedId ? 'selected' : ''} ${disabled ? 'disabled' : ''}>${esc(person.name)}${disabled ? ' · já escalado' : ''}</option>`;
  })];
  return `<select class="person-select ${selectedId ? 'assigned' : 'vacant'}" data-assignment="${esc(event.id)}|${role}" aria-label="${fullRoleName(role)} para ${esc(event.name)}">${options.join('')}</select>`;
}

function isAssignedOnDate(personId, date, departmentId, exceptEventId = '', exceptRole = '') {
  return appState.data.events.some(event => event.departmentId === departmentId && event.date === date && ROLE_ORDER.some(role => !(event.id === exceptEventId && role === exceptRole) && event.assignments?.[role] === personId));
}

function renderCalendar(events) {
  const [year, month] = appState.month.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const offset = (firstDay + 6) % 7;
  const days = new Date(year, month, 0).getDate();
  const count = Math.ceil((offset + days) / 7) * 7;
  const today = localDate();
  const byDate = new Map();
  for (const event of events) {
    if (!byDate.has(event.date)) byDate.set(event.date, []);
    byDate.get(event.date).push(event);
  }
  const cells = [];
  for (let index = 0; index < count; index++) {
    const day = index - offset + 1;
    const date = new Date(year, month - 1, day, 12);
    const iso = localDate(date);
    const inMonth = day >= 1 && day <= days;
    const dayEvents = inMonth ? (byDate.get(iso) || []) : [];
    const items = dayEvents.map(event => `<article class="calendar-event" data-calendar-event="${esc(event.id)}"><div class="calendar-event-heading"><strong>${esc(event.name)}</strong><time>${esc(event.time)}</time></div><div class="calendar-roles">${ROLE_ORDER.map(role => {
      const highlighted = appState.conflictTarget?.eventId === event.id && appState.conflictTarget?.role === role;
      const assigned = event.assignments?.[role] ? lookupPerson(event.assignments[role])?.name || 'Conta removida' : 'A definir';
      return `<div class="calendar-role ${highlighted ? 'conflict-target' : ''}" data-conflict-slot="${esc(event.id)}|${role}"><span class="calendar-role-name"><i class="role-dot ${role}-dot"></i>${fullRoleName(role)}</span><strong class="calendar-assignee ${event.assignments?.[role] ? '' : 'unassigned'}">${esc(assigned)}</strong></div>`;
    }).join('')}</div></article>`).join('');
    const accessibleDate = formatDate(iso, { weekday: 'long', day: 'numeric', month: 'long' });
    cells.push(`<div class="calendar-day ${inMonth ? '' : 'outside-month'} ${iso === today ? 'is-today' : ''}" data-date="${iso}"><div class="calendar-day-head"><button class="calendar-day-number" type="button" data-calendar-date="${iso}" aria-label="Abrir ${accessibleDate}${dayEvents.length ? `, ${dayEvents.length} evento${dayEvents.length === 1 ? '' : 's'}` : ''}">${date.getDate()}</button>${dayEvents.length ? `<small class="calendar-day-count">${dayEvents.length} evento${dayEvents.length === 1 ? '' : 's'}</small>` : ''}${iso === today ? '<small>Hoje</small>' : ''}</div>${items}</div>`);
  }
  document.getElementById('calendar-grid').innerHTML = cells.join('');
  document.getElementById('calendar-empty').hidden = events.length > 0;
  document.querySelectorAll('[data-calendar-date]').forEach(button => button.addEventListener('click', () => openCalendarDay(button.dataset.calendarDate)));
}

function openCalendarDay(date) {
  appState.calendarDate = date;
  renderCalendarDayDetails();
  const dialog = document.getElementById('calendar-day-dialog');
  if (!dialog.open) dialog.showModal();
}

function renderCalendarDayDetails() {
  if (!appState.calendarDate || !appState.data) return;
  const events = appState.data.events.filter(event => event.departmentId === appState.departmentId && event.date === appState.calendarDate).sort((a, b) => a.time.localeCompare(b.time) || a.name.localeCompare(b.name, 'pt-BR'));
  document.getElementById('calendar-day-title').textContent = formatDate(appState.calendarDate, { weekday: 'long', day: 'numeric', month: 'long' });
  const content = document.getElementById('calendar-day-details');
  content.innerHTML = events.length ? events.map(event => `<article class="calendar-detail-event"><div class="calendar-detail-heading"><h3>${esc(event.name)}</h3><time>${esc(event.time)}</time></div><div class="calendar-detail-roles">${ROLE_ORDER.map(role => `<div class="calendar-detail-role"><span><i class="role-dot ${role}-dot"></i>${fullRoleName(role)}</span>${renderAssignment(event, role)}</div>`).join('')}</div></article>`).join('') : '<div class="calendar-day-empty">Nenhum evento cadastrado nesta data.</div>';
  content.querySelectorAll('[data-assignment]').forEach(select => select.addEventListener('change', () => saveAssignment(select)));
}

function closeCalendarDay() {
  document.getElementById('calendar-day-dialog').close();
  appState.calendarDate = null;
}

async function saveAssignment(select) {
  const [eventId, role] = select.dataset.assignment.split('|');
  const personId = select.value;
  const previousPersonId = appState.data.events.find(event => event.id === eventId)?.assignments?.[role] || '';
  const hadConflict = Boolean(appState.pendingConflict);
  try {
    const result = await api(`/api/events/${eventId}/assignment`, { method: 'PUT', body: { role, personId } });
    await loadApp();
    if (hadConflict && !appState.pendingConflict) toast('Conflito resolvido. O alerta foi desativado.');
    else if (!personId && result.replacement) toast(`${lookupPerson(previousPersonId)?.name || 'A pessoa'} saiu; ${lookupPerson(result.replacement)?.name || 'a próxima pessoa'} assumiu.${result.rebalancedEvents ? ` ${result.rebalancedEvents} data${result.rebalancedEvents === 1 ? '' : 's'} seguinte${result.rebalancedEvents === 1 ? '' : 's'} redistribuída${result.rebalancedEvents === 1 ? '' : 's'}.` : ''}`);
    else if (!personId) toast(result.rebalancedEvents ? `Sem outra pessoa disponível para essa vaga. ${result.rebalancedEvents} data${result.rebalancedEvents === 1 ? '' : 's'} seguinte${result.rebalancedEvents === 1 ? '' : 's'} redistribuída${result.rebalancedEvents === 1 ? '' : 's'}.` : 'Sem outra pessoa disponível para essa vaga.');
    else toast(`Escala atualizada.${result.rebalancedEvents ? ` ${result.rebalancedEvents} datas seguintes redistribuídas.` : ' Não há datas seguintes neste mês.'}`);
  } catch (error) {
    if (error.status === 409) {
      const event = appState.data.events.find(item => item.id === eventId);
      beginBlockedConflict(event, role, personId, error.message);
      await loadApp().catch(() => {});
      return;
    }
    toast(error.message);
    render();
  }
}

function renderResponsible() {
  const select = document.getElementById('responsible-select');
  const scale = currentScale();
  const managers = appState.data.users.filter(person => ['ti', 'admin', 'leader'].includes(person.role));
  select.innerHTML = managers.map(person => `<option value="${esc(person.id)}">${esc(person.name)} · ${roleTitle(person.role)}</option>`).join('') || '<option value="">Sem responsável cadastrado</option>';
  select.value = managers.some(person => person.id === scale.responsibleUserId) ? scale.responsibleUserId : (managers[0]?.id || '');
  select.disabled = !managers.length;
}

function renderTeam() {
  const groups = document.getElementById('team-groups');
  if (!groups) return;
  const managers = isManager();
  const departments = managers ? appState.data.departments : appState.data.departments.filter(department => department.id === currentUser().departmentId);
  groups.innerHTML = departments.map(department => {
    const people = appState.data.users.filter(person => person.departmentId === department.id);
    return `<section class="team-group"><div class="team-group-head"><div><h2>${esc(department.name)}</h2><p>Inscritos e funções disponíveis</p></div><span class="team-count">${people.length}</span></div><div class="person-list">${people.map(person => `<div class="person-row"><span class="person-avatar ${person.skills.includes('photo') ? '' : 'tech'}">${esc(initials(person.name))}</span><span class="person-name">${esc(person.name)}<small class="person-subline">${esc(person.phone || 'Membro da equipe')}</small></span><span class="team-skills">${person.skills.map(skill => `<i class="mini-role ${skill}-role">${esc(fullRoleName(skill))}</i>`).join('')}</span>${managers ? `<label class="role-label">${appState.data.canManageRoles ? `<select class="role-editor" data-user-role="${esc(person.id)}" aria-label="Nível de acesso de ${esc(person.name)}"><option value="member" ${person.role === 'member' ? 'selected' : ''}>Membro</option><option value="leader" ${person.role === 'leader' ? 'selected' : ''}>Líder</option><option value="admin" ${person.role === 'admin' ? 'selected' : ''}>Administrador</option>${person.role === 'ti' ? '<option value="ti" selected>TI</option>' : ''}</select>` : `<span class="role-readonly">${roleTitle(person.role)}</span>`}</label>` : ''}</div>`).join('') || '<div class="team-placeholder">Nenhum membro inscrito.</div>'}</div></section>`;
  }).join('');
  document.getElementById('team-empty').classList.toggle('visible', appState.data.users.length === 0);
  groups.querySelectorAll('[data-user-role]').forEach(select => select.addEventListener('change', async () => {
    try { await api(`/api/users/${select.dataset.userRole}/role`, { method: 'PATCH', body: { role: select.value } }); await loadApp(); toast('Nível de acesso atualizado.'); }
    catch (error) { toast(error.message); render(); }
  }));
}

function renderEvents() {
  const list = document.getElementById('event-list');
  if (!list) return;
  const events = appState.data.events.filter(event => isManager() || event.departmentId === currentUser().departmentId).sort((a, b) => a.date.localeCompare(b.date));
  list.innerHTML = events.map(event => `<article class="event-row"><div class="event-date-badge"><strong>${String(parseDate(event.date).getDate()).padStart(2, '0')}</strong><small>${formatDate(event.date, { month: 'short' }).replace('.', '')}</small></div><div class="event-row-copy"><strong>${esc(event.name)}</strong><small>${formatDate(event.date, { weekday: 'long', year: 'numeric', month: 'long' })} · ${esc(event.time)} · ${esc(departmentName(event.departmentId))}</small></div><div class="event-row-actions">${isManager() ? `<button class="small-action" data-edit-event="${esc(event.id)}">Editar</button><button class="small-action danger" data-delete-event="${esc(event.id)}">Excluir</button>` : ''}</div></article>`).join('');
  document.getElementById('event-empty').classList.toggle('visible', !events.length);
  list.querySelectorAll('[data-edit-event]').forEach(button => button.addEventListener('click', () => openEventDialog(appState.data.events.find(event => event.id === button.dataset.editEvent))));
  list.querySelectorAll('[data-delete-event]').forEach(button => button.addEventListener('click', () => deleteEvent(button.dataset.deleteEvent)));
}

function renderAvailability() {
  const board = document.getElementById('availability-board');
  const requests = [...appState.data.availability].sort((a, b) => a.date.localeCompare(b.date));
  board.innerHTML = requests.map(item => `<article class="availability-row"><span class="person-avatar">${esc(initials(item.user.name))}</span><div class="availability-info"><strong>${esc(item.user.name)} · ${esc(departmentName(item.user.departmentId))}</strong><small>${formatDate(item.date, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</small>${item.note ? `<div class="availability-note">${esc(item.note)}</div>` : ''}</div><span class="status-pill ${item.status === 'resolved' ? 'done' : ''}">${item.status === 'resolved' ? 'Resolvido' : 'Pendente'}</span>${isManager() && item.status === 'pending' ? `<button class="small-action" data-resolve="${esc(item.id)}">Marcar resolvido</button>` : ''}</article>`).join('');
  document.getElementById('availability-empty').classList.toggle('visible', !requests.length);
  document.getElementById('availability-board').querySelectorAll('[data-resolve]').forEach(button => button.addEventListener('click', async () => {
    try { await api(`/api/availability/${button.dataset.resolve}`, { method: 'PATCH' }); await loadApp(); toast('Aviso resolvido. Confira a escala se havia uma vaga ocupada.'); }
    catch (error) { toast(error.message); }
  }));
  const pending = requests.filter(item => item.status === 'pending').slice(0, 3);
  document.getElementById('availability-preview').innerHTML = pending.length ? pending.map(item => `<div class="availability-mini"><span class="mini-avatar">${esc(initials(item.user.name))}</span><div><strong>${esc(item.user.name)}</strong><small>${formatDate(item.date, { day: 'numeric', month: 'short' })} · precisa de ajuste</small></div></div>`).join('') : '<div class="availability-none">Nenhum aviso pendente.</div>';
}

function nextDay(date, wantedDay) {
  const copy = new Date(date);
  const distance = (wantedDay - copy.getDay() + 7) % 7;
  if (distance === 0) return copy;
  copy.setDate(copy.getDate() + distance);
  return copy;
}

function renderReminders() {
  const list = document.getElementById('reminder-list');
  const user = currentUser();
  const today = parseDate(localDate());
  const monday = nextDay(today, 1);
  const friday = nextDay(today, 5);
  const sundayCutoff = new Date(monday); sundayCutoff.setDate(monday.getDate() + 6);
  const weekendCutoff = new Date(friday); weekendCutoff.setDate(friday.getDate() + 2);
  const events = appState.data.events.filter(event => {
    if (!event.date || parseDate(event.date) < today) return false;
    const assignedToUser = ROLE_ORDER.some(role => event.assignments?.[role] === user.id);
    return isManager() ? ROLE_ORDER.some(role => event.assignments?.[role]) : assignedToUser;
  });
  const reminders = [];
  for (const event of events) {
    const date = parseDate(event.date);
    const assignment = ROLE_ORDER.find(role => event.assignments?.[role] === user.id);
    const description = isManager() ? `${event.name} · ${departmentName(event.departmentId)}` : `Você está em ${fullRoleName(assignment)} · ${event.name}`;
    if (date.getDay() === 0 && date >= monday && date <= sundayCutoff) reminders.push({ label: 'Aviso de segunda', event, description });
    if ((date.getDay() === 6 || date.getDay() === 0) && date >= friday && date <= weekendCutoff) reminders.push({ label: 'Aviso de sexta', event, description });
  }
  list.innerHTML = reminders.length ? reminders.slice(0, 5).map(item => `<div class="reminder-item"><strong>${item.label}</strong><small>${esc(item.description)} · ${formatDate(item.event.date, { weekday: 'short', day: 'numeric', month: 'short' })}</small></div>`).join('') : '<div class="reminder-empty">Nenhum lembrete nos próximos dias. Se o app estiver aberto na segunda ou na sexta, o navegador avisa.</div>';
}

function switchView(view) {
  appState.view = view;
  render();
  document.getElementById('sidebar').classList.remove('open');
}

function openEventDialog(event = null) {
  if (!isManager()) return;
  appState.editingEventId = event?.id || null;
  const form = document.getElementById('event-form');
  document.getElementById('event-dialog-title').textContent = event ? 'Editar evento' : 'Novo evento';
  document.getElementById('event-name').value = event?.name || '';
  document.getElementById('event-date').value = event?.date || `${appState.month}-01`;
  document.getElementById('event-time').value = event?.time || '18:30';
  const department = document.getElementById('event-department');
  department.innerHTML = appState.data.departments.map(item => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join('');
  department.value = event?.departmentId || appState.departmentId;
  document.getElementById('save-event').textContent = event ? 'Salvar alterações' : 'Cadastrar evento';
  document.getElementById('event-dialog').showModal();
}

function openAvailabilityDialog() {
  const people = appState.data.users.filter(person => person.departmentId === currentUser().departmentId);
  const select = document.getElementById('unavailable-person');
  select.innerHTML = people.map(person => `<option value="${esc(person.id)}">${esc(person.name)}</option>`).join('');
  select.value = currentUser().id;
  select.disabled = true;
  const dateInput = document.getElementById('unavailable-date');
  dateInput.min = localDate();
  dateInput.value = '';
  document.getElementById('unavailable-note').value = '';
  document.getElementById('unavailable-dialog').showModal();
}

async function deleteEvent(id) {
  const event = appState.data.events.find(item => item.id === id);
  if (!event || !confirm(`Excluir “${event.name}” e as atribuições desse evento?`)) return;
  try { await api(`/api/events/${id}`, { method: 'DELETE' }); await loadApp(); toast('Evento excluído.'); }
  catch (error) { toast(error.message); }
}

function openSundays() {
  const [year, month] = appState.month.split('-').map(Number);
  const events = [];
  for (let day = 1; day <= new Date(year, month, 0).getDate(); day++) {
    const date = new Date(year, month - 1, day, 12);
    const iso = localDate(date);
    if (date.getDay() === 0 && !appState.data.events.some(event => event.departmentId === appState.departmentId && event.date === iso && /culto|natal/i.test(event.name))) events.push(iso);
  }
  if (!events.length) { toast('Os cultos de domingo deste mês já estão cadastrados.'); return; }
  const create = async () => {
    for (const date of events) await api('/api/events', { method: 'POST', body: { name: 'Culto de domingo', date, time: '18:30', departmentId: appState.departmentId } });
    await loadApp();
    toast(`${events.length} culto${events.length === 1 ? '' : 's'} de domingo cadastrado${events.length === 1 ? '' : 's'}.`);
  };
  create().catch(error => toast(error.message));
}

async function suggestScale() {
  const hasAssignments = eventsForMonth().some(event => ROLE_ORDER.some(role => event.assignments?.[role]));
  if (hasAssignments && !confirm('Gerar uma nova sugestão vai substituir os nomes atuais deste mês. Deseja continuar?')) return;
  try {
    const result = await api(`/api/scales/${appState.month}/${appState.departmentId}/suggest`, { method: 'POST' });
    await loadApp();
    toast(`${result.assigned} vaga${result.assigned === 1 ? '' : 's'} sugerida${result.assigned === 1 ? '' : 's'}${result.open ? ` · ${result.open} sem pessoa habilitada ou disponível` : ''}.`);
  } catch (error) { toast(error.message); }
}

async function publishScale() {
  if (!confirm(`Publicar a escala de ${monthLabel(appState.month)} para ${departmentName(appState.departmentId)}?`)) return;
  try { await api(`/api/scales/${appState.month}/${appState.departmentId}/publish`, { method: 'POST' }); await loadApp(); toast('Escala publicada. Os membros do departamento já podem ver.'); }
  catch (error) { toast(error.message); }
}

async function updateResponsible(userId) {
  if (!userId) return;
  try { await api(`/api/scales/${appState.month}/${appState.departmentId}/responsible`, { method: 'PUT', body: { userId } }); await loadApp(); toast('Responsável atualizado.'); }
  catch (error) { toast(error.message); }
}

function checkBrowserReminders() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  const day = new Date().getDay();
  if (day !== 1 && day !== 5) return;
  const user = currentUser();
  const dateKey = localDate();
  const storageKey = `escala-alerta-${user.id}-${dateKey}`;
  if (localStorage.getItem(storageKey)) return;
  const today = parseDate(dateKey);
  const end = new Date(today); end.setDate(today.getDate() + (day === 1 ? 6 : 2));
  const events = appState.data.events.filter(event => {
    const date = parseDate(event.date);
    if (date < today || date > end) return false;
    const scheduled = ROLE_ORDER.some(role => event.assignments?.[role] === user.id);
    return day === 1 ? date.getDay() === 0 && (isManager() ? ROLE_ORDER.some(role => event.assignments?.[role]) : scheduled) : (date.getDay() === 6 || date.getDay() === 0) && (isManager() ? ROLE_ORDER.some(role => event.assignments?.[role]) : scheduled);
  });
  if (!events.length) return;
  const body = events.slice(0, 3).map(event => `${formatDate(event.date, { day: 'numeric', month: 'short' })} · ${event.name}`).join('\n');
  new Notification(day === 1 ? 'Sua escala do próximo domingo' : 'Sua escala deste fim de semana', { body });
  localStorage.setItem(storageKey, 'sent');
}

document.getElementById('login-form').addEventListener('submit', async event => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try {
    await api('/api/login', { method: 'POST', body: { username: document.getElementById('login-username').value, password: document.getElementById('login-password').value } });
    await loadApp();
  } catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

document.getElementById('signup-form').addEventListener('submit', async event => {
  event.preventDefault();
  const skills = [...event.currentTarget.querySelectorAll('input[name="skills"]:checked')].map(input => input.value);
  const body = { name: document.getElementById('signup-name').value, phone: document.getElementById('signup-phone').value, departmentId: document.getElementById('signup-department').value, username: document.getElementById('signup-username').value, password: document.getElementById('signup-password').value, skills };
  const button = event.currentTarget.querySelector('[type="submit"]');
  button.disabled = true;
  try { await api('/api/signup', { method: 'POST', body }); await loadApp(); toast('Conta criada como membro.'); }
  catch (error) { toast(error.message); }
  finally { button.disabled = false; }
});

document.getElementById('open-signup').addEventListener('click', () => showAuth('signup'));
document.getElementById('open-login').addEventListener('click', () => showAuth('login'));
document.getElementById('fill-demo').addEventListener('click', () => { document.getElementById('login-username').value = 'admin'; document.getElementById('login-password').value = 'admin'; });
document.getElementById('fill-member-demo').addEventListener('click', () => { document.getElementById('login-username').value = 'user'; document.getElementById('login-password').value = 'user'; });
document.querySelectorAll('.nav-item').forEach(button => button.addEventListener('click', () => switchView(button.dataset.view)));
document.querySelectorAll('[data-open-view]').forEach(button => button.addEventListener('click', () => switchView(button.dataset.openView)));
document.getElementById('logout-button').addEventListener('click', async () => { clearTimeout(appState.conflictTimer); appState.conflictTimer = null; appState.pendingConflict = null; try { await api('/api/logout', { method: 'POST' }); } catch {} appState.data = null; showAuth('login'); });
document.getElementById('mobile-menu').addEventListener('click', () => document.getElementById('sidebar').classList.toggle('open'));
document.getElementById('help-button').addEventListener('click', () => document.getElementById('help-dialog').showModal());
document.getElementById('calendar-day-close').addEventListener('click', closeCalendarDay);
document.getElementById('calendar-day-dialog').addEventListener('close', () => { appState.calendarDate = null; });
document.getElementById('calendar-toggle').addEventListener('click', () => { appState.calendarMode = 'calendar'; renderSchedule(); });
document.getElementById('list-toggle').addEventListener('click', () => { appState.calendarMode = 'list'; renderSchedule(); });
document.getElementById('test-conflict-button').addEventListener('click', testConflict);
document.getElementById('conflict-ok').addEventListener('click', closeConflictAndWait);
document.getElementById('conflict-go').addEventListener('click', goToConflict);
document.getElementById('conflict-dialog').addEventListener('cancel', event => { event.preventDefault(); closeConflictAndWait(); });
document.getElementById('add-event-shortcut').addEventListener('click', () => openEventDialog());
document.getElementById('add-event-button').addEventListener('click', () => openEventDialog());
document.getElementById('empty-add-event').addEventListener('click', () => openEventDialog());
document.getElementById('event-add-empty').addEventListener('click', () => openEventDialog());
document.getElementById('add-sundays-button').addEventListener('click', openSundays);
document.getElementById('suggest-button').addEventListener('click', suggestScale);
document.getElementById('publish-button').addEventListener('click', publishScale);
document.getElementById('report-unavailable').addEventListener('click', openAvailabilityDialog);
document.getElementById('availability-add-empty').addEventListener('click', openAvailabilityDialog);
document.getElementById('month-select').addEventListener('change', event => { if (event.target.value) { appState.month = event.target.value; render(); } });
document.getElementById('department-select').addEventListener('change', event => { appState.departmentId = event.target.value; render(); });
document.getElementById('responsible-select').addEventListener('change', event => updateResponsible(event.target.value));
document.getElementById('prev-month').addEventListener('click', () => { const [year, month] = appState.month.split('-').map(Number); appState.month = `${new Date(year, month - 2, 1).getFullYear()}-${String(new Date(year, month - 2, 1).getMonth() + 1).padStart(2, '0')}`; render(); });
document.getElementById('next-month').addEventListener('click', () => { const [year, month] = appState.month.split('-').map(Number); appState.month = `${new Date(year, month, 1).getFullYear()}-${String(new Date(year, month, 1).getMonth() + 1).padStart(2, '0')}`; render(); });
document.querySelectorAll('[data-close-dialog]').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.closeDialog).close()));

document.getElementById('event-form').addEventListener('submit', async event => {
  event.preventDefault();
  const body = { name: document.getElementById('event-name').value.trim(), date: document.getElementById('event-date').value, time: document.getElementById('event-time').value, departmentId: document.getElementById('event-department').value };
  const editing = appState.editingEventId;
  try {
    if (editing) await api(`/api/events/${editing}`, { method: 'PUT', body });
    else await api('/api/events', { method: 'POST', body });
    document.getElementById('event-dialog').close();
    await loadApp();
    switchView('schedule');
    toast(editing ? 'Evento atualizado.' : 'Evento cadastrado.');
  } catch (error) { toast(error.message); }
});

document.getElementById('unavailable-form').addEventListener('submit', async event => {
  event.preventDefault();
  const body = { date: document.getElementById('unavailable-date').value, note: document.getElementById('unavailable-note').value.trim() };
  try {
    await api('/api/availability', { method: 'POST', body });
    document.getElementById('unavailable-dialog').close();
    await loadApp();
    switchView('availability');
    toast('Aviso enviado para a liderança do departamento.');
  } catch (error) { toast(error.message); }
});

document.getElementById('enable-notifications').addEventListener('click', async () => {
  if (!('Notification' in window)) { toast('Este navegador não oferece notificações.'); return; }
  const permission = await Notification.requestPermission();
  if (permission === 'granted') { checkBrowserReminders(); toast('Alertas ativados enquanto o app estiver aberto.'); }
  else toast('Permissão de notificação não concedida.');
});

document.querySelectorAll('input[name="skills"]').forEach(input => input.addEventListener('change', () => {
  const photo = document.querySelector('input[name="skills"][value="photo"]');
  const technical = [...document.querySelectorAll('input[name="skills"][value="live"],input[name="skills"][value="projector"]')];
  if (input.value === 'photo' && input.checked) technical.forEach(option => { option.checked = false; });
  if ((input.value === 'live' || input.value === 'projector') && input.checked) photo.checked = false;
}));

updateServiceVerse();
scheduleVerseUpdate();

loadApp().catch(error => {
  if (error.status === 401) showAuth('login');
  else { showAuth('login'); toast('Não foi possível conectar ao servidor. Inicie o app com node server.js.'); }
});

setInterval(() => {
  if (!document.getElementById('app-shell').hidden) loadApp().catch(() => {});
}, 60000);
