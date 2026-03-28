import { source } from '@/lib/source';
import { createFromSource } from 'fumadocs-core/search/server';

export const runtime = 'nodejs';

const searchApi = createFromSource(source);

export async function GET(request: Request) {
  return searchApi.GET(request);
}
