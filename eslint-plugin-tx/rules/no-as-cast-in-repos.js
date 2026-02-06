/**
 * @fileoverview ESLint rule that bans unsafe 'as' type assertions in repo and mapper code
 *
 * At the database boundary, 'as Type' casts bypass runtime validation. If the DB contains
 * bad data, the cast silently produces an invalid object. Use runtime validators
 * (Schema.decode, type guards) instead.
 *
 * Detection patterns:
 * - row.status as TaskStatus
 * - db.prepare(...).get(...) as TaskRow
 * - row.id as TaskId
 *
 * Allowed:
 * - 'as const' (readonly assertion, always safe)
 * - 'as unknown' (intermediate narrowing, configurable)
 *
 * Scoped to: packages/core/src/repo/, packages/core/src/mappers/ (configurable)
 */

const DEFAULT_ENFORCE_PATHS = ['repo/', 'mappers/'];
const DEFAULT_ALLOWED_TYPES = ['unknown'];

/**
 * Extract a human-readable type name from a type annotation AST node
 * @param {object} typeAnnotation - The AST type annotation node
 * @returns {string}
 */
function getTypeName(typeAnnotation) {
  if (!typeAnnotation) return 'type';

  // TSTypeReference: named types like TaskRow, TaskId
  if (typeAnnotation.type === 'TSTypeReference') {
    if (typeAnnotation.typeName?.type === 'TSQualifiedName') {
      const left = typeAnnotation.typeName.left?.name || '';
      const right = typeAnnotation.typeName.right?.name || '';
      return `${left}.${right}`;
    }
    const baseName = typeAnnotation.typeName?.name || 'type';
    if (typeAnnotation.typeArguments?.params?.length) {
      const params = typeAnnotation.typeArguments.params.map(getTypeName).join(', ');
      return `${baseName}<${params}>`;
    }
    // Also check legacy 'typeParameters' field
    if (typeAnnotation.typeParameters?.params?.length) {
      const params = typeAnnotation.typeParameters.params.map(getTypeName).join(', ');
      return `${baseName}<${params}>`;
    }
    return baseName;
  }

  // Union types: TaskRow | undefined
  if (typeAnnotation.type === 'TSUnionType') {
    return typeAnnotation.types.map(getTypeName).join(' | ');
  }

  // Intersection types: A & B
  if (typeAnnotation.type === 'TSIntersectionType') {
    return typeAnnotation.types.map(getTypeName).join(' & ');
  }

  // Array types: string[]
  if (typeAnnotation.type === 'TSArrayType') {
    return `${getTypeName(typeAnnotation.elementType)}[]`;
  }

  // Keyword types
  if (typeAnnotation.type === 'TSStringKeyword') return 'string';
  if (typeAnnotation.type === 'TSNumberKeyword') return 'number';
  if (typeAnnotation.type === 'TSBooleanKeyword') return 'boolean';
  if (typeAnnotation.type === 'TSUndefinedKeyword') return 'undefined';
  if (typeAnnotation.type === 'TSNullKeyword') return 'null';
  if (typeAnnotation.type === 'TSAnyKeyword') return 'any';
  if (typeAnnotation.type === 'TSUnknownKeyword') return 'unknown';
  if (typeAnnotation.type === 'TSVoidKeyword') return 'void';
  if (typeAnnotation.type === 'TSNeverKeyword') return 'never';

  return 'type';
}

/**
 * Check if a type assertion is in the allowed list
 * @param {object} typeAnnotation - The AST type annotation node
 * @param {string[]} allowedTypes - Allowed type names
 * @returns {boolean}
 */
function isAllowedCast(typeAnnotation, allowedTypes) {
  if (!typeAnnotation) return false;

  // Always allow 'as const' - readonly assertion, not a type cast
  if (typeAnnotation.type === 'TSTypeReference' &&
      typeAnnotation.typeName?.name === 'const') {
    return true;
  }

  // Check keyword types (as unknown, as any, as never, etc.)
  const keywordMap = {
    'TSUnknownKeyword': 'unknown',
    'TSAnyKeyword': 'any',
    'TSNeverKeyword': 'never',
    'TSStringKeyword': 'string',
    'TSNumberKeyword': 'number',
    'TSBooleanKeyword': 'boolean',
    'TSVoidKeyword': 'void'
  };

  const keywordName = keywordMap[typeAnnotation.type];
  if (keywordName && allowedTypes.includes(keywordName)) {
    return true;
  }

  // Check named type references (e.g., custom allowed types)
  if (typeAnnotation.type === 'TSTypeReference' &&
      typeAnnotation.typeName?.name &&
      allowedTypes.includes(typeAnnotation.typeName.name)) {
    return true;
  }

  return false;
}

/** @type {import('eslint').Rule.RuleModule} */
export default {
  meta: {
    type: 'suggestion',
    docs: {
      description: 'Disallow unsafe "as" type assertions in repo and mapper code (use runtime validation instead)',
      category: 'Best Practices',
      recommended: true
    },
    messages: {
      noAsCast: 'Unsafe "as {{typeName}}" assertion in DB boundary code. Use runtime validation (Schema.decode, type guard) instead.'
    },
    schema: [
      {
        type: 'object',
        properties: {
          enforcePaths: {
            type: 'array',
            items: { type: 'string' },
            description: 'Path patterns where the rule is enforced (e.g. "repo/", "mappers/")'
          },
          allowedTypes: {
            type: 'array',
            items: { type: 'string' },
            description: 'Type names allowed for as-casts (e.g. "unknown"). "const" is always allowed.'
          }
        },
        additionalProperties: false
      }
    ]
  },

  create(context) {
    const options = context.options[0] || {};
    const enforcePaths = options.enforcePaths || DEFAULT_ENFORCE_PATHS;
    const allowedTypes = options.allowedTypes || DEFAULT_ALLOWED_TYPES;

    const filename = (context.filename || context.getFilename?.() || '').replace(/\\/g, '/');

    // Only enforce in configured paths
    const shouldCheck = enforcePaths.some(p => filename.includes(p));
    if (!shouldCheck) return {};

    return {
      TSAsExpression(node) {
        const typeAnnotation = node.typeAnnotation;

        if (isAllowedCast(typeAnnotation, allowedTypes)) {
          return;
        }

        const typeName = getTypeName(typeAnnotation);

        context.report({
          node,
          messageId: 'noAsCast',
          data: { typeName }
        });
      }
    };
  }
};
