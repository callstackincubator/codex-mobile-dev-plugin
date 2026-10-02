// File generated from our OpenAPI spec by Stainless. See CONTRIBUTING.md for details.

import type { Limrun } from '../client';

export abstract class APIResource {
  protected _client: Limrun;

  constructor(client: Limrun) {
    this._client = client;
  }
}
