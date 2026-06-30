/**
 * eslint-rules/no-unauth-tenant-id.mjs
 *
 * Custom ESLint rule: si un handler de route.ts extrae tenantId del cliente
 * (via headers.get('x-tenant-id') o searchParams.get('tenantId')) sin llamar
 * a requireTenantAccess / requireTenantRole en el mismo bloque funcional,
 * se emite un ERROR.
 *
 * Propósito: prevenir que vuelva a aparecer el patrón IDOR C-01/C-02 (ver
 * docs/security/audit-2026-06-30.md) donde tenantId era aceptado del cliente
 * sin validación de identidad JWT.
 *
 * Regla: "local/no-unauth-tenant-id" — severity ERROR en CI.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow trusting x-tenant-id header or ?tenantId= query param without calling requireTenantRole / requireTenantAccess in the same function body.",
      category: "Security",
      recommended: true,
      url: "docs/security/audit-2026-06-30.md#c-02",
    },
    messages: {
      unauthTenantId:
        "tenantId is read from client-controlled input ({{source}}) without a requireTenantRole / requireTenantAccess guard in the same handler. " +
        "Use identity.claims.tid after requireTenantRole/Access, or add the guard before any tenant-scoped operation. " +
        "See docs/security/audit-2026-06-30.md#c-01-c-02",
    },
    schema: [],
  },

  create(context) {
    /**
     * We flag any call expression that matches the unsafe patterns and is
     * *not* inside a function that also calls one of the safe guards.
     *
     * Strategy (intra-function, cheap, no CFG needed):
     *  1. Collect all function scopes.
     *  2. For each function, scan body for:
     *     a. Unsafe reads: .get('x-tenant-id') or .get('tenantId') via headers/searchParams.
     *     b. Safe guards: requireTenantAccess / requireTenantRole calls.
     *  3. If a function has (a) but NOT (b) → error on (a) nodes.
     */

    const UNSAFE_KEYS = new Set(["x-tenant-id", "tenantId"]);
    const SAFE_GUARDS = new Set([
      "requireTenantAccess",
      "requireTenantRole",
    ]);

    /** @param {import('estree').Node} node */
    function isUnsafeGet(node) {
      // node is a CallExpression: something.get("x-tenant-id") or .get("tenantId")
      if (node.type !== "CallExpression") return null;
      const { callee, arguments: args } = node;
      if (callee.type !== "MemberExpression") return null;
      if (callee.property.type !== "Identifier" || callee.property.name !== "get") return null;
      if (args.length < 1) return null;
      const arg = args[0];
      if (arg.type !== "Literal" || typeof arg.value !== "string") return null;
      if (!UNSAFE_KEYS.has(arg.value)) return null;
      return arg.value; // returns the key string
    }

    /** @param {import('estree').Node} node */
    function isGuardCall(node) {
      if (node.type !== "CallExpression") return false;
      const { callee } = node;
      if (callee.type === "Identifier" && SAFE_GUARDS.has(callee.name)) return true;
      if (callee.type === "MemberExpression" && callee.property.type === "Identifier" && SAFE_GUARDS.has(callee.property.name)) return true;
      return false;
    }

    /** Shallow-walk a function body collecting all CallExpressions */
    function collectCalls(node, calls = []) {
      if (!node || typeof node !== "object") return calls;
      if (node.type === "CallExpression") {
        calls.push(node);
      }
      // Recurse into children but don't cross nested function boundaries
      for (const key of Object.keys(node)) {
        if (key === "type" || key === "loc" || key === "range" || key === "parent") continue;
        const child = node[key];
        if (!child || typeof child !== "object") continue;
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object" && item.type) {
              // Don't recurse into nested functions (they have their own scope)
              if (!["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(item.type)) {
                collectCalls(item, calls);
              }
            }
          }
        } else if (child.type) {
          if (!["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"].includes(child.type)) {
            collectCalls(child, calls);
          }
        }
      }
      return calls;
    }

    function checkFunction(funcNode) {
      const body = funcNode.body;
      if (!body) return;

      const calls = collectCalls(body);
      const hasGuard = calls.some(isGuardCall);
      if (hasGuard) return; // safe

      for (const call of calls) {
        const key = isUnsafeGet(call);
        if (key) {
          context.report({
            node: call,
            messageId: "unauthTenantId",
            data: { source: key === "x-tenant-id" ? "headers.get('x-tenant-id')" : "searchParams.get('tenantId')" },
          });
        }
      }
    }

    return {
      FunctionDeclaration: checkFunction,
      FunctionExpression: checkFunction,
      ArrowFunctionExpression: checkFunction,
    };
  },
};

export default rule;
