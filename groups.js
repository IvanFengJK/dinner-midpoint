/* Client helpers for shareable groups: link parsing, saved keys, API calls.
   Secrets live only in the part of the URL after "#", which browsers never send to servers. */
(function (root) {
  const STORE = 'wtea:groups:v1';
  const API = '/api/groups';
  let memory = {}; // used when localStorage is blocked

  function readAll() {
    try {
      return JSON.parse(localStorage.getItem(STORE)) || memory;
    } catch {
      return memory;
    }
  }
  function writeAll(all) {
    memory = all;
    try {
      localStorage.setItem(STORE, JSON.stringify(all));
    } catch {
      /* private mode: keys last for this tab only */
    }
  }

  const KEY = /^[A-Za-z0-9_-]{22}$/;

  // "#g=<group>" is the shareable link. A personal link adds "&m=<member>.<key>"
  // and an owner link adds "&o=<key>".
  function parseHash(hash) {
    const params = new URLSearchParams(String(hash).replace(/^#/, ''));
    const id = params.get('g');
    if (!id || !KEY.test(id)) return null;
    const out = { id };
    const m = /^([A-Za-z0-9_-]{11})\.([A-Za-z0-9_-]{22})$/.exec(params.get('m') || '');
    if (m) {
      out.memberId = m[1];
      out.memberKey = m[2];
    }
    const o = params.get('o');
    if (o && KEY.test(o)) out.ownerKey = o;
    return out;
  }

  function links(base, id, creds) {
    return {
      group: `${base}#g=${id}`,
      personal: creds.memberKey ? `${base}#g=${id}&m=${creds.memberId}.${creds.memberKey}` : null,
      owner: creds.ownerKey ? `${base}#g=${id}&o=${creds.ownerKey}` : null,
    };
  }

  const creds = (id) => readAll()[id] || {};
  function save(id, patch) {
    writeAll({ ...readAll(), [id]: { ...creds(id), ...patch } });
  }
  function forget(id, ...keys) {
    const all = { ...readAll() };
    if (!keys.length) delete all[id];
    else {
      const next = { ...all[id] };
      for (const k of keys) delete next[k];
      all[id] = next;
    }
    writeAll(all);
  }

  async function request(method, path, { body, key, signal } = {}) {
    const headers = {};
    if (body !== undefined) headers['content-type'] = 'application/json';
    if (key) headers['x-key'] = key;
    let res;
    try {
      res = await fetch(API + path, {
        method,
        headers,
        body: body === undefined ? undefined : JSON.stringify(body),
        signal,
      });
    } catch {
      throw Object.assign(new Error('network'), { status: 0 });
    }
    let data = {};
    try {
      data = await res.json();
    } catch {
      /* non-JSON error page */
    }
    if (!res.ok) {
      throw Object.assign(new Error(data.error || 'Something went wrong.'), {
        status: res.status,
        field: data.field,
      });
    }
    return data;
  }

  // "Newest wins": only the most recent run() is accepted; older ones come back stale.
  function latest() {
    let seq = 0;
    let ctrl = null;
    return {
      invalidate() {
        seq++;
        ctrl?.abort();
      },
      // For code that awaits several things: take a token first, check current() after each await.
      token() {
        const mine = ++seq;
        return { current: () => mine === seq };
      },
      async run(work) {
        const mine = ++seq;
        ctrl?.abort();
        ctrl = new AbortController();
        try {
          const value = await work(ctrl.signal);
          return mine === seq ? { stale: false, value } : { stale: true };
        } catch (err) {
          if (mine === seq) throw err;
          return { stale: true };
        }
      },
    };
  }

  const api = { parseHash, links, creds, save, forget, request, latest };
  root.Groups = api;
})(typeof window !== 'undefined' ? window : globalThis);
