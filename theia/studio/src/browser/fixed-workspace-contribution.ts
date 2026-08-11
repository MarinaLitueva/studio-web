import { inject, injectable } from '@theia/core/shared/inversify';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { Command, CommandRegistry } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { WorkspaceCommands } from '@theia/workspace/lib/browser/workspace-commands';
import { StudioRuntimeService } from '../common/studio-protocol';

const WORKSPACE_MUTATION_COMMANDS: readonly Command[] = [
    WorkspaceCommands.OPEN,
    WorkspaceCommands.OPEN_FOLDER,
    WorkspaceCommands.OPEN_WORKSPACE,
    WorkspaceCommands.OPEN_RECENT_WORKSPACE,
    WorkspaceCommands.CLOSE,
    WorkspaceCommands.ADD_FOLDER,
    WorkspaceCommands.REMOVE_FOLDER,
    WorkspaceCommands.SAVE_WORKSPACE_AS,
    WorkspaceCommands.OPEN_WORKSPACE_FILE,
    // @theia/plugin-ext-vscode registers these as separate commands. Some
    // delegate to WorkspaceCommands, while vscode.openFolder and openRecent
    // call workspace services directly and therefore must be locked explicitly.
    { id: 'vscode.openFolder' },
    { id: 'workbench.action.files.openFileFolder' },
    { id: 'workbench.action.files.openFolder' },
    { id: 'workbench.action.addRootFolder' },
    { id: 'workbench.action.saveWorkspaceAs' },
    { id: 'workbench.action.openWorkspaceConfigFile' },
    { id: 'workbench.action.openRecent' }
];

@injectable()
export class FixedWorkspaceContribution implements FrontendApplicationContribution {
    protected readonly toDispose = new DisposableCollection();
    protected locked = false;

    constructor(
        @inject(CommandRegistry) protected readonly commands: CommandRegistry,
        @inject(StudioRuntimeService) protected readonly runtime: StudioRuntimeService
    ) {}

    async onStart(): Promise<void> {
        let allowWorkspaceSwitching = false;
        try {
            allowWorkspaceSwitching = (await this.runtime.getSession()).features.allowWorkspaceSwitching;
        } catch {
            this.lockWorkspaceCommands();
            return;
        }
        if (!allowWorkspaceSwitching) {
            this.lockWorkspaceCommands();
        }
    }

    onStop(): void {
        this.toDispose.dispose();
    }

    protected lockWorkspaceCommands(): void {
        if (this.locked) {
            return;
        }
        this.locked = true;
        for (const command of WORKSPACE_MUTATION_COMMANDS) {
            this.commands.unregisterCommand(command);
            this.toDispose.push(this.commands.registerCommand(command, {
                isEnabled: () => false,
                isVisible: () => false,
                execute: () => undefined
            }));
        }
    }
}
