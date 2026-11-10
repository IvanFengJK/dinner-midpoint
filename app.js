const MAX_PEOPLE = 6;
const ONEMAP = 'https://www.onemap.gov.sg/api/common/elastic/search';
const $ = (id) => document.getElementById(id);
const esc = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
  );
const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;

const map = L.map('map').setView([1.3521, 103.8198], 11);
L.tileLayer('https://tile.openstreetmap.org/{z}/{x}/{y}.png', {
  maxZoom: 18,
  attribution: '&copy; OpenStreetMap contributors',
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

const geoCache = new Map();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Limit parallel lookups: OneMap answers 429 when calls arrive in a burst.
let active = 0;
const waiting = [];
async function limited(fn) {
  if (active >= 2) await new Promise((r) => waiting.push(r));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    (waiting.shift() || (() => {}))();
  }
}

async function fetchOnce(postal) {
  const res = await fetch(`${ONEMAP}?searchVal=${postal}&returnGeom=Y&getAddrDetails=Y&pageNum=1`);
  if (!res.ok) throw new Error('busy');
  let data;
  try {
    data = await res.json();
  } catch {
    throw new Error('busy');
  }
  if (!Array.isArray(data.results)) throw new Error('busy');
  return data.results[0];
}

async function geocode(postal) {
  if (geoCache.has(postal)) return geoCache.get(postal);
  return limited(async () => {
    let hit, err;
    for (let n = 0; n < 4; n++) {
      try {
        hit = await fetchOnce(postal);
        err = null;
        break;
      } catch (e) {
        err = e;
        await sleep(300 * 2 ** n);
      }
    }
    if (err) throw err;
    if (!hit) throw new Error('not found');
    const pt = { lat: +hit.LATITUDE, lng: +hit.LONGITUDE, label: hit.SEARCHVAL };
    geoCache.set(postal, pt);
    return pt;
  });
}

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
    if (!wa.length || !ha.length) throw new Error('unreachable');
    const fwd = g.search(wa, false),
      rev = g.search(ha, true);
    const direct = Math.min(g.reach(fwd, ha), walkDirect(p.work, p.home));
    if (!Number.isFinite(direct)) throw new Error('unreachable');
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
  const rows = [...document.querySelectorAll('.person')];
  rows.forEach((d, i) => {
    d.setAttribute('aria-label', `Person ${i + 1}`);
    d.querySelector('.badge').textContent = i + 1;
    const rm = d.querySelector('.rm');
    if (rm) rm.setAttribute('aria-label', `Remove person ${i + 1}`);
  });
  $('add').disabled = rows.length >= MAX_PEOPLE;
}
$('add').onclick = () => {
  $('people').append(personRow(document.querySelectorAll('.person').length));
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

function resultPlate(r, i, maxDetour) {
  const bars = r.detours
    .map((d, j) => {
      const w = Math.max(3, Math.round((Math.max(d, 0) / maxDetour) * 100));
      return (
        `<li><span class="who" aria-hidden="true">${j + 1}</span><span class="sr">Person ${j + 1}: </span>` +
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
  const el = $('status');
  el.textContent = text;
  el.classList.toggle('err', isError);
}

$('form').onsubmit = async (e) => {
  e.preventDefault();
  const go = $('go');
  go.disabled = true;
  go.textContent = 'Finding…';
  setStatus('Looking up addresses…');
  const rows = [...document.querySelectorAll('.person')];
  const inputs = rows.flatMap((r) => [...r.querySelectorAll('input')]);
  inputs.forEach((i) => {
    i.classList.remove('bad');
    i.removeAttribute('aria-invalid');
  });
  try {
    const pts = await Promise.all(
      inputs.map(async (inp) => {
        try {
          return await geocode(inp.value.trim());
        } catch (err) {
          if (err.message === 'not found') {
            inp.classList.add('bad');
            inp.setAttribute('aria-invalid', 'true');
          }
          throw err;
        }
      }),
    );
    const people = rows.map((_, i) => ({ work: pts[i * 2], home: pts[i * 2 + 1] }));
    setStatus('Working out routes…');
    await graphReady;
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
    people.forEach((p, i) => {
      L.marker([p.work.lat, p.work.lng], {
        icon: pin('pin-work', i + 1, 24),
        title: `Person ${i + 1} work`,
      })
        .bindTooltip(`Person ${i + 1}: work`)
        .addTo(layer);
      L.marker([p.home.lat, p.home.lng], {
        icon: pin('pin-home', i + 1, 24),
        title: `Person ${i + 1} home`,
      })
        .bindTooltip(`Person ${i + 1}: home`)
        .addTo(layer);
    });

    const maxDetour = Math.max(...top.flatMap((r) => r.detours), 1);
    $('results').innerHTML = top.map((r, i) => resultPlate(r, i, maxDetour)).join('');
    $('out').hidden = false;

    const pts2 = [
      ...top.map((r) => [r.s.lat, r.s.lng]),
      ...people.flatMap((p) => [
        [p.work.lat, p.work.lng],
        [p.home.lat, p.home.lng],
      ]),
    ];
    map.fitBounds(L.latLngBounds(pts2).pad(0.15), { maxZoom: 15, animate: !reduceMotion() });
    setStatus(
      `Showing the ${top.length} fairest of ${ranked.length} ${mode() === 'malls' ? 'malls' : 'MRT stations'}.`,
    );
    $('out').scrollIntoView({ block: 'start', behavior: reduceMotion() ? 'auto' : 'smooth' });
  } catch (err) {
    if (err.message === 'not found') {
      setStatus("We couldn't find a postal code. Check the boxes outlined in red.", true);
      document.querySelector('input.bad')?.focus();
    } else if (err.message === 'unreachable') {
      setStatus(
        "We couldn't find public transport near one of those addresses. Try a different postal code.",
        true,
      );
    } else if (!graph) {
      setStatus('The transit data failed to load. Reload the page and try again.', true);
    } else {
      setStatus('OneMap is busy right now. Please try again in a few seconds.', true);
    }
  } finally {
    go.disabled = false;
    go.textContent = 'Find where to eat';
  }
};
