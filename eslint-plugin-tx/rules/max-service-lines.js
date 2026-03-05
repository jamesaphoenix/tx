/**
 * @fileoverview ESLint rule that warns/errors when service files grow too large.
 */

import path from 'path';

const DEFAULT_PATHS = ['services/', 'repo/'];
const DEFAULT_WARN_AT = 500;
const DEFAULT_ERROR_AT = 1000;
const DEFAULT_IGNORE_FILE_NAMES = new Set([
  'index.ts',
  'index.tsx',
  'index.js',
  'index.jsx',
  'index.mjs',
  'index.cjs'
]);

function normalizeThresholds(options) {
  const warnCandidate = Number.isFinite(options.warnAt) ? Number(options.warnAt) : DEFAULT_WARN_AT;
  const errorCandidate = Number.isFinite(options.errorAt) ? Number(options.errorAt) : DEFAULT_ERROR_AT;
  const warnAt = Math.max(1, Math.trunc(Math.min(warnCandidate, errorCandidate)));
  const errorAt = Math.max(1, Math.trunc(Math.max(warnCandidate, errorCandidate)));
  return { warnAt, errorAt };
}

function normalizePathSegment(segment) {
  return String(segment)
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\//, '')
    .replace(/\/+$/, '') + '/';
}

function isTopLevelEntrypoint(relPath, enforcePaths) {
  for (const rawSegment of enforcePaths) {
    const segment = normalizePathSegment(rawSegment);
    const segmentIndex = relPath.indexOf(segment);
    if (segmentIndex === -1) continue;

    const relativeWithinSegment = relPath.slice(segmentIndex + segment.length);
    if (!relativeWithinSegment || relativeWithinSegment.includes('/')) {
      continue;
    }

    if (DEFAULT_IGNORE_FILE_NAMES.has(relativeWithinSegment)) {
      continue;
    }

    return true;
  }

  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Warn when service/repo files are too large and should be decomposed',
      category: 'Best Practices',
      recommended: true
    },
    schema: [
      {
        type: 'object',
        properties: {
          warnAt: {
            type: 'number',
            minimum: 1
          },
          errorAt: {
            type: 'number',
            minimum: 1
          },
          paths: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        additionalProperties: false
      }
    ],
    messages: {
      warnLimit: 'Service file has {{lineCount}} lines (limit: {{limit}}). Consider decomposing into a folder module.',
      errorLimit: 'Service file has {{lineCount}} lines (limit: {{limit}}). Consider decomposing into a folder module.'
    }
  },

  create(context) {
    const options = context.options[0] || {};
    const { warnAt, errorAt } = normalizeThresholds(options);
    const enforcePaths = Array.isArray(options.paths) && options.paths.length > 0
      ? options.paths
      : DEFAULT_PATHS;

    const filename = context.filename || context.getFilename();
    const fallbackCwd = typeof globalThis.process?.cwd === 'function' ? globalThis.process.cwd() : '';
    const cwd = context.cwd || context.getCwd?.() || fallbackCwd;
    const relPath = path.relative(cwd, filename).replace(/\\/g, '/');

    const ext = path.extname(filename).toLowerCase();
    if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(ext)) {
      return {};
    }

    if (!isTopLevelEntrypoint(relPath, enforcePaths)) {
      return {};
    }

    return {
      Program(node) {
        const sourceCode = context.sourceCode || context.getSourceCode?.();
        const lineCount = sourceCode?.lines?.length ?? 0;

        if (lineCount > errorAt) {
          context.report({
            node,
            messageId: 'errorLimit',
            data: {
              lineCount: String(lineCount),
              limit: String(errorAt)
            }
          });
          return;
        }

        if (lineCount > warnAt) {
          context.report({
            node,
            messageId: 'warnLimit',
            data: {
              lineCount: String(lineCount),
              limit: String(warnAt)
            }
          });
        }
      }
    };
  }
};
