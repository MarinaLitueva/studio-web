import { Endpoint } from '@theia/core/lib/browser/endpoint';
import { studioApiUrl } from './studio-api';

function location(pathname: string): Endpoint.Location {
    return {
        host: 'studio-dev-poc.cfabric.org',
        pathname,
        search: '',
        protocol: 'https:',
    };
}

describe('studioApiUrl', () => {
    it('keeps the Kubernetes IDE session path prefix', () => {
        expect(
            studioApiUrl(
                '/studio-artifact-ingest/v1/nodes?scope=project-1',
                location('/studio/349c7f25-2566-42eb-87a2-4b490bbbaab6/'),
            ),
        ).toBe(
            'https://studio-dev-poc.cfabric.org/studio/349c7f25-2566-42eb-87a2-4b490bbbaab6/' +
            'studio-api/studio-artifact-ingest/v1/nodes?scope=project-1',
        );
    });

    it('keeps the root endpoint for standalone sessions', () => {
        expect(studioApiUrl('/mini-chat/v1/chats', location('/'))).toBe(
            'https://studio-dev-poc.cfabric.org/studio-api/mini-chat/v1/chats',
        );
    });
});
