import { notFound } from 'next/navigation';
import { DocsPage, DocsBody } from 'fumadocs-ui/page';
import { source } from '@/lib/source';
import { getMDXComponents } from '@/mdx-components';
import type { Metadata } from 'next';
import type { TOCItemType } from 'fumadocs-core/toc';
import type { FC, ComponentProps } from 'react';

interface PageProps {
  params: Promise<{ slug?: string[] }>;
}

// Type for MDX page data that includes body and toc
interface MDXPageData {
  title: string;
  description?: string;
  body: FC<ComponentProps<'div'> & { components?: Record<string, unknown> }>;
  toc: TOCItemType[];
}

export default async function Page(props: PageProps) {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) notFound();

  // Type assertion for MDX data
  const data = page.data as unknown as MDXPageData;
  const Mdx = data.body;

  return (
    <DocsPage
      toc={data.toc}
      footer={{ enabled: false }}
      breadcrumb={{ enabled: false }}
    >
      <DocsBody>
        <h1>{data.title}</h1>
        <p className="text-fd-muted-foreground mb-8 text-lg">
          {data.description}
        </p>
        <Mdx components={getMDXComponents()} />
      </DocsBody>
    </DocsPage>
  );
}

export async function generateStaticParams() {
  return source.generateParams();
}

export async function generateMetadata(props: PageProps): Promise<Metadata> {
  const params = await props.params;
  const page = source.getPage(params.slug);

  if (!page) notFound();

  return {
    title: page.data.title,
    description: page.data.description,
  };
}
