const MAX_PEOPLE = 10;
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

// Small DOM builder. Text always goes in as text, never as HTML.
function el(tag, props = {}, ...kids) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'className') node.className = v;
    else node.setAttribute(k, v);
  }
  node.append(...kids);
  return node;
}

// Singapore-only app, so use OneMap's own basemap and keep the view inside the island.
const map = L.map('map', {
  minZoom: 11,
  maxBounds: [
    [1.1, 103.55],
    [1.55, 104.15],
  ],
}).setView([1.3521, 103.8198], 11);
L.tileLayer('https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png', {
  maxZoom: 19,
  attribution:
    '<a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener">OneMap</a> &copy; contributors | <a href="https://www.sla.gov.sg/" target="_blank" rel="noopener">Singapore Land Authority</a>',
}).addTo(map);
const layer = L.layerGroup().addTo(map);

// Transit graph (bus + MRT): built offline from busrouter.sg and OpenStreetMap rail data.
let graph = null;
const graphReady = Promise.all([
  fetch('data/graph.json').then((r) => r.json()),
  fetch('data/graph.bin').then((r) => r.arrayBuffer()),
]).then(([meta, buf]) => {
  graph = new Transit.Graph(meta, buf);
});
const mode = () => document.querySelector('input[name=mode]:checked').value;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const geocode = Geocode.createGeocoder({ fetch: (...args) => fetch(...args), sleep });

// Public-transport minutes over the graph. Detour = trip via the venue minus the direct work-to-home trip.
const walkDirect = (a, b) => {
  const d = Transit.distKm(a.lat, a.lng, b.lat, b.lng);
  return d < 1.2 ? Transit.walkMin(d) : Infinity;
};

function score(people) {
  const g = graph,
    M = g.meta;
  const places =
    mode() === 'malls'
      ? M.malls.filter((m) => m.access.length)
      : M.stations.map((s) => ({ ...s, access: [[s.node, 0]] }));
  const per = people.map((p) => {
    const wa = g.access(p.work.lat, p.work.lng),
      ha = g.access(p.home.lat, p.home.lng);
    if (!wa.length || !ha.length) throw Object.assign(new Error('unreachable'), { who: p.name });
    const fwd = g.search(wa, false),
      rev = g.search(ha, true);
    const direct = Math.min(g.reach(fwd, ha), walkDirect(p.work, p.home));
    if (!Number.isFinite(direct)) throw Object.assign(new Error('unreachable'), { who: p.name });
    return { fwd, rev, direct };
  });
  const out = [];
  for (const s of places) {
    const trips = [],
      detours = [];
    for (let i = 0; i < people.length; i++) {
      const q = per[i];
      const to = Math.min(g.reach(q.fwd, s.access), walkDirect(people[i].work, s));
      const from = Math.min(g.reach(q.rev, s.access), walkDirect(s, people[i].home));
      trips.push(to + from);
      detours.push(Math.max(0, to + from - q.direct));
    }
    if (!trips.every(Number.isFinite)) continue;
    const worst = Math.max(...detours);
    out.push({ s, worst, detours, trip: Math.max(...trips), gap: worst - Math.min(...detours) });
  }
  if (!out.length) throw new Error('unreachable');
  return out.sort((a, b) => a.worst - b.worst || a.trip - b.trip);
}

function personRow(i) {
  const d = document.createElement('div');
  d.className = 'person';
  d.setAttribute('role', 'group');
  const field = (
    cls,
    label,
  ) => `<label><span class="k"><i class="${cls}" aria-hidden="true"></i>${label}<span class="sr"> postal code</span></span>
        <input type="text" inputmode="numeric" maxlength="6" pattern="\\d{6}" placeholder="e.g. 238801" spellcheck="false" required></label>`;
  d.innerHTML = `<span class="badge" aria-hidden="true"></span>
    <div class="fields">${field('sq', 'Work')}${field('dot', 'Home')}</div>
    ${i > 1 ? '<button type="button" class="rm">Remove</button>' : ''}`;
  const rm = d.querySelector('.rm');
  if (rm)
    rm.onclick = () => {
      d.remove();
      renumber();
      $('add').focus();
    };
  return d;
}
function renumber() {
  const rows = [...document.querySelectorAll('#people .person')];
  rows.forEach((d, i) => {
    d.setAttribute('aria-label', `Person ${i + 1}`);
    d.querySelector('.badge').textContent = i + 1;
    const rm = d.querySelector('.rm');
    if (rm) rm.setAttribute('aria-label', `Remove person ${i + 1}`);
  });
  $('add').disabled = rows.length >= MAX_PEOPLE;
}
$('add').onclick = () => {
  $('people').append(personRow(document.querySelectorAll('#people .person').length));
  renumber();
  $('people').lastElementChild.querySelector('input').focus();
};
$('people').append(personRow(0), personRow(1));
renumber();
$('people').addEventListener('input', (e) => {
  e.target.classList.remove('bad');
  e.target.removeAttribute('aria-invalid');
});

// Fairness ramp for the non-top-5 dots: deep teal = small detour, pale = large.
const color = (t) => `hsl(172, 55%, ${38 + 34 * t}%)`;
const pin = (cls, text, size) =>
  L.divIcon({
    className: `pin ${cls}`,
    html: text,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  });
let picks = [];
const gmaps = (s) =>
  `https://www.google.com/maps/search/${encodeURIComponent('restaurants near ' + s.name + (s.station ? '' : ' MRT'))}`;

function resultPlate(r, i, maxDetour, people) {
  const bars = r.detours
    .map((d, j) => {
      const w = Math.max(3, Math.round((Math.max(d, 0) / maxDetour) * 100));
      return (
        `<li><span class="who" aria-hidden="true">${people[j].n}</span><span class="sr">${esc(people[j].name)}: </span>` +
        `<span class="bar" style="--w:${w}%"></span><span class="min">+${Math.round(d)} min</span></li>`
      );
    })
    .join('');
  return `<li class="plate${i === 0 ? ' best' : ''}" style="--i:${i}">
    <span class="rank" aria-hidden="true">${i + 1}</span>
    <div>
      <h3><button type="button" class="place" data-i="${i}">${esc(r.s.name)}</button></h3>
      ${r.s.station ? `<p class="where">Near ${esc(r.s.station)} MRT</p>` : ''}
      <ul class="detours">${bars}</ul>
      <p class="foot"><span>Longest full trip ${Math.round(r.trip)} min</span>
        <a href="${gmaps(r.s)}" target="_blank" rel="noopener">Find food nearby<span class="sr"> (opens in a new tab)</span></a></p>
    </div>
  </li>`;
}

// Selecting a result name flies the map to that place.
$('results').addEventListener('click', (e) => {
  const btn = e.target.closest('.place');
  const m = btn && picks[+btn.dataset.i];
  if (!m) return;
  const zoom = Math.max(map.getZoom(), 15);
  if (reduceMotion()) map.setView(m.getLatLng(), zoom, { animate: false });
  else map.flyTo(m.getLatLng(), zoom, { duration: 0.8 });
  m.openTooltip();
});

function setStatus(text, isError = false) {
  const node = $('status');
  node.textContent = text;
  node.classList.toggle('err', isError);
}

// ---------- Results (shared by the quick calculator and groups) ----------
// people: [{ n: number shown on the pins, name, work: {lat, lng}, home: {lat, lng} }]
let lastPeople = null;
// Advances whenever the screen changes. Async work takes a token before it awaits and
// drops its result if the token is no longer current.
const view = Groups.latest();

function clearResults() {
  view.invalidate(); // lookups still running must not draw here
  $('out').hidden = true;
  layer.clearLayers();
  picks = [];
  lastPeople = null;
}

function renderResults(people, { scroll = false } = {}) {
  lastPeople = people;
  const ranked = score(people);
  const top = ranked.slice(0, 5);
  layer.clearLayers();
  picks = [];

  // Each person's straight work-to-home line: the baseline the detours are measured against.
  people.forEach((p) =>
    L.polyline(
      [
        [p.work.lat, p.work.lng],
        [p.home.lat, p.home.lng],
      ],
      { className: 'trip-line', weight: 2, dashArray: '4 6', opacity: 0.8, interactive: false },
    ).addTo(layer),
  );

  // Other places first so the top five draw above them.
  const lo = ranked[0].worst,
    hi = ranked[Math.min(ranked.length - 1, 60)].worst;
  ranked.slice(5).forEach((r) => {
    const t = Math.min(1, (r.worst - lo) / (hi - lo || 1));
    L.circleMarker([r.s.lat, r.s.lng], {
      className: 'dot-other',
      radius: 6,
      fillColor: color(t),
      fillOpacity: 0.95,
    })
      .bindTooltip(`${esc(r.s.name)}: worst detour +${Math.round(r.worst)} min`)
      .addTo(layer);
  });
  top.forEach((r, i) => {
    picks.push(
      L.marker([r.s.lat, r.s.lng], {
        icon: pin(`pin-pick${i === 0 ? ' first' : ''}`, i + 1, 32),
        title: r.s.name,
        zIndexOffset: 1000 - i,
      })
        .bindTooltip(`${esc(r.s.name)}: worst detour +${Math.round(r.worst)} min`)
        .addTo(layer),
    );
  });
  people.forEach((p) => {
    L.marker([p.work.lat, p.work.lng], {
      icon: pin('pin-work', p.n, 24),
      title: `${p.name} work`,
    })
      .bindTooltip(`${esc(p.name)}: work`)
      .addTo(layer);
    L.marker([p.home.lat, p.home.lng], {
      icon: pin('pin-home', p.n, 24),
      title: `${p.name} home`,
    })
      .bindTooltip(`${esc(p.name)}: home`)
      .addTo(layer);
  });

  const maxDetour = Math.max(...top.flatMap((r) => r.detours), 1);
  $('results').innerHTML = top.map((r, i) => resultPlate(r, i, maxDetour, people)).join('');
  $('out').hidden = false;

  const bounds = [
    ...top.map((r) => [r.s.lat, r.s.lng]),
    ...people.flatMap((p) => [
      [p.work.lat, p.work.lng],
      [p.home.lat, p.home.lng],
    ]),
  ];
  map.fitBounds(L.latLngBounds(bounds).pad(0.15), { maxZoom: 15, animate: !reduceMotion() });
  setStatus(
    `Showing the ${top.length} fairest of ${ranked.length} ${mode() === 'malls' ? 'malls' : 'MRT stations'}.`,
  );
  if (scroll)
    $('out').scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
}

async function showResults(people, opts) {
  const token = view.token();
  try {
    await graphReady;
    if (!token.current()) return;
    renderResults(people, opts);
  } catch (err) {
    if (!token.current()) return;
    clearResults();
    if (err.message === 'unreachable') {
      setStatus(
        err.who
          ? `We couldn't find public transport near ${err.who}'s address. Try a different postal code.`
          : "We couldn't find public transport near one of those addresses. Try a different postal code.",
        true,
      );
    } else if (!graph) {
      setStatus('The transit data failed to load. Reload the page and try again.', true);
    } else {
      throw err;
    }
  }
}

// Switching Malls / MRT stations re-ranks instantly, with no new lookups.
document.querySelectorAll('input[name=mode]').forEach((r) =>
  r.addEventListener('change', () => {
    if (lastPeople) showResults(lastPeople);
  }),
);

// ---------- Forms ----------
const markBad = (inp) => {
  inp.classList.add('bad');
  inp.setAttribute('aria-invalid', 'true');
};
const clearBad = (inp) => {
  inp.classList.remove('bad');
  inp.removeAttribute('aria-invalid');
};

// Looks up one person's two postal codes once. The coordinates are saved with the entry,
// so viewing a group never calls OneMap.
async function lookupEntry({ name, work, home }) {
  [work, home].forEach(clearBad);
  const pts = await Promise.all(
    [work, home].map(async (inp) => {
      try {
        return await geocode(inp.value.trim());
      } catch (err) {
        if (err.message === 'not found') markBad(inp);
        throw err;
      }
    }),
  );
  const place = (inp, pt) => ({ postal: inp.value.trim(), lat: pt.lat, lng: pt.lng });
  return { name: name.value.trim(), work: place(work, pts[0]), home: place(home, pts[1]) };
}

// Turns any error into a short message, and outlines the field the server complained about.
function explain(err, inputs = {}) {
  if (err.message === 'not found') {
    document.querySelector('input.bad')?.focus();
    return "We couldn't find a postal code. Check the boxes outlined in red.";
  }
  if (err.field && inputs[err.field]) {
    markBad(inputs[err.field]);
    inputs[err.field].focus();
    return err.message;
  }
  if (err.status === 0) return "Couldn't reach the server. Check your connection and try again.";
  if (err.status) return err.message;
  return 'OneMap is busy right now. Please try again in a few seconds.';
}

const lookupInputs = (prefix) => ({
  name: $(`${prefix}-name`),
  work: $(`${prefix}-work`),
  home: $(`${prefix}-home`),
});

// Quick calculator: type everyone in yourself. Nothing is saved.
$('form').onsubmit = async (e) => {
  e.preventDefault();
  const go = $('go');
  go.disabled = true;
  go.textContent = 'Finding…';
  setStatus('Looking up addresses…');
  const token = view.token();
  const rows = [...document.querySelectorAll('#people .person')];
  const inputs = rows.flatMap((r) => [...r.querySelectorAll('input')]);
  inputs.forEach(clearBad);
  try {
    const pts = await Promise.all(
      inputs.map(async (inp) => {
        try {
          return await geocode(inp.value.trim());
        } catch (err) {
          if (err.message === 'not found') markBad(inp);
          throw err;
        }
      }),
    );
    if (!token.current()) return;
    const people = rows.map((_, i) => ({
      n: i + 1,
      name: `Person ${i + 1}`,
      work: pts[i * 2],
      home: pts[i * 2 + 1],
    }));
    setStatus('Working out routes…');
    await showResults(people, { scroll: true });
  } catch (err) {
    if (token.current()) setStatus(explain(err), true);
  } finally {
    go.disabled = false;
    go.textContent = 'Find where to eat';
  }
};

// ---------- Views ----------
const state = { id: null, data: null, editing: null, sig: '', timer: null };
const VIEWS = ['home', 'quick', 'group'];
function showView(name) {
  for (const v of VIEWS) $(`view-${v}`).hidden = v !== name;
}

$('quick-open').onclick = () => {
  showView('quick');
  setStatus('');
  document.querySelector('#people input')?.focus();
};
$('quick-close').onclick = () => {
  showView('home');
  clearResults();
  setStatus('');
};

const fmtDate = (iso) =>
  new Date(iso).toLocaleDateString('en-SG', { day: 'numeric', month: 'short' });

function stopPolling() {
  clearInterval(state.timer);
  state.timer = null;
}
function startPolling() {
  if (state.timer) return;
  state.timer = setInterval(() => {
    if (document.visibilityState === 'visible') loadGroup();
  }, 30000);
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.id) loadGroup();
});

function route() {
  const parsed = Groups.parseHash(location.hash);
  stopPolling();
  loads.invalidate();
  clearResults();
  state.editing = null;
  state.sig = '';
  if (!parsed) {
    state.id = null;
    state.data = null;
    showView('home');
    return;
  }
  // Keys arrive in the link. Keep them in this browser, then take them out of the address bar.
  if (parsed.memberKey)
    Groups.save(parsed.id, { memberId: parsed.memberId, memberKey: parsed.memberKey });
  if (parsed.ownerKey) Groups.save(parsed.id, { ownerKey: parsed.ownerKey });
  if (parsed.memberKey || parsed.ownerKey) {
    history.replaceState(null, '', `${location.pathname}${location.search}#g=${parsed.id}`);
  }
  state.id = parsed.id;
  state.data = null;
  showView('group');
  $('group-h').textContent = 'Loading group…';
  $('group-meta').textContent = '';
  $('members').replaceChildren();
  $('entry-form').hidden = true;
  $('join-open').hidden = true;
  $('owner-tools').hidden = true;
  setStatus('');
  loadGroup(true);
}
window.addEventListener('hashchange', route);

function groupExpired() {
  const id = state.id;
  stopPolling();
  Groups.forget(id);
  state.id = null;
  history.replaceState(null, '', location.pathname + location.search);
  clearResults();
  showView('home');
  setStatus('That group has expired or no longer exists. You can start a new one.', true);
}

// Polls, tab focus, saves and removes can all start a load. Only the newest one is rendered.
const loads = Groups.latest();
async function loadGroup(initial = false) {
  const id = state.id;
  if (!id) return;
  try {
    const { stale, value: data } = await loads.run((signal) =>
      Groups.request('GET', `/${id}`, { signal }),
    );
    if (stale || id !== state.id) return;
    renderGroup(data, initial);
    startPolling();
  } catch (err) {
    if (id !== state.id) return;
    if (err.status === 404) return groupExpired();
    setStatus(
      initial
        ? "We couldn't load this group. Check your connection and reload."
        : "Couldn't refresh just now. We'll try again shortly.",
      true,
    );
  }
}

// ---------- Group screen ----------
function renderGroup(data, initial) {
  const creds = Groups.creds(data.id);
  const me = creds.memberId ? data.members.find((m) => m.id === creds.memberId) : null;
  const owner = Boolean(creds.ownerKey);
  state.data = data;

  $('group-h').textContent = data.name;
  $('group-meta').textContent =
    `${data.members.length} of ${data.maxMembers} people. Deleted on ${fmtDate(data.expiresAt)} unless someone changes it.`;

  const list = $('members');
  list.replaceChildren(
    ...data.members.map((m) => {
      const mine = me && m.id === me.id;
      const acts = el('div', { className: 'acts' });
      if (mine) {
        const edit = el(
          'button',
          { type: 'button', className: 'act', 'aria-label': `Edit ${m.name}` },
          'Edit',
        );
        edit.onclick = () => startEntry(m);
        acts.append(edit);
      }
      if (mine || owner) {
        const rm = el(
          'button',
          { type: 'button', className: 'act', 'aria-label': `Remove ${m.name}` },
          'Remove',
        );
        rm.onclick = () => removeEntry(m, mine);
        acts.append(rm);
      }
      const nameLine = el('p', { className: 'who-line' }, el('strong', {}, m.name));
      if (mine) nameLine.append(el('span', { className: 'tag' }, 'You'));
      return el(
        'li',
        { className: 'member' },
        el('span', { className: 'badge', 'aria-hidden': 'true' }, String(m.slot)),
        el(
          'div',
          { className: 'info' },
          nameLine,
          el('p', { className: 'places' }, `Work ${m.work.postal} · Home ${m.home.postal}`),
        ),
        acts,
      );
    }),
  );

  const full = data.members.length >= data.maxMembers;
  $('join-open').hidden = Boolean(me) || full || state.editing !== null;
  if (!me && full && !state.editing) setStatus(`This group is full (${data.maxMembers} people).`);
  $('owner-tools').hidden = !owner;
  renderLinks(data.id, creds);
  if (initial && state.justCreated) {
    state.justCreated = false;
    $('links').open = true;
    setStatus(
      'Group created. Share the group link, and save your personal link to edit from another device.',
    );
  }

  // Only redo the ranking and the map when the people actually changed.
  const sig = JSON.stringify([data.members, mode()]);
  const waiting = data.members.length < 2;
  $('group-wait').hidden = !waiting;
  if (waiting) {
    clearResults();
    state.sig = '';
  } else if (sig !== state.sig) {
    state.sig = sig;
    showResults(
      data.members.map((m) => ({ n: m.slot, name: m.name, work: m.work, home: m.home })),
      { scroll: initial },
    );
  }
}

function renderLinks(id, creds) {
  const base = `${location.origin}${location.pathname}`;
  const urls = Groups.links(base, id, creds);
  const row = (label, url, note) => {
    const input = el('input', {
      type: 'text',
      className: 'txt',
      readonly: '',
      value: url,
      'aria-label': label,
    });
    input.onfocus = () => input.select();
    const copy = el('button', { type: 'button', className: 'act' }, 'Copy');
    copy.onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        copy.textContent = 'Copied';
        setTimeout(() => (copy.textContent = 'Copy'), 1500);
      } catch {
        input.focus();
      }
    };
    return el(
      'div',
      { className: 'linkrow' },
      el('span', { className: 'k' }, label),
      el('p', { className: 'note' }, note),
      el('div', { className: 'copy' }, input, copy),
    );
  };
  const rows = [
    row(
      'Group link',
      urls.group,
      'Send this to the people joining. Anyone with it can see the group.',
    ),
  ];
  if (urls.personal)
    rows.push(
      row(
        'Your personal link',
        urls.personal,
        'Keep this private. It lets you edit or remove your entry from any device.',
      ),
    );
  if (urls.owner)
    rows.push(
      row(
        'Owner link',
        urls.owner,
        'Keep this private. It lets you remove entries and delete the group.',
      ),
    );
  $('links-body').replaceChildren(...rows);
}

// ---------- Create, join, edit, remove ----------
$('create-form').onsubmit = async (e) => {
  e.preventDefault();
  const go = $('create-go');
  const groupName = $('create-group');
  const inputs = { groupName, ...lookupInputs('create') };
  go.disabled = true;
  go.textContent = 'Starting…';
  setStatus('Looking up addresses…');
  try {
    const entry = await lookupEntry(lookupInputs('create'));
    const made = await Groups.request('POST', '', {
      body: { groupName: groupName.value.trim(), ...entry },
    });
    Groups.save(made.groupId, {
      memberId: made.memberId,
      memberKey: made.memberKey,
      ownerKey: made.ownerKey,
    });
    state.justCreated = true;
    $('create-form').reset();
    location.hash = `#g=${made.groupId}`;
  } catch (err) {
    setStatus(explain(err, inputs), true);
  } finally {
    go.disabled = false;
    go.textContent = 'Start group';
  }
};

function startEntry(member = null) {
  state.editing = member ? member.id : 'new';
  const f = lookupInputs('entry');
  Object.values(f).forEach(clearBad);
  f.name.value = member ? member.name : '';
  f.work.value = member ? member.work.postal : '';
  f.home.value = member ? member.home.postal : '';
  $('entry-h').textContent = member ? 'Edit your details' : 'Add your details';
  $('entry-form').hidden = false;
  $('join-open').hidden = true;
  setStatus('');
  f.name.focus();
}
function stopEntry() {
  state.editing = null;
  $('entry-form').hidden = true;
  if (state.data) renderGroup(state.data, false);
}
$('join-open').onclick = () => startEntry();
$('entry-cancel').onclick = stopEntry;

$('entry-form').onsubmit = async (e) => {
  e.preventDefault();
  const go = $('entry-go');
  const id = state.id;
  const inputs = lookupInputs('entry');
  go.disabled = true;
  go.textContent = 'Saving…';
  setStatus('Looking up addresses…');
  try {
    const entry = await lookupEntry(inputs);
    if (state.editing === 'new') {
      const added = await Groups.request('POST', `/${id}/members`, { body: entry });
      Groups.save(id, { memberId: added.memberId, memberKey: added.memberKey });
    } else {
      const { memberKey } = Groups.creds(id);
      await Groups.request('PUT', `/${id}/members/${state.editing}`, {
        body: entry,
        key: memberKey,
      });
    }
    state.editing = null;
    $('entry-form').hidden = true;
    setStatus('Saved.');
    await loadGroup();
  } catch (err) {
    if (err.status === 404) return groupExpired();
    setStatus(explain(err, inputs), true);
  } finally {
    go.disabled = false;
    go.textContent = 'Save';
  }
};

async function removeEntry(member, mine) {
  const id = state.id;
  const who = mine ? 'your entry' : `${member.name}'s entry`;
  if (!confirm(`Remove ${who} from this group?`)) return;
  const creds = Groups.creds(id);
  try {
    await Groups.request('DELETE', `/${id}/members/${member.id}`, {
      key: mine ? creds.memberKey : creds.ownerKey,
    });
    if (mine) Groups.forget(id, 'memberId', 'memberKey');
    setStatus('Removed.');
    await loadGroup();
  } catch (err) {
    if (err.status === 404) return groupExpired();
    setStatus(explain(err), true);
  }
}

$('delete-group').onclick = async () => {
  const id = state.id;
  if (!confirm('Delete this group for everyone? This cannot be undone.')) return;
  try {
    await Groups.request('DELETE', `/${id}`, { key: Groups.creds(id).ownerKey });
    stopPolling();
    Groups.forget(id);
    state.id = null;
    clearResults();
    history.replaceState(null, '', location.pathname + location.search);
    showView('home');
    setStatus('Group deleted.');
  } catch (err) {
    if (err.status === 404) return groupExpired();
    setStatus(explain(err), true);
  }
};

route();
