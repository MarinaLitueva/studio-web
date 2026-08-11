import {
    MERMAID_SECURE_KEYS,
    MERMAID_MAX_EDGES,
    MERMAID_MAX_TEXT_SIZE,
    applyMermaidDraft,
    cancelMermaidEditing,
    createMermaidConfig,
    createMermaidCodeBlockDescriptor,
    createMermaidEditorSessionState,
    createMermaidRenderId,
    getMermaidTheme,
    sanitizeMermaidSvg,
    shouldReuseMermaidRender,
    startMermaidEditing,
    validateMermaidSource
} from './markdown-editor-mermaid';

describe('Markdown Mermaid helpers', () => {
    it('matches only exact mermaid code blocks', () => {
        const descriptor = createMermaidCodeBlockDescriptor(() => null);
        expect(descriptor.match('mermaid', '')).toBe(true);
        expect(descriptor.match('Mermaid', '')).toBe(false);
        expect(descriptor.match('mermaidjs', '')).toBe(false);
    });

    it('maps Theia themes to Mermaid neo variants', () => {
        expect(getMermaidTheme('dark')).toBe('neo-dark');
        expect(getMermaidTheme('hc')).toBe('neo-dark');
        expect(getMermaidTheme('light')).toBe('neo');
        expect(getMermaidTheme('hcLight')).toBe('neo');
    });

    it('builds a secure Mermaid config with fixed caps and flowchart html labels disabled', () => {
        expect(createMermaidConfig('neo-dark')).toEqual({
            startOnLoad: false,
            securityLevel: 'strict',
            secure: [...MERMAID_SECURE_KEYS],
            look: 'neo',
            theme: 'neo-dark',
            maxTextSize: MERMAID_MAX_TEXT_SIZE,
            maxEdges: MERMAID_MAX_EDGES,
            flowchart: {
                htmlLabels: false
            }
        });
    });

    it('enforces secure size and edge caps', () => {
        expect(() => validateMermaidSource('A'.repeat(MERMAID_MAX_TEXT_SIZE + 1))).toThrow(
            `${MERMAID_MAX_TEXT_SIZE} character limit`
        );
        expect(() => validateMermaidSource('graph TD\n' + '-->\n'.repeat(MERMAID_MAX_EDGES + 1))).toThrow(
            `${MERMAID_MAX_EDGES} edge limit`
        );
    });

    it('rejects unsafe SVG references and image tags', () => {
        expect(sanitizeMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg"><use href="#ok" /></svg>')).toContain('<use');
        expect(() => sanitizeMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg"><image href="https://x" /></svg>')).toThrow(
            'disallowed image elements'
        );
        expect(() => sanitizeMermaidSvg('<svg xmlns="http://www.w3.org/2000/svg"><use href="https://x" /></svg>')).toThrow(
            'disallowed external reference'
        );
    });

    it('uses unique render IDs and reuses only matching cached output', () => {
        expect(createMermaidRenderId('node')).not.toBe(createMermaidRenderId('node'));
        expect(shouldReuseMermaidRender({ code: 'graph TD', theme: 'neo', svg: '<svg />' }, 'graph TD', 'neo')).toBe(true);
        expect(shouldReuseMermaidRender({ code: 'graph TD', theme: 'neo', svg: '<svg />' }, 'graph TD', 'neo-dark')).toBe(false);
    });

    it('keeps edits local until apply and drops draft changes on cancel', () => {
        const initial = createMermaidEditorSessionState('graph TD\nA-->B');
        const editing = startMermaidEditing(initial, 'graph TD\nA-->B');
        expect(editing.mode).toBe('edit');
        const applied = applyMermaidDraft({ ...editing, draft: 'graph TD\nA-->C' });
        expect(applied).toEqual({ mode: 'preview', draft: 'graph TD\nA-->C' });
        expect(cancelMermaidEditing('graph TD\nA-->B')).toEqual({ mode: 'preview', draft: 'graph TD\nA-->B' });
    });
});
