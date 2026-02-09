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
      text: 'llms.txt',
      url: '/llms.txt',
      external: true,
    },
    {
      text: 'GitHub',
      url: 'https://github.com/jamesaphoenix/tx',
      external: true,
    },
  ],
};
