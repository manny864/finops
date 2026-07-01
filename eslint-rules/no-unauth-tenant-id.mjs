/**
 * eslint-rules/no-unauth-tenant-id.mjs
 *
 * Custom ESLint rule: si un HANDLER HTTP de route.ts (GET/POST/PUT/PATCH/DELETE/
 * HEAD/OPTIONS) extrae tenantId del cliente (via headers.get('x-tenant-id') o
 * searchParams.get('tenantId')) directamente en su cuerpo sin un guard de auth
 * en el mismo handler, se emite un ERROR.
 *
 * Guards reconocidos: requireTenantAccess, requireTenantRole, requireSuperAdmin,
 * requireRequestIdentity.
 *
 * Reglas de exención (para evitar falsos positivos):
 *  - Lecturas dentro de funciones helper (ej. parseParams) o callbacks anidados
 *    (ej. el callback de getWithStaleWhileRevalidate) NO se flaggean si el archivo
 *    contiene al menos un guard — el guard vive en el handler que las invoca.
 *  - Un archivo sin ningún guard sí flaggea las lecturas en helpers/callbacks.
 *  - Endpoints legítimamente públicos (ej. inicio de SSO pre-login) deben usar
 *    `// eslint-disable-next-line local/no-unauth-tenant-id` con justificación.
 *
 * Propósito: prevenir el patrón IDOR C-01/C-02 (ver docs/security/audit-2026-06-30.md)
 * donde tenantId era aceptado del cliente sin validación de identidad JWT.
 *
 * Regla: "local/no-unauth-tenant-id" — severity ERROR en CI.
 */

/** @type {import('eslint').Rule.RuleModule} */
const rule = {
  meta: {
    type: "problem",
    docs: {
      description:
        "Disallow trusting x-tenant-id header or ?tenantId= query param in an HTTP handler without an auth guard (requireTenantAccess / requireTenantRole / requireSuperAdmin / requireRequestIdentity).",
      category: "Security",
      recommended: true,
      url: "docs/security/audit-2026-06-30.md#c-02",
    },
    messages: {
      unauthTenantId:
        "tenantId is read from client-controlled input ({{source}}) without an auth guard in the same handler. " +
        "Add requireTenantAccess/requireTenantRole/requireSuperAdmin before any tenant-scoped operation. " +
        "See docs/security/audit-2026-06-30.md#c-01-c-02",
    },
    schema: [],
  },

  create(context) {
    const UNSAFE_KEYS = new Set(["x-tenant-id", "tenantId"]);
    const SAFE_GUARDS = new Set([
      "requireTenantAccess",
      "requireTenantRole",
      "requireSuperAdmin",
      "requireRequestIdentity",
    ]);
    const HTTP_HANDLERS = new Set([
      "GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS",
    ]);
    const FUNC_TYPES = ["FunctionDeclaration", "FunctionExpression", "ArrowFunctionExpression"];
    const sourceCode = context.sourceCode ?? context.getSourceCode();

    /** @param {import('estree').Node} node */
    function isUnsafeGet(node) {
      if (node.type !== "CallExpression") return null;
      const { callee, arguments: args } = node;
      if (callee.type !== "MemberExpression") return null;
      if (callee.property.type !== "Identifier" || callee.property.name !== "get") return null;
      if (args.length < 1) return null;
      const arg = args[0];
      if (arg.type !== "Literal" || typeof arg.value !== "string") return null;
      if (!UNSAFE_KEYS.has(arg.value)) return null;
      return arg.value;
    }

    /** @param {import('estree').Node} node */
    function isGuardCall(node) {
      if (node.type !== "CallExpression") return false;
      const { callee } = node;
      if (callee.type === "Identifier" && SAFE_GUARDS.has(callee.name)) return true;
      if (callee.type === "MemberExpression" && callee.property.type === "Identifier" && SAFE_GUARDS.has(callee.property.name)) return true;
      return false;
    }

    /** Recolecta todas las CallExpression bajo un nodo (cruza funciones anidadas). */
    function collectAllCalls(node, out) {
      if (!node || typeof node !== "object") return;
      if (node.type === "CallExpression") out.push(node);
      for (const key of Object.keys(node)) {
        if (key === "type" || key === "loc" || key === "range" || key === "parent") continue;
        const child = node[key];
        if (!child || typeof child !== "object") continue;
        if (Array.isArray(child)) {
          for (const item of child) {
            if (item && typeof item === "object" && item.type) collectAllCalls(item, out);
          }
        } else if (child.type) {
          collectAllCalls(child, out);
        }
      }
    }

    /** Función envolvente más cercana de un nodo (usa cadena de parents). */
    function immediateEnclosingFunction(node) {
      let cur = node.parent;
      while (cur) {
        if (FUNC_TYPES.includes(cur.type)) return cur;
        cur = cur.parent;
      }
      return null;
    }

    /** Nombre de una función (declaración, o const/asignación a arrow/expr). */
    function functionName(fn) {
      if (fn.type === "FunctionDeclaration" && fn.id) return fn.id.name;
      const p = fn.parent;
      if (p) {
        if (p.type === "VariableDeclarator" && p.id && p.id.type === "Identifier") return p.id.name;
        if (p.type === "AssignmentExpression" && p.left && p.left.type === "Identifier") return p.left.name;
      }
      return null;
    }

    let _fileHasGuard = null;
    function fileHasGuard() {
      if (_fileHasGuard !== null) return _fileHasGuard;
      const all = [];
      collectAllCalls(sourceCode.ast, all);
      _fileHasGuard = all.some(isGuardCall);
      return _fileHasGuard;
    }

    return {
      CallExpression(node) {
        const key = isUnsafeGet(node);
        if (!key) return;

        const fn = immediateEnclosingFunction(node);
        const source = key === "x-tenant-id" ? "headers.get('x-tenant-id')" : "searchParams.get('tenantId')";

        if (fn && HTTP_HANDLERS.has(functionName(fn) || "")) {
          // Lectura directa en un handler HTTP: exigir guard dentro del handler.
          const calls = [];
          collectAllCalls(fn.body, calls);
          if (!calls.some(isGuardCall)) {
            context.report({ node, messageId: "unauthTenantId", data: { source } });
          }
          return;
        }

        // Lectura en helper o callback anidado: solo flaggear si el archivo no
        // tiene ningún guard (el guard debería vivir en el handler que la invoca).
        if (!fileHasGuard()) {
          context.report({ node, messageId: "unauthTenantId", data: { source } });
        }
      },
    };
  },
};

export default rule;
