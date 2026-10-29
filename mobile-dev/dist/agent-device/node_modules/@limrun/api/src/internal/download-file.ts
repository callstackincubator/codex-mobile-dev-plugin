import fs from 'fs';
import path from 'path';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';

import { nodeProxyTransport } from './proxy-transport';

export async function downloadFileToLocalPath(url: string, token: string, localPath: string): Promise<void> {
  const maxRetries = 3;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const response = await nodeProxyTransport.fetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!response.ok) {
      const errorBody = await response.text();
      const isRetriable = response.status >= 500 && response.status < 600;
      if (isRetriable && attempt < maxRetries) {
        continue;
      }
      throw new Error(`Download failed: ${response.status} ${errorBody}`);
    }
    if (!response.body) {
      throw new Error('Download failed: response body is missing');
    }
    await fs.promises.mkdir(path.dirname(localPath), { recursive: true });
    await pipeline(Readable.fromWeb(response.body as any), fs.createWriteStream(localPath));
    return;
  }
}
