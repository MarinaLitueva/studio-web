import { defineConfig } from '@playwright/test';

export default defineConfig({
    testDir: './tests/e2e',
    fullyParallel: false,
    forbidOnly: Boolean(process.env.CI),
    retries: 0,
    workers: 1,
    timeout: 120_000,
    expect: {
        timeout: 15_000
    },
    reporter: [['list']],
    outputDir: 'test-results/playwright',
    use: {
        baseURL: 'http://localhost:3210',
        headless: true,
        trace: 'off',
        screenshot: 'only-on-failure',
        video: 'off'
    }
});
