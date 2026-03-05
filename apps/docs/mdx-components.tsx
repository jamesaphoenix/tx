import defaultMdxComponents from 'fumadocs-ui/mdx';
import { Tab, Tabs } from 'fumadocs-ui/components/tabs';
import type { MDXComponents } from 'mdx/types';
import { Mermaid } from '@/components/mermaid';

export function getMDXComponents(
  components?: MDXComponents
): MDXComponents {
  return {
    ...defaultMdxComponents,
    Mermaid,
    Tab,
    Tabs,
    ...components,
  };
}

export function useMDXComponents(
  components: MDXComponents
): MDXComponents {
  return getMDXComponents(components);
}
