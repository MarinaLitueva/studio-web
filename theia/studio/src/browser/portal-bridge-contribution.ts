// Portal bridge: makes an embedded session feel native inside the Studio
// portal (the IDE runs in an iframe there — a "Space"). Two duties:
//
//  * portal → IDE: `studio.init` / `studio.theme` messages carry the
//    portal's theme; the bridge maps it onto Theia's color theme so a dark
//    portal never opens a light IDE.
//  * IDE → portal: `studio.status` messages report the dirty-editor count,
//    so the portal can mark the space ("unsaved changes" dot) without
//    polling.
//
// Security: messages are only exchanged with the embedding window. We do
// not know the portal's origin at build time (dev :5173, prod domains), so
// inbound messages are accepted only from `window.parent` and replies go
// to the sender's origin — never `*` broadcasts with data beyond status.
// Standalone (non-embedded) sessions skip all of this.

import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { Saveable } from '@theia/core/lib/browser/saveable';
import { PreferenceService, PreferenceScope } from '@theia/core/lib/common';

interface PortalMessage {
    type?: string;
    theme?: string;
    apiToken?: string;
}

/**
 * Latest portal-issued API token (module-scoped, never persisted). The
 * portal renews it silently and re-posts `studio.token`; gears calls go
 * same-origin through the session gate at `/studio-api/<gear path>`.
 */
export const StudioApi = {
    token: '' as string,
    async fetch(path: string, init: RequestInit = {}): Promise<Response> {
        return fetch(`/studio-api${path}`, {
            ...init,
            headers: {
                ...(init.headers ?? {}),
                Authorization: `Bearer ${StudioApi.token}`,
                'Content-Type': 'application/json',
            },
        });
    },
};

@injectable()
export class PortalBridgeContribution implements FrontendApplicationContribution {

    @inject(ThemeService)
    protected readonly themeService: ThemeService;

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(PreferenceService)
    protected readonly preferences: PreferenceService;

    protected portalOrigin: string | undefined;
    protected lastDirty = -1;
    protected lastAiToken = '';

    onStart(): void {
        if (window.parent === window) {
            return; // standalone tab — no portal to talk to
        }

        window.addEventListener('message', (event) => {
            if (event.source !== window.parent) {
                return; // only the embedding portal window is trusted
            }
            const msg = event.data as PortalMessage;
            if (!msg || typeof msg.type !== 'string' || !msg.type.startsWith('studio.')) {
                return;
            }
            this.portalOrigin = event.origin;
            if ((msg.type === 'studio.init' || msg.type === 'studio.theme') && msg.theme) {
                this.applyPortalTheme(msg.theme);
            }
            if ((msg.type === 'studio.init' || msg.type === 'studio.token') && msg.apiToken) {
                StudioApi.token = msg.apiToken;
                void this.configureTheiaAi(msg.apiToken);
            }
            if (msg.type === 'studio.init') {
                this.postStatus(); // answer the handshake right away
            }
        });

        // Dirty-state reporting: cheap 2s poll over the shell's widgets —
        // there is no aggregate dirty event, and per-widget listeners would
        // leak on close. Only changes are posted.
        setInterval(() => this.postStatus(), 2000);
    }

    /**
     * Wire the native Theia AI stack (Coder, Universal, code completion, …)
     * to the Studio backend's OpenAI-compatible LLM proxy.
     *
     * Provider-agnostic on purpose: the IDE image knows nothing about the
     * LLM vendor. The backend decides (STUDIO_LLM_BASE_URL / _MODEL /
     * _API_KEY on the server) and advertises the client side of that choice
     * via GET /studio-llm/v1/client-config; we fetch it here and configure
     * Theia's `ai-openai` accordingly.
     *
     * The `ai-openai` provider runs in Theia's NODE backend and calls
     * `{url}/chat/completions` with `Authorization: Bearer {apiKey}`. We
     * point it at the in-container session gate (`127.0.0.1:3003`), whose
     * `/studio-api` route forwards to the Studio gateway with headers
     * passed through — and we use the portal-issued USER token as the
     * apiKey. The real provider key stays on the Studio backend; revoking
     * the user session revokes in-IDE AI with it.
     *
     * Written at User scope: settings live in the throwaway session
     * container, not in the workspace repo. Re-applied on every silent
     * token renewal the portal posts (`studio.token`).
     */
    protected async configureTheiaAi(token: string): Promise<void> {
        if (token === this.lastAiToken) {
            return;
        }
        this.lastAiToken = token;
        try {
            const res = await StudioApi.fetch('/studio-llm/v1/client-config');
            if (!res.ok) {
                console.warn(`studio: LLM client-config unavailable (HTTP ${res.status}) — Theia AI left unconfigured`);
                this.lastAiToken = ''; // retry on the next token post
                return;
            }
            const cfg = await res.json() as { model?: string; developer_message_settings?: string };
            if (!cfg.model) {
                console.warn('studio: LLM client-config has no model — Theia AI left unconfigured');
                this.lastAiToken = '';
                return;
            }
            const model = {
                id: 'studio-llm',
                model: cfg.model,
                url: 'http://127.0.0.1:3003/studio-api/studio-llm/v1',
                apiKey: token,
                developerMessageSettings: cfg.developer_message_settings ?? 'system',
            };
            const aliases = Object.fromEntries(
                ['universal', 'code', 'code-completion', 'summarize', 'fast']
                    .map(a => [`default/${a}`, { selectedModel: model.id }]),
            );
            await Promise.all([
                this.preferences.set('ai-features.AiEnable.enableAI', true, PreferenceScope.User),
                this.preferences.set('ai-features.openAiCustom.customOpenAiModels', [model], PreferenceScope.User),
                this.preferences.set('ai-features.languageModelAliases', aliases, PreferenceScope.User),
                // Without a default agent an un-mentioned chat message errors
                // with "No agent was found to handle this request".
                this.preferences.set('ai-features.chat.defaultChatAgent', 'Universal', PreferenceScope.User),
            ]);
        } catch (e) {
            console.warn('studio: Theia AI auto-config failed', e);
            this.lastAiToken = ''; // retry on the next token renewal
        }
    }

    protected applyPortalTheme(portalTheme: string): void {
        const target = portalTheme === 'light' ? 'light' : 'dark';
        if (this.themeService.getCurrentTheme().type !== target) {
            const theme = this.themeService
                .getThemes()
                .find(t => t.type === target);
            if (theme) {
                this.themeService.setCurrentTheme(theme.id, true);
            }
        }
    }

    protected postStatus(): void {
        if (!this.portalOrigin) {
            return; // no handshake yet — nowhere trusted to report to
        }
        const dirty = this.shell.widgets.filter(w => Saveable.isDirty(w)).length;
        if (dirty === this.lastDirty) {
            return;
        }
        this.lastDirty = dirty;
        window.parent.postMessage({ type: 'studio.status', dirty }, this.portalOrigin);
    }
}
