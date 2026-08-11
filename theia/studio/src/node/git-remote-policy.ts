import * as path from 'path';
import { parseGitRemoteCoordinates } from '../common/git-remote-reference';

export interface GitRemotePolicyOptions {
    readonly allowLocalTransport?: boolean;
}

export function assertSupportedRemoteUrl(value: string, options: GitRemotePolicyOptions = {}): void {
    if (!value || value.length > 2048 || value.startsWith('-') || /[\x00-\x1f\x7f]/.test(value)) {
        throw new Error('Resolved Git remote URL is invalid');
    }
    const allowTestLocalTransport = options.allowLocalTransport === true && process.env.NODE_ENV === 'test';
    if (allowTestLocalTransport && (path.isAbsolute(value) || /^file:\/\/\/[^\s]+$/i.test(value))) {
        return;
    }
    if (!parseGitRemoteCoordinates(value)) {
        throw new Error('Git remote URL uses an unsupported transport');
    }
}

export function isSupportedRemoteUrl(value: string, options: GitRemotePolicyOptions = {}): boolean {
    try {
        assertSupportedRemoteUrl(value, options);
        return true;
    } catch {
        return false;
    }
}
