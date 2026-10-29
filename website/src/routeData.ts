// Route data for docs pages: a meta description per page, and BreadcrumbList structured data.
// Every docs page supplies its own description in frontmatter.
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

import { docs, site as meta } from './site/content';
import { fullTitle } from './site/meta';

export const onRequest = defineRouteMiddleware((context) => {
  const route = context.locals.starlightRoute;
  const { entry, head } = route;
  const site = meta.url;

  // The same social titles as the landing pages (Site.astro): og:title is the full title, not the
  // page title alone, and Twitter gets its own title and description too.
  const title = fullTitle(entry.data.title);
  for (const tag of head) {
    if (tag.tag === 'meta' && tag.attrs?.property === 'og:title') tag.attrs.content = title;
  }
  head.push({ tag: 'meta', attrs: { name: 'twitter:title', content: title } });

  // Pages are built as files (`build.format: 'file'`), so Starlight's canonical and og:url end
  // in .html; Vercel serves them without it (`cleanUrls`), so point both at the clean URL.
  for (const tag of head) {
    if (
      tag.tag === 'link' &&
      tag.attrs?.rel === 'canonical' &&
      typeof tag.attrs.href === 'string'
    ) {
      tag.attrs.href = tag.attrs.href.replace(/\.html$/, '');
    }
    if (
      tag.tag === 'meta' &&
      tag.attrs?.property === 'og:url' &&
      typeof tag.attrs.content === 'string'
    ) {
      tag.attrs.content = tag.attrs.content.replace(/\.html$/, '');
    }
  }

  // After the description is settled above, so Twitter shows the same one as search and og.
  head.push({
    tag: 'meta',
    attrs: { name: 'twitter:description', content: entry.data.description },
  });

  // The product, Docs, this page. Sidebar groups have no page of their own, and every breadcrumb
  // but the last needs a URL, so they are left out.
  const pagePath = context.url.pathname.replace(/\.html$/, '');
  const docsUrl = new URL(docs.intro, site);
  const pageUrl = new URL(pagePath, site);
  const items = [
    { name: meta.name, item: site },
    { name: 'Docs', item: docsUrl.href },
    {
      name: entry.data.title,
      item: pageUrl.href,
    },
  ];
  const itemListElement = items.map((it, i) => ({ '@type': 'ListItem', position: i + 1, ...it }));
  const breadcrumbs = JSON.stringify({
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement,
  });
  head.push({
    tag: 'script',
    attrs: { type: 'application/ld+json' },
    content: breadcrumbs,
  });
});
