import { createJevProvider } from '@volit/jev';
import { createVolitExtension } from './extension.ts';
import type { Api } from './host.ts';

export default function volit(api: Api): void {
  api.registerFlag('volit-endpoint', { type: 'string', description: 'Explicit Jev destination override; HTTPS or loopback HTTP, never read from project configuration' });
  createVolitExtension({
    createProvider: () => {
      const endpoint = api.getFlag('volit-endpoint');
      return createJevProvider({
        apiKey: process.env.VOLIT_JEV_API_KEY ?? process.env.TYPESAFE_API_KEY ?? '',
        ...(typeof endpoint === 'string' ? { endpoint } : {}),
      });
    },
  })(api);
}
