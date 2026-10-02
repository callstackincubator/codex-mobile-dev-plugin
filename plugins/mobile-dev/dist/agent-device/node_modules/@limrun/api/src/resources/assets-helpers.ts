import { basename } from 'path';
import { createHash } from 'crypto';
import { promises as fs } from 'fs';

import { RequestOptions } from '../internal/request-options';
import { nodeProxyTransport } from '../internal/proxy-transport';
import { Assets as GeneratedAssets } from './assets';

export interface AssetGetOrUploadParams {
  /**
   * The path to the file to upload.
   */
  path: string;

  /**
   * The name for the asset. Defaults to the name of the file given in the filePath parameter.
   */
  name?: string;
}

export interface AssetGetOrUploadResponse {
  id: string;
  name: string;
  signedDownloadUrl: string;
  md5: string;
}

export class Assets extends GeneratedAssets {
  async getOrUpload(
    body: AssetGetOrUploadParams,
    options?: RequestOptions,
  ): Promise<AssetGetOrUploadResponse> {
    const creationResponse = await this.getOrCreate(
      {
        name: body.name ?? basename(body.path),
      },
      options,
    );
    const data = await fs.readFile(body.path);
    const md5 = createHash('md5').update(data).digest('hex');
    if (creationResponse.md5 && creationResponse.md5 === md5) {
      return {
        id: creationResponse.id,
        name: creationResponse.name,
        signedDownloadUrl: creationResponse.signedDownloadUrl,
        md5: creationResponse.md5,
      };
    }
    const uploadResponse = await nodeProxyTransport.fetch(creationResponse.signedUploadUrl, {
      headers: {
        'Content-Length': data.length.toString(),
        'Content-Type': 'application/octet-stream',
      },
      method: 'PUT',
      body: data,
    });
    if (uploadResponse.status !== 200) {
      throw new Error(`Failed to upload asset: ${uploadResponse.status} ${await uploadResponse.text()}`);
    }
    return {
      id: creationResponse.id,
      name: creationResponse.name,
      signedDownloadUrl: creationResponse.signedDownloadUrl,
      md5,
    };
  }
}
