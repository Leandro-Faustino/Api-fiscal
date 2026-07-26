export interface SerproHttpRequest {
  url: string;
  method: 'POST';
  headers: Record<string, string>;
  body: string;
  timeoutMs: number;
  pfx?: Buffer;
  passphrase?: string;
}

export interface SerproHttpResponse {
  status: number;
  headers: Record<string, string>;
  body: string;
}

export interface SerproHttpTransport {
  request(input: SerproHttpRequest): Promise<SerproHttpResponse>;
}
