import { request } from 'node:https';
import type {
  SerproHttpRequest,
  SerproHttpResponse,
  SerproHttpTransport,
} from '../../application/ports/serpro-http-transport.js';

const MAX_RESPONSE_BYTES = 16 * 1024 * 1024;

export class NativeSerproHttpTransport implements SerproHttpTransport {
  public async request(input: SerproHttpRequest): Promise<SerproHttpResponse> {
    const url = new URL(input.url);
    if (url.protocol !== 'https:') {
      throw new Error('O transporte SERPRO exige HTTPS.');
    }

    return new Promise<SerproHttpResponse>((resolve, reject) => {
      const requestBody = Buffer.from(input.body, 'utf8');
      const clientRequest = request(
        url,
        {
          method: input.method,
          headers: {
            ...input.headers,
            'content-length': String(requestBody.length),
          },
          pfx: input.pfx,
          passphrase: input.passphrase,
          minVersion: 'TLSv1.2',
          rejectUnauthorized: true,
        },
        (response) => {
          const chunks: Buffer[] = [];
          let receivedBytes = 0;

          response.on('data', (chunk: Buffer) => {
            receivedBytes += chunk.length;
            if (receivedBytes > MAX_RESPONSE_BYTES) {
              clientRequest.destroy(
                new Error('A resposta do SERPRO excedeu o limite permitido.'),
              );
              return;
            }
            chunks.push(chunk);
          });

          response.on('end', () => {
            const headers: Record<string, string> = {};
            for (const [name, value] of Object.entries(response.headers)) {
              if (Array.isArray(value)) {
                headers[name] = value.join(', ');
              } else if (value !== undefined) {
                headers[name] = String(value);
              }
            }
            resolve({
              status: response.statusCode ?? 0,
              headers,
              body: Buffer.concat(chunks).toString('utf8'),
            });
          });
        },
      );

      clientRequest.setTimeout(input.timeoutMs, () => {
        clientRequest.destroy(new Error('Tempo limite do SERPRO excedido.'));
      });
      clientRequest.once('error', reject);
      clientRequest.end(requestBody);
    });
  }
}
