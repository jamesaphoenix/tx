import type { BaseLayoutProps } from 'fumadocs-ui/layouts/shared';

/**
 * Base layout options shared across all layouts.
 * These options configure the navigation and links.
 */
export const baseOptions: BaseLayoutProps = {
  nav: {
    title: 'tx',
  },
  links: [
    {
      text: 'Documentation',
      url: '/docs',
      active: 'nested-url',
    },
    {
      text: 'GitHub',
      url: 'https://github.com/just-understanding-data/tx',
      external: true,
    },
  ],
};
