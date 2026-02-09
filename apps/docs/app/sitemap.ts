import type { MetadataRoute } from 'next';
import { source } from '@/lib/source';

const baseUrl = 'https://txdocs.dev';

export default function sitemap(): MetadataRoute.Sitemap {
  const pages = source
    .getPages()
    .filter((page) => !page.url.startsWith('/docs/prd/') && !page.url.startsWith('/docs/design/'))
    .map((page) => ({
      url: `${baseUrl}${page.url}`,
      lastModified: new Date(),
      changeFrequency: 'weekly' as const,
    }));

  return [
    {
      url: baseUrl,
      lastModified: new Date(),
      changeFrequency: 'weekly',
    },
    ...pages,
  ];
}
