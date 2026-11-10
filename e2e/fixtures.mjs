// Hermetic browser seam: the real page and API (dev server), with everything that lives on
// the internet answered locally. Nothing here touches the network.
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { test as base, expect } from '@playwright/test';

const require = createRequire(import.meta.url);
const LEAFLET = require.resolve('leaflet/dist/leaflet.js');
const LEAFLET_CSS = require.resolve('leaflet/dist/leaflet.css');

// Fixed OneMap answers: postal code -> coordinates (all near an MRT station).
export const POSTAL = {
  238801: { lat: 1.3043, lng: 103.832 }, // Orchard
  558762: { lat: 1.3498, lng: 103.8738 }, // Serangoon
  529510: { lat: 1.3541, lng: 103.944 }, // Tampines
  '018956': { lat: 1.282, lng: 103.86 }, // Marina Bay
};
export const UNKNOWN_POSTAL = '999999';

const PIXEL = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);
let nextVisitor = 1;

// Gives a browser context its own "visitor" (so the API's per-visitor rate limit never gets in
// the way) and answers every internet request locally.
export async function stubInternet(context) {
  await context.setExtraHTTPHeaders({
    'x-forwarded-for': `10.0.${process.pid % 250}.${nextVisitor++ % 250}`,
  });
  await context.route('https://cdnjs.cloudflare.com/**', async (route) => {
    const url = route.request().url();
    if (url.endsWith('leaflet.js')) {
      return route.fulfill({ contentType: 'text/javascript', body: await readFile(LEAFLET) });
    }
    if (url.endsWith('leaflet.css')) {
      return route.fulfill({ contentType: 'text/css', body: await readFile(LEAFLET_CSS) });
    }
    return route.abort();
  });
  await context.route('https://www.onemap.gov.sg/maps/tiles/**', (route) =>
    route.fulfill({ contentType: 'image/png', body: PIXEL }),
  );
  await context.route('https://www.onemap.gov.sg/api/common/elastic/search*', (route) => {
    const postal = new URL(route.request().url()).searchParams.get('searchVal');
    const at = POSTAL[postal];
    const results = at
      ? [{ SEARCHVAL: `SINGAPORE ${postal}`, LATITUDE: String(at.lat), LONGITUDE: String(at.lng) }]
      : [];
    return route.fulfill({ json: { found: results.length, results } });
  });
}

export const test = base.extend({
  context: async ({ context }, use) => {
    await stubInternet(context);
    await use(context);
  },
});

export { expect };

// Drives the real UI: start a group as `name` and wait for the group screen.
export async function startGroup(
  page,
  { group = 'Friday dinner', name = 'Ann', work = '238801', home = '558762' } = {},
) {
  await page.goto('/');
  const form = page.locator('#create-form');
  await form.getByLabel('Group name').fill(group);
  await form.getByLabel('Your name').fill(name);
  await form.getByLabel('Your work postal code').fill(work);
  await form.getByLabel('Your home postal code').fill(home);
  await form.getByRole('button', { name: 'Start group' }).click();
  await expect(page.getByRole('heading', { name: group })).toBeVisible();
  return page.url();
}

// Opens the group link in a fresh browser (a friend's phone) and joins as `name`.
// Returns the friend's page; the caller closes its context.
export async function joinGroup(browser, groupUrl, { name, work = '529510', home = '018956' }) {
  const context = await browser.newContext();
  await stubInternet(context);
  const page = await context.newPage();
  await page.goto(groupUrl);
  await page.getByRole('button', { name: '+ Add your details' }).click();
  const form = page.locator('#entry-form');
  await form.getByLabel('Your name').fill(name);
  await form.getByLabel('Work postal code').fill(work);
  await form.getByLabel('Home postal code').fill(home);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#members')).toContainText(name);
  return page;
}

// Fast-forwards the 30 s poll (needs page.clock.install() before the page loads) and waits
// until the group response has been received and the page has had time to render it.
export async function pollOnce(page) {
  const refreshed = page.waitForResponse(
    (r) => r.request().method() === 'GET' && /\/api\/groups\/[\w-]{22}$/.test(r.url()),
  );
  await page.clock.runFor(30_000 + 1000);
  await refreshed;
  await page.waitForTimeout(150);
}
