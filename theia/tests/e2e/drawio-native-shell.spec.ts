import { test, expect, type Page } from '@playwright/test';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { createServer } from 'node:net';
import { request as httpRequest } from 'node:http';

const PROJECT_ROOT = join(__dirname, '..', '..');
const HOST = '127.0.0.1';
const DRAWIO_SHELL_TITLE = 'Draw.io native shell';
const RUNTIME_UNAVAILABLE_TEXT = 'The editor runtime is unavailable in Phase 3.';
const SHELL_FAIL_CLOSED_TEXT = 'This native Theia shell is registered and fail-closed until the runtime canvas is implemented.';
const BINARY_OPEN_CONFIRMATION_TEXT = /Opening it might take some time and might make the IDE unresponsive\. Do you want to open '.*' anyway\?/;
const PNG_PIXEL = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9pJzi10AAAAASUVORK5CYII=',
    'base64'
);

const supportedFiles = [
    'diagram.drawio',
    'diagram.dio',
    'diagram.drawio.svg',
    'diagram.drawio.png'
] as const;

test.describe('Draw.io native shell', () => {
    test('opens supported Draw.io resources through the native shell and restores the shell after reload', async ({ page }) => {
        const fixture = createFixture();
        const port = await reservePort();
        const studio = new StudioServer(fixture.workspaceDir, fixture.runtimeDir, port);

        try {
            studio.start();
            await studio.waitUntilReady();

            await page.goto(`http://${HOST}:${port}`);
            await page.waitForLoadState('networkidle');
            await acceptWorkspaceTrust(page);

            for (const fileName of supportedFiles) {
                await openFileViaQuickOpen(page, fileName);
                await expectNativeShellForFile(page, fileName);
                await closeCurrentEditor(page, fileName);
            }

            await openFileViaQuickOpen(page, 'plain.svg');
            await expectNoNativeShellForFile(page, 'plain.svg');
            await closeCurrentEditor(page, 'plain.svg');

            await openFileViaQuickOpen(page, 'plain.png');
            await expectBinaryOpenConfirmation(page, 'plain.png');
            await expectNoNativeShellAfterBinaryOpen(page);
            await dismissBinaryOpenConfirmation(page);

            await openFileViaQuickOpen(page, 'diagram.drawio.png');
            await expectNativeShellForFile(page, 'diagram.drawio.png');

            await page.reload();
            await page.waitForLoadState('networkidle');
            await acceptWorkspaceTrust(page);
            await expectNativeShellForFile(page, 'diagram.drawio.png');
        } finally {
            await studio.stop();
            fixture.dispose();
        }
    });
});

async function acceptWorkspaceTrust(page: Page): Promise<void> {
    const trustButton = page.getByRole('button', { name: /Yes, (?:I )?trust the authors/ });
    try {
        await trustButton.waitFor({ state: 'visible', timeout: 5_000 });
        await trustButton.click();
    } catch {
        // Theia remembers trust for an already accepted workspace.
    }
}

async function openFileViaQuickOpen(page: Page, fileName: string): Promise<void> {
    await page.getByRole('menuitem', { name: 'Go' }).click();
    await page.getByRole('menuitem', { name: /^Go to File\.\.\./ }).click();

    const quickInputWidget = page.locator('.quick-input-widget').filter({ has: page.getByRole('textbox') }).last();
    await quickInputWidget.waitFor({ state: 'visible', timeout: 10_000 });

    const openFileInput = quickInputWidget.getByRole('textbox').first();
    await openFileInput.waitFor({ state: 'visible', timeout: 10_000 });
    await openFileInput.fill(fileName);
    const exactResult = quickInputWidget.getByRole('option', { name: new RegExp(`^${escapeRegex(fileName)}(?:,|$)`) }).first();
    await exactResult.waitFor({ state: 'visible', timeout: 10_000 });
    await exactResult.click();
}

async function expectNativeShellForFile(page: Page, fileName: string): Promise<void> {
    const shell = page.locator('.drawio-editor-widget').filter({ has: page.getByText(DRAWIO_SHELL_TITLE, { exact: true }) }).last();
    await expect(shell).toBeVisible();
    await expect(page.locator('.lm-TabBar-tabLabel, .p-TabBar-tabLabel').filter({ hasText: new RegExp(`^${escapeRegex(fileName)}$`) }).last()).toBeVisible();
    await expect(shell.getByText(DRAWIO_SHELL_TITLE, { exact: true })).toBeVisible();
    await expect(shell.getByText(fileName, { exact: true })).toBeVisible();
    await expect(shell.getByText(RUNTIME_UNAVAILABLE_TEXT, { exact: true })).toBeVisible();
    await expect(shell.getByText(SHELL_FAIL_CLOSED_TEXT, { exact: true })).toBeVisible();
}

async function expectNoNativeShellForFile(page: Page, fileName: string): Promise<void> {
    await expect(page.locator('.lm-TabBar-tabLabel, .p-TabBar-tabLabel').filter({ hasText: fileName }).last()).toBeVisible();
    await expect(page.locator('.drawio-editor-widget').filter({ has: page.getByText(fileName, { exact: true }) })).toHaveCount(0);
    await expect(page.getByText(DRAWIO_SHELL_TITLE, { exact: true })).not.toBeVisible();
}

async function expectBinaryOpenConfirmation(page: Page, fileName: string): Promise<void> {
    await expect(page.getByText(BINARY_OPEN_CONFIRMATION_TEXT)).toBeVisible();
    await expect(page.getByText(new RegExp(`Do you want to open '${escapeRegex(fileName)}' anyway\\?`))).toBeVisible();
    await expect(page.getByRole('button', { name: 'No', exact: true })).toBeVisible();
}

async function expectNoNativeShellAfterBinaryOpen(page: Page): Promise<void> {
    await expect(page.locator('.drawio-editor-widget')).toHaveCount(0);
    await expect(page.getByText(DRAWIO_SHELL_TITLE, { exact: true })).not.toBeVisible();
}

async function dismissBinaryOpenConfirmation(page: Page): Promise<void> {
    await page.getByRole('button', { name: 'No', exact: true }).click();
    await expect(page.getByText(BINARY_OPEN_CONFIRMATION_TEXT)).not.toBeVisible();
}

async function closeCurrentEditor(page: Page, fileName: string): Promise<void> {
    const exactTab = page.locator('.lm-TabBar-tab').filter({ has: page.locator('.lm-TabBar-tabLabel').filter({ hasText: new RegExp(`^${escapeRegex(fileName)}$`) }) }).last();
    await exactTab.waitFor({ state: 'visible', timeout: 10_000 });
    await exactTab.hover();
    await exactTab.locator('.lm-TabBar-tabCloseIcon[title="Close"]').click();
    await expect.poll(async () => await page.locator('.lm-TabBar-tabLabel, .p-TabBar-tabLabel').filter({ hasText: new RegExp(`^${escapeRegex(fileName)}$`) }).count(), {
        timeout: 10_000,
        message: 'Current editor did not close'
    }).toBe(0);
}

function escapeRegex(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function createFixture(): Fixture {
    const rootDir = mkdtempSync(join(tmpdir(), 'drawio-native-shell-'));
    const workspaceDir = join(rootDir, 'workspace');
    const runtimeDir = join(rootDir, 'runtime');

    mkdirSync(workspaceDir, { recursive: true });
    mkdirSync(runtimeDir, { recursive: true });

    writeFileSync(join(workspaceDir, 'diagram.drawio'), '<mxfile host="app.diagrams.net"></mxfile>\n', 'utf8');
    writeFileSync(join(workspaceDir, 'diagram.dio'), '<mxfile host="app.diagrams.net"></mxfile>\n', 'utf8');
    writeFileSync(join(workspaceDir, 'diagram.drawio.svg'), createSvgDocument('diagram.drawio.svg'), 'utf8');
    writeFileSync(join(workspaceDir, 'plain.svg'), createSvgDocument('plain.svg'), 'utf8');
    writeFileSync(join(workspaceDir, 'diagram.drawio.png'), PNG_PIXEL);
    writeFileSync(join(workspaceDir, 'plain.png'), PNG_PIXEL);

    git(['init', '--initial-branch', 'main'], workspaceDir);
    git(['config', 'user.name', 'Drawio E2E'], workspaceDir);
    git(['config', 'user.email', 'drawio-e2e@example.test'], workspaceDir);
    git(['add', '.'], workspaceDir);
    git(['commit', '-m', 'Initial fixture'], workspaceDir);

    return {
        workspaceDir,
        runtimeDir,
        dispose: () => rmSync(rootDir, { recursive: true, force: true })
    };
}

function createSvgDocument(label: string): string {
    return [
        '<svg xmlns="http://www.w3.org/2000/svg" width="120" height="40" viewBox="0 0 120 40">',
        '  <rect width="120" height="40" fill="#f3f4f6" />',
        `  <text x="8" y="24" font-size="12" fill="#111827">${label}</text>`,
        '</svg>',
        ''
    ].join('\n');
}

class StudioServer {
    protected process: ChildProcess | undefined;
    protected readonly bufferedLogs: string[] = [];

    constructor(
        protected readonly workspaceDir: string,
        protected readonly runtimeDir: string,
        protected readonly port: number
    ) {}

    start(): void {
        if (this.process) {
            return;
        }
        const child = spawn(
            process.execPath,
            [
                'browser-app/scripts/start-browser.js',
                `--hostname=${HOST}`,
                `--port=${this.port}`,
                this.workspaceDir
            ],
            {
                cwd: PROJECT_ROOT,
                env: {
                    ...process.env,
                    STUDIO_ACTOR_ID: 'playwright-drawio',
                    STUDIO_WORKSPACE_ID: 'playwright-drawio-workspace',
                    STUDIO_DATA_DIR: this.runtimeDir,
                    STUDIO_GIT_MODE: 'disabled',
                    THEIA_WEBVIEW_EXTERNAL_ENDPOINT: '{{uuid}}.webview.{{hostname}}'
                },
                stdio: ['ignore', 'pipe', 'pipe']
            }
        );
        child.stdout?.on('data', chunk => this.captureLog(String(chunk)));
        child.stderr?.on('data', chunk => this.captureLog(String(chunk)));
        child.on('exit', code => {
            this.captureLog(`process exited with code ${code ?? -1}`);
        });
        this.process = child;
    }

    async waitUntilReady(): Promise<void> {
        const start = Date.now();
        while (Date.now() - start < 60_000) {
            if (!this.process || this.process.exitCode !== null) {
                throw new Error(`Studio server exited early.\n${this.flushLogs()}`);
            }
            try {
                await httpGet(`http://${HOST}:${this.port}`);
                return;
            } catch {
                await delay(250);
            }
        }
        throw new Error(`Studio server did not become ready.\n${this.flushLogs()}`);
    }

    async stop(): Promise<void> {
        const child = this.process;
        this.process = undefined;
        if (!child || child.exitCode !== null) {
            return;
        }
        child.kill('SIGTERM');
        const start = Date.now();
        while (child.exitCode === null && Date.now() - start < 10_000) {
            await delay(100);
        }
        if (child.exitCode === null) {
            child.kill('SIGKILL');
        }
    }

    protected captureLog(message: string): void {
        const normalized = message
            .replaceAll(this.workspaceDir, '<workspace>')
            .replaceAll(this.runtimeDir, '<runtime>')
            .trim();
        if (!normalized) {
            return;
        }
        this.bufferedLogs.push(normalized);
        if (this.bufferedLogs.length > 40) {
            this.bufferedLogs.shift();
        }
    }

    protected flushLogs(): string {
        return this.bufferedLogs.join('\n');
    }
}

interface Fixture {
    readonly workspaceDir: string;
    readonly runtimeDir: string;
    readonly dispose: () => void;
}

function git(args: string[], cwd: string): string {
    const result = spawnSync('git', args, {
        cwd,
        encoding: 'utf8'
    });
    if (result.status !== 0) {
        throw new Error(`git ${args.join(' ')} failed with exit code ${result.status ?? -1}: ${(result.stderr || result.stdout).trim()}`);
    }
    return result.stdout.trimEnd();
}

async function reservePort(): Promise<number> {
    return await new Promise((resolve, reject) => {
        const server = createServer();
        server.once('error', reject);
        server.listen(0, HOST, () => {
            const address = server.address();
            if (!address || typeof address === 'string') {
                server.close(() => reject(new Error('Unable to resolve reserved port')));
                return;
            }
            const { port } = address;
            server.close(error => {
                if (error) {
                    reject(error);
                    return;
                }
                resolve(port);
            });
        });
    });
}

function httpGet(url: string): Promise<string> {
    return new Promise((resolve, reject) => {
        const request = httpRequest(url, response => {
            const chunks: Buffer[] = [];
            response.on('data', chunk => chunks.push(Buffer.from(chunk)));
            response.on('end', () => {
                if ((response.statusCode ?? 500) >= 400) {
                    reject(new Error(`HTTP ${response.statusCode ?? 500}`));
                    return;
                }
                resolve(Buffer.concat(chunks).toString('utf8'));
            });
        });
        request.on('error', reject);
        request.end();
    });
}

function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
