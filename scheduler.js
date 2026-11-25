const ROLES = ['photo', 'live', 'projector'];

function orderedPeople(people, role, departmentId) {
  return people
    .filter(person => person.departmentId === departmentId && person.skills.includes(role))
    .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
}

function suggestAssignments({ events, people, availability = [], reservedEvents = [], excludeUserIds = [] }) {
  const counts = new Map(people.map(person => [person.id, 0]));
  const roleCounts = new Map(people.map(person => [person.id, Object.fromEntries(ROLES.map(role => [role, 0]))]));
  const occupiedByDate = new Map();

  for (const event of [...reservedEvents].sort(compareEvents)) {
    for (const [role, personId] of Object.entries(event.assignments || {})) {
      if (!ROLES.includes(role) || !personId) continue;
      counts.set(personId, (counts.get(personId) || 0) + 1);
      if (roleCounts.has(personId)) roleCounts.get(personId)[role]++;
      if (!occupiedByDate.has(`${event.departmentId}|${event.date}`)) occupiedByDate.set(`${event.departmentId}|${event.date}`, new Set());
      occupiedByDate.get(`${event.departmentId}|${event.date}`).add(personId);
    }
  }

  const cursors = new Map(ROLES.map(role => [role, 0]));
  return [...events].sort(compareEvents).map(source => {
    const event = { ...source, assignments: {} };
    const dateKey = `${event.departmentId}|${event.date}`;
    if (!occupiedByDate.has(dateKey)) occupiedByDate.set(dateKey, new Set());
    const occupied = occupiedByDate.get(dateKey);

    for (const role of ROLES) {
      const roster = orderedPeople(people, role, event.departmentId);
      const cursor = roster.length ? cursors.get(role) % roster.length : 0;
      const unavailableIds = new Set(availability.filter(item => item.status === 'pending' && item.date === event.date).map(item => item.userId));
      const candidates = roster.filter(person => !occupied.has(person.id) && !unavailableIds.has(person.id) && !excludeUserIds.includes(person.id));
      candidates.sort((a, b) => counts.get(a.id) - counts.get(b.id)
        || roleCounts.get(a.id)[role] - roleCounts.get(b.id)[role]
        || circularDistance(roster.findIndex(person => person.id === a.id), cursor, roster.length)
          - circularDistance(roster.findIndex(person => person.id === b.id), cursor, roster.length));
      const selected = candidates[0];
      if (!selected) continue;
      event.assignments[role] = selected.id;
      counts.set(selected.id, counts.get(selected.id) + 1);
      roleCounts.get(selected.id)[role]++;
      occupied.add(selected.id);
      cursors.set(role, (roster.findIndex(person => person.id === selected.id) + 1) % roster.length);
    }
    return event;
  });
}

function nextCandidate({ event, role, people, events, availability = [], excludeUserId = '' }) {
  const target = { ...event, assignments: { ...(event.assignments || {}), [role]: '' } };
  const reserved = events.filter(other => other.departmentId === event.departmentId && other.date <= event.date && other.id !== event.id);
  reserved.push(target);
  return suggestAssignments({ events: [target], people, availability, reservedEvents: reserved, excludeUserIds: [excludeUserId] })[0]?.assignments?.[role] || '';
}

function circularDistance(position, cursor, length) {
  return length ? (position - cursor + length) % length : 0;
}

function compareEvents(a, b) {
  return a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')) || String(a.name || '').localeCompare(String(b.name || ''), 'pt-BR') || a.id.localeCompare(b.id);
}

module.exports = { suggestAssignments, nextCandidate };
