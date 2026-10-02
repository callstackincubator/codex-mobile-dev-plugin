import type { Agent as HttpAgent } from 'http';

import { HttpsProxyAgent } from 'https-proxy-agent';
import { getProxyForUrl } from 'proxy-from-env';
import { EnvHttpProxyAgent } from 'undici';

import type { Fetch } from './builtin-types';

class NodeProxyTransport {
  private envHttpProxyAgent: EnvHttpProxyAgent | undefined;
  private websocketAgents = new Map<string, HttpAgent>();

  fetch: Fetch = async (input, init) => {
    if (!this.hasProxyEnv()) {
      return fetch(input, init);
    }

    return (fetch as any)(input, {
      ...(init ?? {}),
      dispatcher: this.getEnvHttpProxyAgent(),
    });
  };

  getWebSocketAgent(url: string): HttpAgent | undefined {
    if (!this.hasProxyEnv()) {
      return undefined;
    }

    const proxyUrl = getProxyForUrl(this.getWebSocketProxyLookupUrl(url));
    if (!proxyUrl) {
      return undefined;
    }

    let agent = this.websocketAgents.get(proxyUrl);
    if (!agent) {
      const createdAgent = new HttpsProxyAgent(proxyUrl);
      this.websocketAgents.set(proxyUrl, createdAgent);
      agent = createdAgent;
    }

    return agent;
  }

  private getEnvHttpProxyAgent(): EnvHttpProxyAgent {
    this.envHttpProxyAgent ??= new EnvHttpProxyAgent();
    return this.envHttpProxyAgent;
  }

  private hasProxyEnv(): boolean {
    if (typeof process === 'undefined' || !process.versions?.node) {
      return false;
    }

    const env = process.env;
    return !!(env['http_proxy'] || env['HTTP_PROXY'] || env['https_proxy'] || env['HTTPS_PROXY']);
  }

  private getWebSocketProxyLookupUrl(url: string): string {
    const lookupUrl = new URL(url);
    if (lookupUrl.protocol === 'ws:') {
      lookupUrl.protocol = 'http:';
    } else if (lookupUrl.protocol === 'wss:') {
      lookupUrl.protocol = 'https:';
    }
    return lookupUrl.toString();
  }
}

export const nodeProxyTransport = new NodeProxyTransport();
