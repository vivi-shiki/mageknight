import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: './apps/web/e2e',
  fullyParallel: false,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: 'http://127.0.0.1:4176',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'npm run server',
      url: 'http://127.0.0.1:4175/api/health',
      reuseExistingServer: false,
      env: {
        MULTIPLAYER_PORT: '4175',
        MULTIPLAYER_DATA_FILE: 'data/e2e-multiplayer.json',
      },
    },
    {
      command: 'npm run dev -- --port 4176',
      url: 'http://127.0.0.1:4176',
      reuseExistingServer: false,
      env: {
        VITE_API_TARGET: 'http://127.0.0.1:4175',
      },
    },
  ],
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
  ],
});
