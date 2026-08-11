import * as React from '@theia/core/shared/react';
import { useCodeBlockEditorContext, type CodeBlockEditorProps } from '@mdxeditor/editor';
import { EditorState } from '@codemirror/state';
import { indentWithTab } from '@codemirror/commands';
import { lineNumbers, keymap, EditorView } from '@codemirror/view';
import { basicSetup } from 'codemirror';
import { basicLight } from 'cm6-theme-basic-light';
import {
    applyMermaidDraft,
    cancelMermaidEditing,
    changeMermaidDraft,
    createMermaidConfig,
    createMermaidEditorSessionState,
    createMermaidRenderId,
    getMermaidTheme,
    sanitizeMermaidSvg,
    shouldReuseMermaidRender,
    startMermaidEditing,
    validateMermaidSource,
    type MermaidPreviewTheme,
    type MermaidRenderCacheEntry,
    type MermaidThemeType
} from './markdown-editor-mermaid';

interface MermaidApi {
    initialize(config: Record<string, unknown>): void;
    render(id: string, text: string): Promise<{ svg: string }>;
}

interface MermaidCodeBlockEditorProps extends CodeBlockEditorProps {
    readonly mermaidThemeType: MermaidThemeType;
}

interface MermaidRenderState {
    readonly loading: boolean;
    readonly svg?: string;
    readonly error?: string;
}

export function MermaidCodeBlockEditor(props: MermaidCodeBlockEditorProps): React.ReactElement {
    const { code, nodeKey, focusEmitter, mermaidThemeType } = props;
    const { setCode } = useCodeBlockEditorContext();
    const [session, setSession] = React.useState(() => createMermaidEditorSessionState(code));
    const [renderState, setRenderState] = React.useState<MermaidRenderState>({ loading: true });
    const theme = React.useMemo(() => getMermaidTheme(mermaidThemeType), [mermaidThemeType]);
    const cacheRef = React.useRef<MermaidRenderCacheEntry | undefined>(undefined);
    const generationRef = React.useRef(0);
    const editorHostRef = React.useRef<HTMLDivElement | null>(null);
    const editorViewRef = React.useRef<EditorView | null>(null);
    const blockRenderIdRef = React.useRef<string>(createMermaidRenderId(nodeKey));
    const draftRef = React.useRef(code);

    React.useEffect(() => {
        if (session.mode !== 'edit') {
            draftRef.current = code;
            setSession(cancelMermaidEditing(code));
        }
    }, [code, session.mode]);

    React.useEffect(() => {
        let cancelled = false;
        const generation = generationRef.current + 1;
        generationRef.current = generation;
        if (shouldReuseMermaidRender(cacheRef.current, code, theme)) {
            setRenderState({ loading: false, svg: cacheRef.current.svg });
            return () => {
                cancelled = true;
            };
        }
        setRenderState({ loading: true });
        void renderMermaidDiagram({
            code,
            theme,
            renderId: `${blockRenderIdRef.current}-${generation}`
        }).then(svg => {
            if (cancelled || generation !== generationRef.current) {
                return;
            }
            cacheRef.current = { code, theme, svg };
            setRenderState({ loading: false, svg });
        }).catch(error => {
            if (cancelled || generation !== generationRef.current) {
                return;
            }
            setRenderState({
                loading: false,
                error: error instanceof Error ? error.message : 'Unable to render Mermaid diagram.'
            });
        });
        return () => {
            cancelled = true;
        };
    }, [code, theme]);

    React.useEffect(() => {
        if (session.mode !== 'edit') {
            editorViewRef.current?.destroy();
            editorViewRef.current = null;
            return;
        }
        const host = editorHostRef.current;
        if (!host) {
            return;
        }
        const applyDraft = (): void => {
            setCode(draftRef.current);
            setSession(current => applyMermaidDraft(current));
        };
        const cancelDraft = (): void => {
            setSession(cancelMermaidEditing(code));
        };
        host.innerHTML = '';
        const view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: session.draft,
                extensions: [
                    basicSetup,
                    basicLight,
                    lineNumbers(),
                    EditorView.lineWrapping,
                    keymap.of([
                        indentWithTab,
                        {
                            key: 'Mod-Enter',
                            run: () => {
                                applyDraft();
                                return true;
                            }
                        },
                        {
                            key: 'Escape',
                            run: () => {
                                cancelDraft();
                                return true;
                            }
                        }
                    ]),
                    EditorView.updateListener.of(update => {
                        if (update.docChanged) {
                            draftRef.current = update.state.doc.toString();
                            setSession(current => changeMermaidDraft(current, draftRef.current));
                        }
                    }),
                    EditorView.domEventHandlers({
                        keydown: event => {
                            event.stopPropagation();
                            return false;
                        }
                    })
                ]
            })
        });
        requestAnimationFrame(() => {
            view.focus();
        });
        focusEmitter.subscribe(() => {
            view.focus();
        });
        editorViewRef.current = view;
        return () => {
            view.destroy();
            if (editorViewRef.current === view) {
                editorViewRef.current = null;
            }
        };
    }, [code, focusEmitter, session.mode, setCode]);

    const applyDraft = React.useCallback(() => {
        setCode(draftRef.current);
        setSession(current => applyMermaidDraft(current));
    }, [setCode]);

    if (session.mode === 'edit') {
        return (
            <div className='studio-markdown-mermaid-block'>
                <div className='studio-markdown-mermaid-toolbar'>
                    <span className='studio-markdown-mermaid-label'>Mermaid</span>
                    <button type='button' onClick={applyDraft}>Apply</button>
                    <button type='button' onClick={() => setSession(cancelMermaidEditing(code))}>Cancel</button>
                </div>
                <div className='studio-markdown-mermaid-editor' ref={editorHostRef} />
            </div>
        );
    }

    return (
        <div className='studio-markdown-mermaid-block'>
            <div className='studio-markdown-mermaid-toolbar'>
                <span className='studio-markdown-mermaid-label'>Mermaid</span>
                <button type='button' onClick={() => setSession(current => startMermaidEditing(current, code))}>Edit</button>
                <button type='button' onClick={() => { void copyPlainText(code); }}>Copy source</button>
            </div>
            <div className='studio-markdown-mermaid-preview'>
                {renderState.loading && <div className='studio-markdown-mermaid-status'>Rendering diagram...</div>}
                {!renderState.loading && renderState.error && (
                    <div className='studio-markdown-mermaid-error'>
                        <span>{renderState.error}</span>
                        <button type='button' onClick={() => setSession(current => startMermaidEditing(current, code))}>Edit source</button>
                    </div>
                )}
                {!renderState.loading && !renderState.error && renderState.svg && (
                    <div className='studio-markdown-mermaid-svg' dangerouslySetInnerHTML={{ __html: renderState.svg }} />
                )}
            </div>
        </div>
    );
}

async function renderMermaidDiagram(options: {
    readonly code: string;
    readonly theme: MermaidPreviewTheme;
    readonly renderId: string;
}): Promise<string> {
    validateMermaidSource(options.code);
    const task = mermaidRenderQueue.then(async () => {
        const mermaid = await loadMermaid();
        mermaid.initialize(createMermaidConfig(options.theme));
        const result = await mermaid.render(options.renderId, options.code);
        return sanitizeMermaidSvg(result.svg);
    });
    mermaidRenderQueue = task.then(() => undefined, () => undefined);
    return task;
}

let mermaidModulePromise: Promise<MermaidApi> | undefined;
let mermaidRenderQueue: Promise<void> = Promise.resolve();

async function loadMermaid(): Promise<MermaidApi> {
    if (!mermaidModulePromise) {
        mermaidModulePromise = import('mermaid').then(module => {
            const candidate = (module as { default?: unknown }).default ?? module;
            return candidate as MermaidApi;
        });
    }
    return mermaidModulePromise;
}

async function copyPlainText(value: string): Promise<void> {
    if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(value);
        return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', 'true');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    textarea.remove();
}
