import { test, expect, startGroup, pollOnce, UNKNOWN_POSTAL } from './fixtures.mjs';

test.describe('on a small phone screen', () => {
  test.use({ viewport: { width: 360, height: 480 } });

  test('a failed start-group request is reported next to the button, in view', async ({ page }) => {
    await page.route('**/api/groups', (route) => route.abort('connectionfailed'));
    await page.goto('/');
    const form = page.locator('#create-form');
    await form.getByLabel('Group name').fill('Friday dinner');
    await form.getByLabel('Your name').fill('Ann');
    await form.getByLabel('Your work postal code').fill('238801');
    await form.getByLabel('Your home postal code').fill('558762');
    await form.getByRole('button', { name: 'Start group' }).click();
    const error = form.getByRole('alert');
    await expect(error).toHaveText(/Couldn't reach the server/);
    await expect(error).toBeInViewport();
  });
});

test('an unknown postal code is linked to its error message', async ({ page }) => {
  await page.goto('/');
  const form = page.locator('#create-form');
  await form.getByLabel('Group name').fill('Friday dinner');
  await form.getByLabel('Your name').fill('Ann');
  await form.getByLabel('Your work postal code').fill(UNKNOWN_POSTAL);
  await form.getByLabel('Your home postal code').fill('558762');
  await form.getByRole('button', { name: 'Start group' }).click();
  await expect(form.getByRole('alert')).toHaveText(/couldn't find a postal code/);
  await expect(form.getByLabel('Your work postal code')).toHaveAccessibleDescription(
    /couldn't find a postal code/,
  );
  await expect(form.getByLabel('Your home postal code')).not.toHaveAttribute('aria-describedby');
});

test('a server complaint about a field is linked to that field', async ({ page }) => {
  await page.route('**/api/groups', (route) =>
    route.fulfill({
      status: 400,
      json: { error: 'Give your group a different name.', field: 'groupName' },
    }),
  );
  await page.goto('/');
  const form = page.locator('#create-form');
  await form.getByLabel('Group name').fill('Friday dinner');
  await form.getByLabel('Your name').fill('Ann');
  await form.getByLabel('Your work postal code').fill('238801');
  await form.getByLabel('Your home postal code').fill('558762');
  await form.getByRole('button', { name: 'Start group' }).click();
  await expect(form.getByLabel('Group name')).toHaveAccessibleDescription(/different name/);
  await expect(form.getByLabel('Group name')).toBeFocused();
});

test('an unknown postal code in the edit form is reported inside that form', async ({ page }) => {
  await startGroup(page);
  await page.getByRole('button', { name: 'Edit Ann' }).click();
  const form = page.locator('#entry-form');
  await form.getByLabel('Work postal code').fill(UNKNOWN_POSTAL);
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(form.getByRole('alert')).toHaveText(/couldn't find a postal code/);
  await expect(form.getByLabel('Work postal code')).toHaveAccessibleDescription(
    /couldn't find a postal code/,
  );
});

// Makes Leaflet (a third-party boundary) fail the way it does for bad geometry.
async function breakTheMap(page, { immediately = true } = {}) {
  await page.addInitScript((immediately) => {
    let leaflet;
    Object.defineProperty(window, 'L', {
      configurable: true,
      get: () => leaflet,
      set(v) {
        v.Map.prototype.fitBounds = () => {
          if (window.mapIsBroken) throw new Error('Bounds are not valid.');
        };
        window.mapIsBroken = immediately;
        leaflet = v;
      },
    });
  }, immediately);
}

async function fillQuickForm(page) {
  await page.getByRole('button', { name: /quick calculator/ }).click();
  const codes = ['238801', '558762', '529510', '018956'];
  const inputs = page.locator('#people input');
  for (let i = 0; i < codes.length; i++) await inputs.nth(i).fill(codes[i]);
}

test('a failure that is not the geocoder is not blamed on OneMap', async ({ page }) => {
  await breakTheMap(page);
  await page.goto('/');
  await fillQuickForm(page);
  await page.getByRole('button', { name: 'Find where to eat' }).click();
  const error = page.locator('#form').getByRole('alert');
  await expect(error).toHaveText(/Something went wrong/);
  await expect(error).not.toContainText('OneMap');
});

test('OneMap being down is reported as OneMap being busy, inside the form', async ({ page }) => {
  await page.clock.install();
  await page.route('https://www.onemap.gov.sg/api/common/elastic/search*', (route) =>
    route.fulfill({ status: 503, body: 'busy' }),
  );
  await page.goto('/');
  await fillQuickForm(page);
  await page.getByRole('button', { name: 'Find where to eat' }).click();
  // The geocoder backs off between its retries: keep fast-forwarding until it gives up.
  await expect(async () => {
    await page.clock.runFor(5_000);
    await expect(page.locator('#form').getByRole('alert')).toHaveText(/OneMap is busy/, {
      timeout: 300,
    });
  }).toPass({ timeout: 15_000 });
});

test('switching Malls / MRT stations after a failure shows a message, not a silent error', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await breakTheMap(page, { immediately: false });
  await page.goto('/');
  await fillQuickForm(page);
  await page.getByRole('button', { name: 'Find where to eat' }).click();
  await expect(page.locator('#out')).toBeVisible();
  await page.evaluate(() => (window.mapIsBroken = true));
  await page.locator('.seg').getByText('MRT stations').click();
  await expect(page.locator('#form').getByRole('alert')).toHaveText(/Something went wrong/);
  expect(errors).toEqual([]);
});

test('a failed first load of a group offers "Try again" instead of loading forever', async ({
  page,
}) => {
  const groupUrl = await startGroup(page, { group: 'Friday dinner' });
  await page.goto('about:blank');
  let failures = 1;
  await page.route(/\/api\/groups\/[\w-]{22}$/, (route) =>
    failures-- > 0 ? route.abort('connectionfailed') : route.continue(),
  );
  await page.goto(groupUrl);
  await expect(page.locator('#view-group').getByRole('alert')).toHaveText(
    /couldn't load this group/i,
  );
  await expect(page.getByRole('heading', { name: 'Loading group…' })).toHaveCount(0);
  await page.getByRole('button', { name: 'Try again' }).click();
  await expect(page.getByRole('heading', { name: 'Friday dinner' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeHidden();
});

test('a group that failed to load recovers by itself on the next poll', async ({ page }) => {
  const groupUrl = await startGroup(page, { group: 'Friday dinner' });
  await page.goto('about:blank');
  await page.clock.install();
  let failures = 1;
  await page.route(/\/api\/groups\/[\w-]{22}$/, (route) =>
    failures-- > 0 ? route.abort('connectionfailed') : route.continue(),
  );
  await page.goto(groupUrl);
  await expect(page.getByRole('button', { name: 'Try again' })).toBeVisible();
  await pollOnce(page);
  await expect(page.getByRole('heading', { name: 'Friday dinner' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Try again' })).toBeHidden();
});

test('a failed removal is reported on the group screen', async ({ page }) => {
  await startGroup(page);
  await page.route(/\/api\/groups\/[\w-]{22}\/members\//, (route) =>
    route.fulfill({ status: 500, json: { error: 'The server hiccuped.' } }),
  );
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Remove Ann' }).click();
  await expect(page.locator('#view-group').getByRole('alert')).toHaveText('The server hiccuped.');
});

test('an expired group is explained on the home screen, next to the form', async ({ page }) => {
  await page.clock.install();
  await startGroup(page);
  await page.route(/\/api\/groups\/[\w-]{22}$/, (route) =>
    route.fulfill({ status: 404, json: { error: 'Not found' } }),
  );
  await pollOnce(page);
  await expect(page.getByRole('alert').filter({ hasText: /expired/ })).toBeVisible();
});
