// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../core/resource';
import { APIPromise } from '../core/api-promise';
import { buildHeaders } from '../internal/headers';
import { RequestOptions } from '../internal/request-options';
import { path } from '../internal/utils/path';

export class Assets extends APIResource {
  /**
   * List organization's all assets with given filters. If none given, return all
   * assets.
   */
  list(
    query: AssetListParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<AssetListResponse> {
    return this._client.get('/v1/assets', { query, ...options });
  }

  /**
   * Delete the asset with given ID.
   */
  delete(assetID: string, options?: RequestOptions): APIPromise<void> {
    return this._client.delete(path`/v1/assets/${assetID}`, {
      ...options,
      headers: buildHeaders([{ Accept: '*/*' }, options?.headers]),
    });
  }

  /**
   * Get the asset with given ID.
   */
  get(
    assetID: string,
    query: AssetGetParams | null | undefined = {},
    options?: RequestOptions,
  ): APIPromise<Asset> {
    return this._client.get(path`/v1/assets/${assetID}`, { query, ...options });
  }

  /**
   * Creates an asset and returns upload and download URLs. If there is a
   * corresponding file uploaded in the storage with given name, its MD5 is returned
   * so you can check if a re-upload is necessary. If no MD5 is returned, then there
   * is no corresponding file in the storage so downloading it directly or using it
   * in instances will fail until you use the returned upload URL to submit the file.
   */
  getOrCreate(body: AssetGetOrCreateParams, options?: RequestOptions): APIPromise<AssetGetOrCreateResponse> {
    return this._client.put('/v1/assets', { body, ...options });
  }
}

export interface Asset {
  id: string;

  name: string;

  /**
   * Human-readable display name for the asset. If not set, the name should be used.
   */
  displayName?: string;

  /**
   * Returned only if there is a corresponding file uploaded already.
   */
  md5?: string;

  /**
   * The operating system this asset is for. If not set, the asset is available for
   * all platforms.
   */
  os?: 'ios' | 'android';

  signedDownloadUrl?: string;

  signedUploadUrl?: string;
}

export type AssetListResponse = Array<Asset>;

export interface AssetGetOrCreateResponse {
  id: string;

  name: string;

  signedDownloadUrl: string;

  signedUploadUrl: string;

  /**
   * Returned only if there is a corresponding file uploaded already.
   */
  md5?: string;
}

export interface AssetListParams {
  /**
   * If true, also includes assets from Limrun App Store where you have access to.
   * App Store assets will be returned with a "appstore/" prefix in their names.
   */
  includeAppStore?: boolean;

  /**
   * Toggles whether a download URL should be included in the response
   */
  includeDownloadUrl?: boolean;

  /**
   * Toggles whether an upload URL should be included in the response
   */
  includeUploadUrl?: boolean;

  /**
   * Maximum number of items to be returned. The default is 50.
   */
  limit?: number;

  /**
   * Query by file name
   */
  nameFilter?: string;
}

export interface AssetGetParams {
  /**
   * Toggles whether a download URL should be included in the response
   */
  includeDownloadUrl?: boolean;

  /**
   * Toggles whether an upload URL should be included in the response
   */
  includeUploadUrl?: boolean;
}

export interface AssetGetOrCreateParams {
  name: string;
}

export declare namespace Assets {
  export {
    type Asset as Asset,
    type AssetListResponse as AssetListResponse,
    type AssetGetOrCreateResponse as AssetGetOrCreateResponse,
    type AssetListParams as AssetListParams,
    type AssetGetParams as AssetGetParams,
    type AssetGetOrCreateParams as AssetGetOrCreateParams,
  };
}
