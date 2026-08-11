import type { CodeBlockEditorDescriptor } from '@mdxeditor/editor';

export const MERMAID_LANGUAGE = 'mermaid';
export const MERMAID_MAX_TEXT_SIZE = 50000;
export const MERMAID_MAX_EDGES = 500;
export const MERMAID_SECURE_KEYS = [
    'startOnLoad',
    'securityLevel',
    'maxTextSize',
    'maxEdges',
    'theme',
    'look',
    'flowchart'
] as const;

export type MermaidPreviewTheme = 'neo' | 'neo-dark';
export type MermaidThemeType = 'dark' | 'light' | 'hc' | 'hcLight' | string;

export interface MermaidRenderCacheEntry {
    readonly code: string;
    readonly theme: MermaidPreviewTheme;
    readonly svg: string;
}

export interface MermaidEditorSessionState {
    readonly mode: 'preview' | 'edit';
    readonly draft: string;
}

let mermaidRenderSequence = 0;

export function createMermaidCodeBlockDescriptor(
    Editor: CodeBlockEditorDescriptor['Editor']
): CodeBlockEditorDescriptor {
    return {
        priority: 10,
        match: language => language === MERMAID_LANGUAGE,
        Editor
    };
}

export function getMermaidTheme(themeType: MermaidThemeType): MermaidPreviewTheme {
    return themeType === 'dark' || themeType === 'hc' ? 'neo-dark' : 'neo';
}

export function validateMermaidSource(code: string): void {
    if (code.length > MERMAID_MAX_TEXT_SIZE) {
        throw new Error(`Mermaid diagram exceeds the ${MERMAID_MAX_TEXT_SIZE} character limit.`);
    }
    const edgeCount = countMermaidEdges(code);
    if (edgeCount > MERMAID_MAX_EDGES) {
        throw new Error(`Mermaid diagram exceeds the ${MERMAID_MAX_EDGES} edge limit.`);
    }
}

export function createMermaidConfig(theme: MermaidPreviewTheme): Record<string, unknown> {
    return {
        startOnLoad: false,
        securityLevel: 'strict',
        secure: [...MERMAID_SECURE_KEYS],
        look: 'neo',
        theme,
        maxTextSize: MERMAID_MAX_TEXT_SIZE,
        maxEdges: MERMAID_MAX_EDGES,
        flowchart: {
            htmlLabels: false
        }
    };
}

export function countMermaidEdges(code: string): number {
    const matches = code.match(/<==>|<-.->|<->|==>|-->|---|===|-.->|o--|--o|x--|--x|<--|==x|--x/g);
    return matches?.length ?? 0;
}

export function sanitizeMermaidSvg(svg: string): string {
    const parser = new DOMParser();
    const document = parser.parseFromString(svg, 'image/svg+xml');
    if (document.querySelector('parsererror')) {
        throw new Error('Mermaid returned invalid SVG markup.');
    }
    const root = document.documentElement;
    if (!root || root.tagName.toLowerCase() !== 'svg') {
        throw new Error('Mermaid did not return an SVG root element.');
    }
    if (root.querySelector('image')) {
        throw new Error('Mermaid SVG contains disallowed image elements.');
    }
    const linkedElements = root.querySelectorAll('[href], [xlink\\:href]');
    for (const element of Array.from(linkedElements)) {
        const href = element.getAttribute('href') ?? element.getAttributeNS('http://www.w3.org/1999/xlink', 'href') ?? '';
        if (!/^#[A-Za-z_][A-Za-z0-9_.:-]*$/u.test(href)) {
            throw new Error('Mermaid SVG contains a disallowed external reference.');
        }
    }
    return new XMLSerializer().serializeToString(root);
}

export function createMermaidRenderId(blockId: string): string {
    mermaidRenderSequence += 1;
    const safeBlockId = blockId.replace(/[^A-Za-z0-9_-]+/g, '-').replace(/^-+|-+$/g, '') || 'block';
    return `studio-mermaid-${safeBlockId}-${mermaidRenderSequence}`;
}

export function shouldReuseMermaidRender(
    cache: MermaidRenderCacheEntry | undefined,
    code: string,
    theme: MermaidPreviewTheme
): cache is MermaidRenderCacheEntry {
    return !!cache && cache.code === code && cache.theme === theme;
}

export function createMermaidEditorSessionState(code: string): MermaidEditorSessionState {
    return {
        mode: 'preview',
        draft: code
    };
}

export function startMermaidEditing(state: MermaidEditorSessionState, code: string): MermaidEditorSessionState {
    return {
        mode: 'edit',
        draft: state.mode === 'edit' ? state.draft : code
    };
}

export function changeMermaidDraft(state: MermaidEditorSessionState, draft: string): MermaidEditorSessionState {
    return {
        ...state,
        draft
    };
}

export function applyMermaidDraft(state: MermaidEditorSessionState): MermaidEditorSessionState {
    return {
        mode: 'preview',
        draft: state.draft
    };
}

export function cancelMermaidEditing(code: string): MermaidEditorSessionState {
    return {
        mode: 'preview',
        draft: code
    };
}
