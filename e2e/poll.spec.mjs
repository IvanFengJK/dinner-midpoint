import { test, expect, startGroup, joinGroup, pollOnce } from './fixtures.mjs';

test('keyboard focus on a member button survives a poll when nothing changed', async ({ page }) => {
  await page.clock.install();
  await startGroup(page);
  const remove = page.getByRole('button', { name: 'Remove Ann' });
  await remove.focus();
  await pollOnce(page);
  await expect(remove).toBeFocused();
});

test('text selected in the group link input survives a poll when nothing changed', async ({
  page,
}) => {
  await page.clock.install();
  await startGroup(page);
  const link = page.getByLabel('Group link');
  await link.focus(); // selects the whole link
  await expect(link).toBeFocused();
  await pollOnce(page);
  await expect(link).toBeFocused();
  const selected = await link.evaluate((i) => i.value.slice(i.selectionStart, i.selectionEnd));
  expect(selected).toBe(await link.inputValue());
});

test('a poll still shows a member who joined meanwhile', async ({ page, browser }) => {
  await page.clock.install();
  const groupUrl = await startGroup(page);
  const friend = await joinGroup(browser, groupUrl, { name: 'Ben' });
  await pollOnce(page);
  await expect(page.locator('#members')).toContainText('Ben');
  await friend.context().close();
});
