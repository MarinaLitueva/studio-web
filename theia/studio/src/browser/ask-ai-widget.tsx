// Ask AI panel: the workspace's mini-chat, INSIDE the IDE. Same gear, same
// chat history as the portal's Ask AI card — the IDE talks to the gateway
// same-origin via the session gate (`StudioApi`), authenticated with the
// portal-issued token from the bridge. On open the panel picks the most
// recent chat (that is the portal's workspace chat when one exists) and
// loads its history; the first message creates one otherwise.

import * as React from '@theia/core/shared/react';
import { injectable } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { Message } from '@theia/core/lib/browser/widgets/widget';
import { StudioApi } from './studio-api';

export const ASK_AI_WIDGET_ID = 'studio.ask-ai';

interface Line { role: 'user' | 'assistant'; text: string }

@injectable()
export class AskAiWidget extends ReactWidget {

    protected chatId: string | undefined;
    protected lines: Line[] = [];
    protected input = '';
    protected busy = false;
    protected error = '';

    constructor() {
        super();
        this.id = ASK_AI_WIDGET_ID;
        this.title.label = 'Ask AI';
        this.title.caption = 'Workspace chat (mini-chat gear, shared with the portal)';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-sparkle';
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        void this.loadHistory();
    }

    protected async loadHistory(): Promise<void> {
        try {
            const chats = await (await StudioApi.fetch('/mini-chat/v1/chats')).json();
            const first = (chats.items ?? [])[0];
            if (first?.id) {
                this.chatId = first.id;
                const page = await (await StudioApi.fetch(`/mini-chat/v1/chats/${first.id}/messages`)).json();
                this.lines = (page.items ?? []).map((m: { role?: string; content?: string }) => ({
                    role: m.role === 'user' ? 'user' : 'assistant',
                    text: m.content ?? '',
                }));
            }
        } catch (e) {
            this.error = `history unavailable: ${e}`;
        }
        this.update();
    }

    protected async send(): Promise<void> {
        const content = this.input.trim();
        if (!content || this.busy) { return; }
        this.busy = true;
        this.error = '';
        this.input = '';
        this.lines.push({ role: 'user', text: content }, { role: 'assistant', text: '…' });
        this.update();
        try {
            if (!this.chatId) {
                const chat = await (await StudioApi.fetch('/mini-chat/v1/chats', {
                    method: 'POST', body: JSON.stringify({ title: 'Workspace chat' }),
                })).json();
                this.chatId = chat.id;
            }
            const res = await StudioApi.fetch(`/mini-chat/v1/chats/${this.chatId}/messages:stream`, {
                method: 'POST',
                headers: { Accept: 'text/event-stream' },
                body: JSON.stringify({ content }),
            });
            if (!res.ok || !res.body) { throw new Error(`HTTP ${res.status}`); }
            const reader = res.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            let text = '';
            for (;;) {
                const { done, value } = await reader.read();
                if (done) { break; }
                buf += dec.decode(value, { stream: true });
                let i;
                while ((i = buf.indexOf('\n\n')) >= 0) {
                    const frame = buf.slice(0, i);
                    buf = buf.slice(i + 2);
                    const event = /^event:\s*(.+)$/m.exec(frame)?.[1]?.trim();
                    const data = /^data:\s*(.+)$/m.exec(frame)?.[1];
                    if (event === 'delta' && data) {
                        try {
                            const d = JSON.parse(data) as { text?: string; content?: string; delta?: string };
                            text += d.text ?? d.content ?? d.delta ?? '';
                            this.lines[this.lines.length - 1] = { role: 'assistant', text };
                            this.update();
                        } catch { /* malformed frame */ }
                    }
                }
            }
        } catch (e) {
            this.error = String(e);
        } finally {
            this.busy = false;
            this.update();
        }
    }

    protected render(): React.ReactNode {
        return (
            <div style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 6, gap: 6 }}>
                <div style={{ flex: 1, overflow: 'auto', fontSize: 13 }}>
                    {this.lines.map((l, i) => (
                        <p key={i} style={{ margin: '4px 0', whiteSpace: 'pre-wrap' }}>
                            <b>{l.role === 'user' ? 'You' : 'AI'}:</b> {l.text}
                        </p>
                    ))}
                    {this.error && <p style={{ color: 'var(--theia-errorForeground)' }}>{this.error}</p>}
                </div>
                <textarea
                    className='theia-input'
                    rows={2}
                    placeholder='Ask about this workspace… (Enter to send)'
                    value={this.input}
                    disabled={this.busy}
                    onChange={e => { this.input = e.target.value; this.update(); }}
                    onKeyDown={e => {
                        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void this.send(); }
                    }}
                />
            </div>
        );
    }
}
