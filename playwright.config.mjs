import { defineConfig } from '@playwright/test';

const port = Number(process.env.PORT ?? 8804);

export default defineConfig({
  testDir: 'e2e',
  testMatch: '*.spec.mjs',
  timeout: 30_000,
  expect: { timeout: 5_000 },
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: `http://localhost:${port}`, trace: 'retain-on-failure' },
  // The real dev server: the page, the API and an in-memory Postgres.
  webServer: {
    command: 'node tools/dev-server.mjs',
    // Each browser context sends its own X-Forwarded-For (e2e/fixtures.mjs), so the per-visitor
    // rate limit does not add up across tests.
    env: { PORT: String(port), DEV_TRUST_FORWARDED_FOR: '1' },
    url: `http://localhost:${port}`,
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
