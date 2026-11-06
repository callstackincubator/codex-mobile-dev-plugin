import { at } from './content.ts';
import type { SatteriProcessorOptions } from '@astrojs/markdown-satteri';

export const baseLinks: NonNullable<SatteriProcessorOptions['mdastPlugins']>[number] = {
  name: 'site-base-links',
  link(node, context) {
    if (node.url.startsWith('/') && node.url.startsWith('//') === false) {
      const url = at(node.url);
      context.setProperty(node, 'url', url);
    }
  },
  image(node, context) {
    if (node.url.startsWith('/') && node.url.startsWith('//') === false) {
      const url = at(node.url);
      context.setProperty(node, 'url', url);
    }
  },
  definition(node, context) {
    if (node.url.startsWith('/') && node.url.startsWith('//') === false) {
      const url = at(node.url);
      context.setProperty(node, 'url', url);
    }
  },
};
