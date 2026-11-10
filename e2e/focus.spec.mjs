import { test, expect, startGroup, stubInternet, pollOnce } from './fixtures.mjs';

test('starting a group moves focus to the group heading', async ({ page }) => {
  await startGroup(page);
  await expect(page.getByRole('heading', { name: 'Friday dinner' })).toBeFocused();
});

test('saving an edit to your entry moves focus to the group heading', async ({ page }) => {
  await startGroup(page);
  await page.getByRole('button', { name: 'Edit Ann' }).click();
  const form = page.locator('#entry-form');
  await form.getByLabel('Your name').fill('Anna');
  await form.getByRole('button', { name: 'Save' }).click();
  await expect(page.locator('#members')).toContainText('Anna');
  await expect(page.getByRole('heading', { name: 'Friday dinner' })).toBeFocused();
});

test('cancelling the join form returns focus to the "Add your details" button', async ({
  page,
  browser,
}) => {
  const groupUrl = await startGroup(page);
  const friend = await browser.newContext();
  await stubInternet(friend);
  const fp = await friend.newPage();
  await fp.goto(groupUrl);
  await fp.getByRole('button', { name: '+ Add your details' }).click();
  await fp.getByRole('button', { name: 'Cancel' }).click();
  await expect(fp.getByRole('button', { name: '+ Add your details' })).toBeFocused();
  await friend.close();
});

test('cancelling an edit returns focus to the Edit button', async ({ page }) => {
  await startGroup(page);
  await page.getByRole('button', { name: 'Edit Ann' }).click();
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('button', { name: 'Edit Ann' })).toBeFocused();
});

test('closing the quick calculator moves focus to the home heading', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: /quick calculator/ }).click();
  await page.getByRole('button', { name: 'Back to groups' }).click();
  await expect(page.getByRole('heading', { name: 'Start a group' })).toBeFocused();
});

test('deleting the group moves focus to the home heading', async ({ page }) => {
  await startGroup(page);
  page.on('dialog', (d) => d.accept());
  await page.getByRole('button', { name: 'Delete this group' }).click();
  await expect(page.getByRole('heading', { name: 'Start a group' })).toBeFocused();
});

test('when the group has expired focus moves to the home heading', async ({ page }) => {
  await page.clock.install();
  await startGroup(page);
  await page.route(/\/api\/groups\/[\w-]{22}$/, (route) =>
    route.fulfill({ status: 404, json: { error: 'Not found' } }),
  );
  await pollOnce(page);
  await expect(page.getByRole('heading', { name: 'Start a group' })).toBeFocused();
});
