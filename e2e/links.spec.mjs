import { test, expect, startGroup, joinGroup, pollOnce, stubInternet } from './fixtures.mjs';

test('someone who joins is shown their personal link and told to save it', async ({
  page,
  browser,
}) => {
  const groupUrl = await startGroup(page);
  const friend = await joinGroup(browser, groupUrl, { name: 'Ben' });
  await expect(friend.locator('#links')).toHaveJSProperty('open', true);
  const personal = friend.getByLabel('Your personal link');
  await expect(personal).toBeFocused();
  await expect(personal).toBeInViewport();
  await expect(friend.locator('#view-group')).toContainText(
    'Save this link to edit your entry later',
  );
  await friend.context().close();
});

test('a person who only opens the group link sees no personal link or save prompt', async ({
  page,
  browser,
}) => {
  const groupUrl = await startGroup(page);
  const context = await browser.newContext();
  await stubInternet(context);
  const visitor = await context.newPage();
  await visitor.goto(groupUrl);
  await expect(visitor.getByRole('heading', { name: 'Friday dinner' })).toBeVisible();
  await expect(visitor.getByLabel('Your personal link')).toHaveCount(0);
  await expect(visitor.locator('#view-group')).not.toContainText('Save this link');
  await context.close();
});

test.describe('when the browser blocks localStorage', () => {
  test.beforeEach(async ({ context }) => {
    await context.addInitScript(() => {
      Object.defineProperty(window, 'localStorage', {
        get() {
          throw new DOMException('blocked', 'SecurityError');
        },
      });
    });
  });

  test('the group screen warns, and keeps warning, that keys last for this tab only', async ({
    page,
  }) => {
    await page.clock.install();
    await startGroup(page);
    const warning = page.getByText(/only for this tab/);
    await expect(warning).toBeVisible();
    await pollOnce(page);
    await expect(warning).toBeVisible();
  });
});

test('with working storage there is no tab-only warning', async ({ page }) => {
  await startGroup(page);
  await expect(page.getByText(/only for this tab/)).toBeHidden();
});
