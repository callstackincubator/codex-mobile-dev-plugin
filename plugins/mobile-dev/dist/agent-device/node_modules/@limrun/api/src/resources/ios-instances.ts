// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import { APIResource } from '../core/resource';
import { APIPromise } from '../core/api-promise';
import { Items, type ItemsParams, PagePromise } from '../core/pagination';
import { buildHeaders } from '../internal/headers';
import { RequestOptions } from '../internal/request-options';
import { path } from '../internal/utils/path';

export class IosInstances extends APIResource {
  /**
   * Create an iOS instance
   */
  create(params: IosInstanceCreateParams, options?: RequestOptions): APIPromise<IosInstance> {
    const { reuseIfExists, wait, ...body } = params;
    return this._client.post('/v1/ios_instances', { query: { reuseIfExists, wait }, body, ...options });
  }

  /**
   * List iOS instances
   */
  list(
    query: IosInstanceListParams | null | undefined = {},
    options?: RequestOptions,
  ): PagePromise<IosInstancesItems, IosInstance> {
    return this._client.getAPIList('/v1/ios_instances', Items<IosInstance>, { query, ...options });
  }

  /**
   * Delete iOS instance with given name
   */
  delete(id: string, options?: RequestOptions): APIPromise<void> {
    return this._client.delete(path`/v1/ios_instances/${id}`, {
      ...options,
      headers: buildHeaders([{ Accept: '*/*' }, options?.headers]),
    });
  }

  /**
   * Get iOS instance with given ID
   */
  get(id: string, options?: RequestOptions): APIPromise<IosInstance> {
    return this._client.get(path`/v1/ios_instances/${id}`, options);
  }
}

export type IosInstancesItems = Items<IosInstance>;

export interface IosInstance {
  metadata: IosInstance.Metadata;

  spec: IosInstance.Spec;

  status: IosInstance.Status;
}

export namespace IosInstance {
  export interface Metadata {
    id: string;

    createdAt: string;

    organizationId: string;

    displayName?: string;

    labels?: { [key: string]: string };

    terminatedAt?: string;
  }

  export interface Spec {
    /**
     * After how many minutes of inactivity should the instance be terminated. Example
     * values 1m, 10m, 3h. Default is 3m. Providing "0" uses the organization's default
     * inactivity timeout.
     */
    inactivityTimeout: string;

    /**
     * The region where the instance will be created. If not given, will be decided
     * based on scheduling clues and availability.
     */
    region: string;

    /**
     * After how many minutes should the instance be terminated. Example values 1m,
     * 10m, 3h. Default is "0" which means no hard timeout.
     */
    hardTimeout?: string;
  }

  export interface Status {
    token: string;

    state: 'unknown' | 'creating' | 'assigned' | 'ready' | 'terminated';

    apiUrl?: string;

    endpointWebSocketUrl?: string;

    errorMessage?: string;

    mcpUrl?: string;

    sandbox?: Status.Sandbox;

    targetHttpPortUrlPrefix?: string;
  }

  export namespace Status {
    export interface Sandbox {
      xcode?: Sandbox.Xcode;
    }

    export namespace Sandbox {
      export interface Xcode {
        url?: string;
      }
    }
  }
}

export interface IosInstanceCreateParams {
  /**
   * Query param: If there is another instance with given labels and region, return
   * that one instead of creating a new instance.
   */
  reuseIfExists?: boolean;

  /**
   * Query param: Return after the instance is ready to connect.
   */
  wait?: boolean;

  /**
   * Body param
   */
  metadata?: IosInstanceCreateParams.Metadata;

  /**
   * Body param
   */
  spec?: IosInstanceCreateParams.Spec;
}

export namespace IosInstanceCreateParams {
  export interface Metadata {
    displayName?: string;

    labels?: { [key: string]: string };
  }

  export interface Spec {
    clues?: Array<Spec.Clue>;

    /**
     * After how many minutes should the instance be terminated. Example values 1m,
     * 10m, 3h. Default is "0" which means no hard timeout.
     */
    hardTimeout?: string;

    /**
     * After how many minutes of inactivity should the instance be terminated. Example
     * values 1m, 10m, 3h. Default is 3m. Providing "0" uses the organization's default
     * inactivity timeout.
     */
    inactivityTimeout?: string;

    initialAssets?: Array<Spec.InitialAsset>;

    /**
     * The model for the Apple Simulator. Default is iphone.
     */
    model?: 'iphone' | 'ipad' | 'watch';

    /**
     * The region where the instance will be created. If not given, will be decided
     * based on scheduling clues and availability.
     */
    region?: string;

    sandbox?: Spec.Sandbox;
  }

  export namespace Spec {
    export interface Clue {
      kind: 'ClientIP';

      clientIp?: string;
    }

    export interface InitialAsset {
      kind: 'App';

      source: 'URL' | 'AssetName' | 'AssetID';

      assetId?: string;

      assetName?: string;

      /**
       * Launch mode specifies how to launch the app after installation. If not given,
       * the app won't be launched.
       */
      launchMode?: 'ForegroundIfRunning' | 'RelaunchIfRunning';

      url?: string;
    }

    export interface Sandbox {
      xcode?: Sandbox.Xcode;
    }

    export namespace Sandbox {
      export interface Xcode {
        enabled?: boolean;
      }
    }
  }
}

export interface IosInstanceListParams extends ItemsParams {
  /**
   * Labels filter to apply to instances to return. Expects a comma-separated list of
   * key=value pairs (e.g., env=prod,region=us-west).
   */
  labelSelector?: string;

  /**
   * Region where the instance is scheduled on.
   */
  region?: string;

  /**
   * State filter to apply to Android instances to return. Each comma-separated state
   * will be used as part of an OR clause, e.g. "assigned,ready" will return all
   * instances that are either assigned or ready.
   *
   * Valid states: creating, assigned, ready, terminated, unknown
   */
  state?: string;
}

export declare namespace IosInstances {
  export {
    type IosInstance as IosInstance,
    type IosInstancesItems as IosInstancesItems,
    type IosInstanceCreateParams as IosInstanceCreateParams,
    type IosInstanceListParams as IosInstanceListParams,
  };
}
