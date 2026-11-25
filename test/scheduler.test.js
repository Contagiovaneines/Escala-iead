const test = require('node:test');
const assert = require('node:assert/strict');
const { suggestAssignments, nextCandidate } = require('../scheduler');

const people = [
  { id: 'ana', name: 'Ana', departmentId: 'multimedia', skills: ['live', 'projector'] },
  { id: 'bia', name: 'Bia', departmentId: 'multimedia', skills: ['live'] },
  { id: 'caio', name: 'Caio', departmentId: 'multimedia', skills: ['live'] },
];
const liveTeam = people.map(person => ({ ...person, skills: ['live'] }));

test('sugestão alterna a equipe de Live com carga equilibrada', () => {
  const events = [1, 8, 15, 22].map((day, index) => ({ id: `e${index}`, date: `2026-12-${String(day).padStart(2, '0')}`, departmentId: 'multimedia', assignments: {} }));
  const result = suggestAssignments({ events, people: liveTeam });
  assert.deepEqual(result.map(event => event.assignments.live), ['ana', 'bia', 'caio', 'ana']);
});

test('sugestão pula quem já está em outra função na mesma data', () => {
  const events = [{ id: 'new', date: '2026-12-06', departmentId: 'multimedia', assignments: {} }];
  const reservedEvents = [{ id: 'other', date: '2026-12-06', departmentId: 'multimedia', assignments: { projector: 'ana' } }];
  const result = suggestAssignments({ events, people, reservedEvents });
  assert.equal(result[0].assignments.live, 'bia');
});

test('remoção escolhe a próxima pessoa elegível e disponível naquele dia', () => {
  const event = { id: 'event', date: '2026-12-06', departmentId: 'multimedia', assignments: { photo: 'photographer', live: '', projector: 'outro-projetor' } };
  const reservedEvents = [{ id: 'other', date: event.date, departmentId: 'multimedia', assignments: { live: 'bia' } }];
  const availability = [{ userId: 'caio', date: event.date, status: 'pending' }];
  const replacement = nextCandidate({ event, role: 'live', people, events: [event, ...reservedEvents], availability });
  assert.equal(replacement, 'ana');
});

test('remoção não escala a mesma pessoa que saiu da vaga', () => {
  const event = { id: 'event', date: '2026-12-06', departmentId: 'multimedia', assignments: { live: 'ana' } };
  const replacement = nextCandidate({ event, role: 'live', people: liveTeam, events: [event], excludeUserId: 'ana' });
  assert.equal(replacement, 'bia');
});

test('eventos posteriores são redistribuídos a partir das atribuições preservadas', () => {
  const reservedEvents = [{ id: 'first', date: '2026-12-06', departmentId: 'multimedia', assignments: { live: 'ana' } }];
  const future = [13, 20, 27].map((day, index) => ({ id: `future${index}`, date: `2026-12-${day}`, departmentId: 'multimedia', assignments: {} }));
  const result = suggestAssignments({ events: future, people: liveTeam, reservedEvents });
  assert.deepEqual(result.map(event => event.assignments.live), ['bia', 'caio', 'ana']);
});
