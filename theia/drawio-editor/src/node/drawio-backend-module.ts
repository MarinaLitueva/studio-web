import { ContainerModule } from '@theia/core/shared/inversify';
import { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { DrawioRuntimeEndpoint } from './drawio-runtime-endpoint';

export default new ContainerModule(bind => {
    bind(DrawioRuntimeEndpoint).toSelf().inSingletonScope();
    bind(BackendApplicationContribution).toService(DrawioRuntimeEndpoint);
});
