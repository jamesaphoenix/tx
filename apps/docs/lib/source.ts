import { docs } from '@/.source/server';
import { loader } from 'fumadocs-core/source';
import type { InferPageType, InferMetaType } from 'fumadocs-core/source';

export const source = loader({
  baseUrl: '/docs',
  source: docs.toFumadocsSource(),
});

export type Page = InferPageType<typeof source>;
export type Meta = InferMetaType<typeof source>;
