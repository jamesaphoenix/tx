import { docs } from '@/.source';
import { loader } from 'fumadocs-core/source';
import type { InferPageType, InferMetaType } from 'fumadocs-core/source';

// Workaround: fumadocs-mdx returns files as a function,
// but fumadocs-core expects an array
const fumadocsSource = docs.toFumadocsSource();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const filesArray = (fumadocsSource.files as any)();

export const source = loader({
  baseUrl: '/docs',
  source: { files: filesArray },
});

export type Page = InferPageType<typeof source>;
export type Meta = InferMetaType<typeof source>;
