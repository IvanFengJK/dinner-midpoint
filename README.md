# Where To Eat Ah?

Finds the places (malls or MRT stations) that are fairest for a group to reach for dinner by
public transport. Fair means the smallest worst-case detour: each person's extra travel time
compared with going straight from work to home.

Two ways to use it:

- **Groups.** One person starts a group and shares the link. Each person adds their own name,
  work and home postal code, and can edit or remove only their own entry. Up to 10 people. Groups
  delete themselves 7 days after the last change.
- **Quick calculator.** Type everyone in yourself. Nothing is saved.

## Versions

- **v1.0.0** is the static page: type everyone in yourself, nothing is saved. It stays live on
  GitHub Pages at https://ivanfengjk.github.io/dinner-midpoint/ and is frozen. The Pages workflow
  only runs by hand and always builds from the `v1.0.0` tag.
- **v2.x** adds shareable groups and is hosted on Vercel. Every push to `main` deploys to
  production there.

## How it works

- The page (`index.html`, `app.js`) is plain HTML, CSS and JavaScript. No framework, no bundler.
- Travel times come from a transit graph (`data/graph.bin`, `data/graph.json`) built offline from
  bus routes and MRT lines. The search runs in the browser (`transit.js`). Against OneMap's own
  routes it is typically off by about 5 minutes.
- Postal codes are looked up in the browser with OneMap's public search. Each person's browser does
  this once, when they save, and the coordinates are stored with the entry.
- The API (`api/`, `server/`) is a few Vercel Functions on Node.js. It stores groups and members in
  Postgres (Neon). It never computes anything: it only stores and returns entries.

### Access, with no accounts

| Link                                     | Carries                   | Lets you                           |
| ---------------------------------------- | ------------------------- | ---------------------------------- |
| Group link `#g=<id>`                     | a random 128-bit group id | see the group and add yourself     |
| Personal link `#g=<id>&m=<member>.<key>` | your edit key             | edit or remove your own entry      |
| Owner link `#g=<id>&o=<key>`             | the owner key             | remove any entry, delete the group |

The keys sit after the `#`, which browsers never send to servers or in referrer headers. Only
SHA-256 hashes of the keys are stored. Anyone holding a group link can see every name and postal
code in that group, so the page says so.

## Run it locally

```sh
npm ci
npm run dev      # http://localhost:8765, with an in-memory database (lost on restart)
npm test         # API tests run the real SQL against in-memory Postgres
npx playwright install chromium   # once, for the browser tests
npm run e2e      # browser tests: the real page and API on port 8804, no network needed
npm run lint && npm run format:check
```

`npm run e2e` starts its own dev server (`PORT`, default 8804) and answers OneMap's search and map
tiles, and Leaflet's CDN files, from fixtures, so it never touches the network. It cannot catch quirks
of real devices.

When you run `npm run dev` yourself, the postal-code lookup still calls OneMap, so you need a network connection. OneMap
rate-limits bursts. The page retries with a short back-off, and says so if it gives up.

## Deploy on Vercel

These steps need your accounts, so they are done by hand:

1. **Import the repo** at vercel.com/new. Leave the root directory as the repo root.
   `vercel.json` already sets the install and build commands, the output folder (`_site`), the
   Singapore region (`sin1`) and the daily clean-up cron.
2. **Add a database.** In the project, open Storage and add **Neon** from the Marketplace. Pick the
   Singapore region (AWS ap-southeast-1) to keep it close to the functions. This sets
   `DATABASE_URL` for you. The tables are created on first use.
3. **Add a cron secret.** In Settings, Environment Variables, add `CRON_SECRET` with a long random
   value (for example `openssl rand -hex 32`). Vercel sends it with the nightly clean-up call, and
   the clean-up refuses requests without it.
4. **Deploy.** Push the branch. Every branch gets its own preview URL.

Expired groups are never shown, even before the nightly clean-up removes them.

### What to check after deploying

- Start a group, open the group link in a private window, and join as a second person.
- Open the browser console. The site sends a strict Content Security Policy (see `vercel.json`).
  If you add a new external script, style, image or API host, add it there too.
- The nightly job: Settings, Cron Jobs, then run it once and check it returns `200`.

## Files

| Path                                                           | What it is                                                      |
| -------------------------------------------------------------- | --------------------------------------------------------------- |
| `index.html`, `app.js`, `groups.js`, `transit.js`, `style.css` | the page                                                        |
| `data/graph.*`                                                 | the transit graph the page loads                                |
| `api/`                                                         | Vercel Function entry points (thin wrappers)                    |
| `server/`                                                      | routing, validation, SQL, rate limiting                         |
| `tests/`                                                       | `npm test`                                                      |
| `e2e/`, `playwright.config.mjs`                                | `npm run e2e` (Chromium; OneMap and the CDN are stubbed)        |
| `tools/`                                                       | build, site check, local dev server                             |
| `scripts/`, `data/*.json`                                      | Python scripts and inputs that rebuild the graph (not deployed) |

## Data

Bus stops and routes from [busrouter.sg](https://busrouter.sg) (© LTA, OneMap, OpenStreetMap
contributors), rail lines and malls from OpenStreetMap, postal-code search and map tiles from OneMap
(Singapore Land Authority). The OneMap token in `.env` is used only by the offline calibration scripts,
never by the page or the API.
