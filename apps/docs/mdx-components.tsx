import defaultMdxComponents from 'fumadocs-ui/mdx';

type MDXComponents = typeof defaultMdxComponents;

export function getMDXComponents(
  components?: Partial<MDXComponents>
): MDXComponents {
  return {
    ...defaultMdxComponents,
    ...components,
  };
}

export function useMDXComponents(
  components: Partial<MDXComponents>
): MDXComponents {
  return getMDXComponents(components);
}
