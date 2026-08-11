import * as React from '@theia/core/shared/react';
import { injectable, inject, postConstruct, LazyServiceIdentifier } from '@theia/core/shared/inversify';
import { Message } from '@theia/core/lib/browser/widgets/widget';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { GitOperationsFrontendController } from './git-operations-contribution';

@injectable()
export class GitOperationsWidget extends ReactWidget {
    static readonly ID = 'studio:git-operations';
    static readonly LABEL = 'Git Operations';

    @inject(new LazyServiceIdentifier(() => GitOperationsFrontendController))
    protected readonly controller: GitOperationsFrontendController;

    @postConstruct()
    protected init(): void {
        this.id = GitOperationsWidget.ID;
        this.title.label = GitOperationsWidget.LABEL;
        this.title.caption = GitOperationsWidget.LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-source-control';
        this.toDispose.push(this.controller.onDidChange(() => this.update()));
        this.update();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected render(): React.ReactNode {
        const operations = this.controller.getOperations();
        const repositories = this.controller.getRepositories();
        const selectedRepository = this.controller.getSelectedRepository();
        const repositoriesById = new Map(repositories.map(repository => [repository.repositoryId, repository]));
        const operationGroups = new Map<string, typeof operations>();
        for (const operation of operations) {
            const groupId = operation.repositoryId ?? 'legacy';
            const group = operationGroups.get(groupId) ?? [];
            group.push(operation);
            operationGroups.set(groupId, group);
        }
        const latest = operations[0];
        return (
            <div className='studio-git-operations' data-testid='git-operations-widget'>
                <div className='studio-git-operations__header'>
                    <h2>Git Operations</h2>
                    <div className='studio-git-operations__status' data-testid='git-operations-status'>
                        <span>{repositories.length} repositories</span>
                        <span>{selectedRepository?.label ?? 'no repository selected'}</span>
                        <span>{selectedRepository?.git.branch ?? 'no branch'}</span>
                        <span>{selectedRepository?.git.mode ?? 'mixed'}</span>
                        <span>{this.controller.isConnected() ? (latest?.state ?? 'idle') : 'offline'}</span>
                    </div>
                </div>
                <div className='studio-git-operations__list' data-testid='git-operations-list'>
                    {operations.length === 0 ? (
                        <div className='studio-git-operations__empty' data-testid='git-operations-empty'>No operations yet.</div>
                    ) : [...operationGroups].map(([repositoryId, repositoryOperations]) => {
                        const repository = repositoriesById.get(repositoryId);
                        return (
                            <section className='studio-git-operations__repository' key={repositoryId}>
                                <div className='studio-git-operations__repository-header'>
                                    <strong className='studio-git-operations__repository-label'>{repository?.label ?? 'Legacy operations'}</strong>
                                    <span
                                        className='studio-git-operations__repository-path'
                                        title={repository?.workspaceRelativeRoot ?? 'unknown repository'}
                                    >
                                        {repository?.workspaceRelativeRoot ?? 'unknown repository'}
                                    </span>
                                    {repository ? (
                                        <span className='studio-git-operations__repository-branch'>{repository.git.branch ?? 'no branch'}</span>
                                    ) : undefined}
                                    {repository ? (
                                        <span className='studio-git-operations__repository-mode'>{repository.git.mode}</span>
                                    ) : undefined}
                                    {repository && this.controller.isScmUnavailable(repository.repositoryId)
                                        ? <span className='studio-git-operations__repository-status'>SCM unavailable</span>
                                        : undefined}
                                    {repository && !repository.git.publishEnabled
                                        ? <span className='studio-git-operations__repository-status'>{repository.git.disabledReason ?? 'publish disabled'}</span>
                                        : undefined}
                                </div>
                                {repositoryOperations.map(operation => {
                                    const retryable = operation.state === 'push-pending' || operation.state === 'blocked' || operation.state === 'failed';
                                    return (
                                        <div
                                            key={operation.operationId}
                                            className='studio-git-operations__row'
                                            data-testid={`git-operation-row-${operation.operationId}`}
                                        >
                                            <div className='studio-git-operations__main'>
                                                <span className='studio-git-operations__path'>{operation.repositoryRelativePath}</span>
                                                <span
                                                    className={`studio-git-operations__badge studio-git-operations__badge--${operation.state}`}
                                                    data-testid={`git-operation-state-${operation.operationId}`}
                                                >
                                                    {operation.state}
                                                </span>
                                            </div>
                                            {operation.failureReason ? (
                                                <div className='studio-git-operations__detail'>{operation.failureReason}</div>
                                            ) : undefined}
                                            {retryable ? (
                                                <button
                                                    className='theia-button secondary'
                                                    data-testid={`git-operation-retry-${operation.operationId}`}
                                                    onClick={() => void this.controller.retryOperation(operation.operationId)}
                                                >
                                                    Retry
                                                </button>
                                            ) : undefined}
                                        </div>
                                    );
                                })}
                            </section>
                        );
                    })}
                </div>
            </div>
        );
    }
}
