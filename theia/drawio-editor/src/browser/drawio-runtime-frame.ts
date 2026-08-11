import { DrawioEditorMessage } from '../common/drawio-protocol';
import { assertDistinctDrawioOrigins, normalizeDrawioRuntimeOrigin } from '../common/drawio-runtime-origin-policy';

export const DRAWIO_RUNTIME_SANDBOX = ['allow-scripts', 'allow-same-origin'];

export interface DrawioRuntimeFrameConfig {
    readonly runtimeOrigin: string;
    readonly studioOrigin: string;
}

export interface DrawioRuntimeFrameConfigInput {
    readonly runtimeOriginInput: string;
    readonly studioOriginInput: string;
}

export interface DrawioRuntimeMessageEventLike {
    readonly origin: string;
    readonly source: unknown;
    readonly data: unknown;
}

export interface DrawioRuntimeMessageTarget {
    postMessage(message: unknown, targetOrigin: string): void;
}

export function resolveDrawioRuntimeFrameConfig({
    runtimeOriginInput,
    studioOriginInput
}: DrawioRuntimeFrameConfigInput): DrawioRuntimeFrameConfig {
    const runtimeOrigin = normalizeDrawioRuntimeOrigin(runtimeOriginInput, 'runtime origin');
    const { studioOrigin } = assertDistinctDrawioOrigins(runtimeOrigin, studioOriginInput);
    return { runtimeOrigin, studioOrigin };
}

export function acceptDrawioRuntimeMessage<TParsed = DrawioEditorMessage>(
    eventLike: DrawioRuntimeMessageEventLike,
    expectedOrigin: string,
    expectedSource: unknown,
    parseEditorMessage: (payload: unknown) => TParsed
): TParsed | undefined {
    const exactExpectedOrigin = normalizeDrawioRuntimeOrigin(expectedOrigin, 'runtime origin');
    if (eventLike.origin !== exactExpectedOrigin || eventLike.source !== expectedSource) {
        return undefined;
    }
    return parseEditorMessage(eventLike.data);
}

export function postDrawioRuntimeMessage(
    targetWindow: DrawioRuntimeMessageTarget,
    payload: unknown,
    runtimeOrigin: string
): void {
    const exactRuntimeOrigin = normalizeDrawioRuntimeOrigin(runtimeOrigin, 'runtime origin');
    targetWindow.postMessage(payload, exactRuntimeOrigin);
}
