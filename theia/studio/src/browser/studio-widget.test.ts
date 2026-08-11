import 'reflect-metadata';
import { MessageService } from '@theia/core';
import { ContainerModule, Container } from '@theia/core/shared/inversify';
import { MessageLoop } from '@theia/core/shared/@lumino/messaging';
import * as React from '@theia/core/shared/react';
import { StudioWidget } from './studio-widget';

describe('StudioWidget', () => {

    let widget: StudioWidget;
    let messageService: Pick<MessageService, 'info'>;
    const reactActEnvironment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean };
    let previousReactActEnvironment: boolean | undefined;

    beforeAll(() => {
        previousReactActEnvironment = reactActEnvironment.IS_REACT_ACT_ENVIRONMENT;
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
    });

    beforeEach(() => {
        messageService = {
            info: jest.fn()
        };
        const module = new ContainerModule(bind => {
            bind(MessageService).toConstantValue(messageService as MessageService);
            bind(StudioWidget).toSelf();
        });
        const container = new Container();
        container.load(module);
        React.act(() => {
            widget = container.resolve<StudioWidget>(StudioWidget);
            MessageLoop.flush();
        });
    });

    afterEach(() => {
        React.act(() => {
            widget.dispose();
            MessageLoop.flush();
        });
    });

    afterAll(() => {
        reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = previousReactActEnvironment;
    });

    it('should render react node correctly', () => {
        expect(widget.node.textContent).toContain('Display Message');
    });

    it('should inject \'MessageService\'', () => {
        widget['displayMessage']();
        expect(messageService.info).toHaveBeenCalledWith('Congratulations: Studio Widget Successfully Created!');
    });

});
