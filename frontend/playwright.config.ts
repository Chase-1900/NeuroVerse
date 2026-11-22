import { defineConfig } from '@playwright/test'

const baseURL = 'http://127.0.0.1:4173'
export default defineConfig({
  testDir: './tests/e2e',
  use: {
    baseURL,
    channel: 'chrome',
    launchOptions: { args: ['--enable-unsafe-swiftshader'] },
    trace: 'retain-on-failure',
  },
  webServer: { command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort', url: baseURL, reuseExistingServer: !process.env.CI },
})
