import 'reflect-metadata';
jest.mock('@theia/workspace/lib/browser/workspace-commands', () => ({
    WorkspaceCommands: {
        OPEN: { id: 'workspace:open' },
        OPEN_FOLDER: { id: 'workspace:openFolder' },
        OPEN_WORKSPACE: { id: 'workspace:openWorkspace' },
        OPEN_RECENT_WORKSPACE: { id: 'workspace:openRecent' },
        CLOSE: { id: 'workspace:close' },
        ADD_FOLDER: { id: 'workspace:addFolder' },
        REMOVE_FOLDER: { id: 'workspace:removeFolder' },
        SAVE_WORKSPACE_AS: { id: 'workspace:saveAs' },
        OPEN_WORKSPACE_FILE: { id: 'workspace:openConfigFile' }
    }
}));
import { Disposable } from '@theia/core/lib/common/disposable';
import { FixedWorkspaceContribution } from './fixed-workspace-contribution';

describe('FixedWorkspaceContribution', () => {
    it('replaces workspace mutation commands with hidden disabled handlers', async () => {
        const commands = {
            unregisterCommand: jest.fn(),
            registerCommand: jest.fn().mockReturnValue(Disposable.NULL)
        };
        const runtime = {
            getSession: jest.fn().mockResolvedValue({
                features: { allowWorkspaceSwitching: false }
            })
        };
        const contribution = new FixedWorkspaceContribution(commands as never, runtime as never);

        await contribution.onStart();

        expect(commands.unregisterCommand).toHaveBeenCalledTimes(16);
        expect(commands.registerCommand).toHaveBeenCalledTimes(16);
        expect(commands.unregisterCommand).toHaveBeenCalledWith({ id: 'vscode.openFolder' });
        expect(commands.unregisterCommand).toHaveBeenCalledWith({ id: 'workbench.action.openRecent' });
        for (const [, handler] of commands.registerCommand.mock.calls) {
            expect(handler.isEnabled()).toBe(false);
            expect(handler.isVisible()).toBe(false);
        }
    });

    it('preserves workspace commands when runtime switching is allowed', async () => {
        const commands = {
            unregisterCommand: jest.fn(),
            registerCommand: jest.fn()
        };
        const runtime = {
            getSession: jest.fn().mockResolvedValue({
                features: { allowWorkspaceSwitching: true }
            })
        };
        const contribution = new FixedWorkspaceContribution(commands as never, runtime as never);

        await contribution.onStart();

        expect(commands.unregisterCommand).not.toHaveBeenCalled();
        expect(commands.registerCommand).not.toHaveBeenCalled();
    });

    it('fails closed when the runtime session cannot be loaded', async () => {
        const commands = {
            unregisterCommand: jest.fn(),
            registerCommand: jest.fn().mockReturnValue(Disposable.NULL)
        };
        const runtime = {
            getSession: jest.fn().mockRejectedValue(new Error('offline'))
        };
        const contribution = new FixedWorkspaceContribution(commands as never, runtime as never);

        await expect(contribution.onStart()).resolves.toBeUndefined();

        expect(commands.unregisterCommand).toHaveBeenCalledTimes(16);
        expect(commands.registerCommand).toHaveBeenCalledTimes(16);
    });
});
