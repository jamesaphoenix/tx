/**
 * @fileoverview Warn when top-level service sidecars should live under an owner folder.
 */

import path from 'node:path';
import { existsSync, readFileSync, readdirSync } from 'node:fs';

const REPO_ROOT_MARKERS = ['.git', 'turbo.json'];
const repoRootCache = new Map();
const DEFAULT_PATHS = ['packages/core/src/services/'];
const DEFAULT_SIDECAR_SUFFIXES = [
  'from-files',
  'shared',
  'helpers',
  'internals',
  'live',
  'runtime',
  'patterns',
  'process',
  'templates',
  'validation',
  'ops',
  'state',
  'deps',
  'factory',
  'read',
  'write'
];
const INDEX_FILE_NAMES = ['index.ts', 'index.tsx', 'index.js', 'index.jsx', 'index.mjs', 'index.cjs'];

const normalizePath = (value) => value.replace(/\\/g, '/');

const findRepoRoot = (absoluteFile) => {
  const cached = repoRootCache.get(absoluteFile);
  if (cached) return cached;

  let current = path.dirname(absoluteFile);
  while (true) {
    if (REPO_ROOT_MARKERS.some((marker) => existsSync(path.join(current, marker)))) {
      repoRootCache.set(absoluteFile, current);
      return current;
    }

    const parent = path.dirname(current);
    if (parent === current) {
      const fallback = process.cwd();
      repoRootCache.set(absoluteFile, fallback);
      return fallback;
    }
    current = parent;
  }
};

const toRepoRelativePath = (absoluteFile) => {
  const repoRoot = normalizePath(findRepoRoot(absoluteFile));
  const normalizedFile = normalizePath(absoluteFile);

  if (normalizedFile === repoRoot) return '';
  if (!normalizedFile.startsWith(`${repoRoot}/`)) return normalizedFile;

  return normalizedFile.slice(repoRoot.length + 1);
};

const normalizeConfiguredPath = (value) =>
  normalizePath(String(value).replace(/^\.\//, '')).replace(/\/+$/, '') + '/';

const isWithinConfiguredTopLevel = (repoRelativeFile, configuredPaths) => {
  const normalizedFile = normalizePath(repoRelativeFile);
  const dirName = path.posix.dirname(normalizedFile);

  for (const rawPath of configuredPaths) {
    const configuredPath = normalizeConfiguredPath(rawPath);
    if (!normalizedFile.startsWith(configuredPath)) continue;
    const expectedDir = configuredPath.slice(0, -1);
    if (dirName === expectedDir) {
      return true;
    }
  }

  return false;
};

const findMatchingSuffix = (baseName, sidecarSuffixes) => {
  const orderedSuffixes = [...sidecarSuffixes].sort((a, b) => b.length - a.length);
  return orderedSuffixes.find((suffix) => baseName.endsWith(`-${suffix}`)) ?? null;
};

const resolveOwnerFile = (stem, siblingFilesByBaseName) => {
  if (siblingFilesByBaseName.has(stem)) return siblingFilesByBaseName.get(stem);

  const serviceOwner = `${stem}-service`;
  if (siblingFilesByBaseName.has(serviceOwner)) return siblingFilesByBaseName.get(serviceOwner);

  return null;
};

const isExportedFromSiblingIndex = (absoluteFile, fileName) => {
  for (const indexFileName of INDEX_FILE_NAMES) {
    const indexFile = path.join(path.dirname(absoluteFile), indexFileName);
    if (!existsSync(indexFile)) {
      continue;
    }

    const source = readFileSync(indexFile, 'utf-8');
    const escapedFileName = fileName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (new RegExp(`from\\s+["']\\./${escapedFileName.replace(/\\.ts$/, '.js')}["']`).test(source)) {
      return true;
    }
  }
  return false;
};

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Prefer placing service sidecar modules under an owner folder',
      category: 'Best Practices',
      recommended: false
    },
    schema: [
      {
        type: 'object',
        properties: {
          paths: {
            type: 'array',
            items: { type: 'string' }
          },
          sidecarSuffixes: {
            type: 'array',
            items: { type: 'string' }
          }
        },
        additionalProperties: false
      }
    ],
    messages: {
      preferFolder: "Move '{{fileName}}' under '{{ownerFolder}}/' and keep '{{ownerFile}}' as the public entrypoint."
    }
  },

  create(context) {
    const fileNameRaw = typeof context.getFilename === 'function'
      ? context.getFilename()
      : context.filename;
    if (!fileNameRaw || fileNameRaw === '<input>' || fileNameRaw === '<text>') {
      return {};
    }

    const absoluteFile = normalizePath(path.resolve(fileNameRaw));
    const repoRelativeFile = toRepoRelativePath(absoluteFile);
    const options = context.options[0] ?? {};
    const configuredPaths = Array.isArray(options.paths) && options.paths.length > 0
      ? options.paths
      : DEFAULT_PATHS;
    const sidecarSuffixes = Array.isArray(options.sidecarSuffixes) && options.sidecarSuffixes.length > 0
      ? options.sidecarSuffixes
      : DEFAULT_SIDECAR_SUFFIXES;

    if (!isWithinConfiguredTopLevel(repoRelativeFile, configuredPaths)) {
      return {};
    }

    const extension = path.posix.extname(repoRelativeFile).toLowerCase();
    if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(extension)) {
      return {};
    }

    const fileName = path.posix.basename(repoRelativeFile);
    if (fileName.startsWith('index.')) {
      return {};
    }

    if (isExportedFromSiblingIndex(absoluteFile, fileName)) {
      return {};
    }

    const baseName = path.posix.basename(repoRelativeFile, extension);
    const matchedSuffix = findMatchingSuffix(baseName, sidecarSuffixes);
    if (!matchedSuffix) {
      return {};
    }

    const stem = baseName.slice(0, -(matchedSuffix.length + 1));
    if (!stem) {
      return {};
    }

    const siblingFilesByBaseName = new Map();
    for (const entry of readdirSync(path.dirname(absoluteFile), { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const entryExtension = path.extname(entry.name).toLowerCase();
      if (!['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'].includes(entryExtension)) continue;
      siblingFilesByBaseName.set(path.basename(entry.name, entryExtension), entry.name);
    }

    const ownerFile = resolveOwnerFile(stem, siblingFilesByBaseName);
    if (!ownerFile) {
      return {};
    }

    const ownerBaseName = path.basename(ownerFile, path.extname(ownerFile));
    if (ownerBaseName === baseName) {
      return {};
    }

    return {
      Program(node) {
        context.report({
          node,
          messageId: 'preferFolder',
          data: {
            fileName,
            ownerFolder: ownerBaseName,
            ownerFile
          }
        });
      }
    };
  }
};
