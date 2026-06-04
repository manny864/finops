const fs = require('fs');
const path = require('path');

const base_dir = "/Users/manuelchavez/Documents/FinOpsProyect";

// 1. Update /api/audit/full/route.ts
const route_full_path = path.join(base_dir, "src", "app", "api", "audit", "full", "route.ts");
let route_full = fs.readFileSync(route_full_path, "utf8");

const old_jwt_check = `    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as { tid?: string } | null;

    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    if (decoded.tid !== tenantId) {
      return NextResponse.json(
        { error: \`Acceso denegado. El token no coincide con el tenant.\` },
        { status: 403 }
      );
    }`;

const new_jwt_check = `    const token = authHeader.split(" ")[1];
    const decoded = jwt.decode(token) as any;

    if (!decoded || !decoded.tid) {
      return NextResponse.json({ error: "Estructura de token inválida." }, { status: 401 });
    }

    const email = decoded.preferred_username || decoded.unique_name || decoded.email || "";
    const isAdmin = email.toLowerCase().endsWith("@cscloudsolutions.com.ar");

    if (decoded.tid !== tenantId && !isAdmin) {
      return NextResponse.json(
        { error: \`Acceso denegado. El token no coincide con el tenant.\` },
        { status: 403 }
      );
    }`;

route_full = route_full.replace(old_jwt_check, new_jwt_check);
fs.writeFileSync(route_full_path, route_full);

// 2. Update /api/subscriptions/route.ts
const route_sub_path = path.join(base_dir, "src", "app", "api", "subscriptions", "route.ts");
let route_sub = fs.readFileSync(route_sub_path, "utf8");
route_sub = route_sub.replace(old_jwt_check, new_jwt_check);
fs.writeFileSync(route_sub_path, route_sub);

// 3. Update AuthSync.tsx
const authsync_path = path.join(base_dir, "src", "components", "AuthSync.tsx");
let authsync_code = fs.readFileSync(authsync_path, "utf8");
const old_name_line = `const name = account.idTokenClaims?.name || account.name || "Entorno FinOps";`;
const new_name_line = `const name = "Entorno: " + tenantId.substring(0,8);`;
authsync_code = authsync_code.replace(old_name_line, new_name_line);
fs.writeFileSync(authsync_path, authsync_code);

// 4. Update Recommendations route.ts just in case
const route_rec_path = path.join(base_dir, "src", "app", "api", "recommendations", "route.ts");
let route_rec = fs.readFileSync(route_rec_path, "utf8");
route_rec = route_rec.replace(old_jwt_check, new_jwt_check);
fs.writeFileSync(route_rec_path, route_rec);

console.log("Fase 11 (Archivos) Completada: Bypass SuperAdmin implementado.");
