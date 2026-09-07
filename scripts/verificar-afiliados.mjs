/**
 * Verifica el camino del dinero del programa de afiliados contra la base real.
 *
 *   node --env-file=.env.development scripts/verificar-afiliados.mjs
 *
 * Lo que prueba, y que un unit test con mocks NO puede probar, porque depende
 * de que los indices existan de verdad en el motor:
 *
 *   1. Se puede dar de alta un afiliado y atribuirle un tenant.
 *   2. `uq_referral_tenant` hace que la atribucion sea de primer toque: un
 *      segundo afiliado sobre el mismo tenant no lo roba.
 *   3. `uq_commission_transaction` hace que devengar dos veces el mismo cobro
 *      inserte UNA sola comision. Es lo que evita pagarle doble al afiliado
 *      cuando Paddle reentrega un webhook.
 *   4. Un reembolso revierte la comision pendiente y NO toca una ya pagada.
 *   5. Borrar un afiliado ARRASTRA sus comisiones por el ON DELETE CASCADE —
 *      por eso `eliminarAfiliado` se niega cuando existe historial— y
 *      suspenderlo es la alternativa que corta el devengo sin perder nada.
 *
 * Deja la base como estaba: todo se crea con un sufijo unico y se borra al
 * final, incluso si algo falla.
 */
import mysql from "mysql2/promise";
import { randomUUID } from "node:crypto";

const SUFIJO = `verif-${Date.now()}`;
const AFILIADO_A = randomUUID();
const AFILIADO_B = randomUUID();
const AFILIADO_C = randomUUID();
const TENANT = `tenant-${SUFIJO}`;
const TXN = `txn_${SUFIJO}`;

let fallos = 0;
const ok = (msg) => console.log(`  ✅ ${msg}`);
const mal = (msg, extra) => { fallos++; console.log(`  ❌ ${msg}${extra ? ` — ${extra}` : ""}`); };
const afirmar = (cond, msg, extra) => (cond ? ok(msg) : mal(msg, extra));

const conn = await mysql.createConnection({
    host: process.env.DB_HOST,
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
});

async function limpiar() {
    await conn.query("DELETE FROM AffiliateCommissions WHERE tenant_id = ?", [TENANT]);
    await conn.query("DELETE FROM AffiliateReferrals WHERE tenant_id = ?", [TENANT]);
    await conn.query("DELETE FROM Affiliates WHERE id IN (?, ?, ?)", [AFILIADO_A, AFILIADO_B, AFILIADO_C]);
    await conn.query("DELETE FROM Tenants WHERE tenant_id = ?", [TENANT]);
}

try {
    console.log(`\n[1/5] Alta de afiliados y tenant de prueba`);
    await conn.query(
        "INSERT INTO Tenants (tenant_id, company_name, tier) VALUES (?, ?, 'Business')",
        [TENANT, `Verificacion ${SUFIJO}`]
    );
    for (const [id, nombre, codigo, pct] of [
        [AFILIADO_A, "Socio A", `soc_a_${SUFIJO}`.slice(0, 60), "20.00"],
        [AFILIADO_B, "Socio B", `soc_b_${SUFIJO}`.slice(0, 60), "10.00"],
    ]) {
        await conn.query(
            "INSERT INTO Affiliates (id, name, email, referral_code, commission_pct) VALUES (?, ?, ?, ?, ?)",
            [id, nombre, `${codigo}@example.test`, codigo, pct]
        );
    }
    ok("dos afiliados y un tenant creados");

    console.log(`\n[2/5] Atribucion de primer toque`);
    const [r1] = await conn.query(
        "INSERT IGNORE INTO AffiliateReferrals (affiliate_id, tenant_id) VALUES (?, ?)", [AFILIADO_A, TENANT]);
    afirmar(r1.affectedRows === 1, "el primer afiliado se queda con el tenant");
    const [r2] = await conn.query(
        "INSERT IGNORE INTO AffiliateReferrals (affiliate_id, tenant_id) VALUES (?, ?)", [AFILIADO_B, TENANT]);
    afirmar(r2.affectedRows === 0, "un segundo afiliado NO le roba el referido", `affectedRows=${r2.affectedRows}`);
    const [duenio] = await conn.query(
        "SELECT affiliate_id FROM AffiliateReferrals WHERE tenant_id = ?", [TENANT]);
    afirmar(duenio[0]?.affiliate_id === AFILIADO_A, "el referido sigue siendo del afiliado A");

    console.log(`\n[3/5] Devengo idempotente (reentrega de webhook)`);
    const insertarComision = () => conn.query(
        `INSERT IGNORE INTO AffiliateCommissions
           (affiliate_id, tenant_id, paddle_transaction_id, base_amount, currency, commission_pct, commission_amount, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'PENDING')`,
        [AFILIADO_A, TENANT, TXN, "299.9900", "USD", "20.00", "59.9980"]
    );
    const [c1] = await insertarComision();
    afirmar(c1.affectedRows === 1, "primera entrega: comision devengada");
    const [c2] = await insertarComision();
    afirmar(c2.affectedRows === 0, "reentrega del MISMO evento: no devenga de nuevo", `affectedRows=${c2.affectedRows}`);
    const [filas] = await conn.query(
        "SELECT COUNT(*) n, SUM(commission_amount) total FROM AffiliateCommissions WHERE paddle_transaction_id = ?", [TXN]);
    afirmar(Number(filas[0].n) === 1, "una sola fila para el cobro", `n=${filas[0].n}`);
    afirmar(String(filas[0].total) === "59.9980", "el total no se duplico", `total=${filas[0].total}`);
    // mysql2 devuelve DECIMAL como string: si esto deja de ser cierto, el
    // servicio que multiplica con Decimal(String(...)) hay que revisarlo.
    afirmar(typeof filas[0].total === "string", "mysql2 sigue devolviendo DECIMAL como string", typeof filas[0].total);

    console.log(`\n[4/5] Reversa por reembolso`);
    const [rev1] = await conn.query(
        "UPDATE AffiliateCommissions SET status='REVERSED' WHERE paddle_transaction_id = ? AND status IN ('PENDING','APPROVED')", [TXN]);
    afirmar(rev1.affectedRows === 1, "la comision pendiente se revierte");
    await conn.query("UPDATE AffiliateCommissions SET status='PAID' WHERE paddle_transaction_id = ?", [TXN]);
    const [rev2] = await conn.query(
        "UPDATE AffiliateCommissions SET status='REVERSED' WHERE paddle_transaction_id = ? AND status IN ('PENDING','APPROVED')", [TXN]);
    afirmar(rev2.affectedRows === 0, "una comision YA PAGADA no la revierte el webhook", `affectedRows=${rev2.affectedRows}`);
    console.log(`\n[5/5] Baja: el historial financiero no se puede borrar de un click`);
    // Las FK son ON DELETE CASCADE, asi que un DELETE liso se llevaria las
    // comisiones. El servicio lo niega cuando existe alguna; esto verifica que
    // el CASCADE realmente arrastra, o sea que la negativa no es decorativa.
    const [conComision] = await conn.query(
        "SELECT COUNT(*) n FROM AffiliateCommissions WHERE affiliate_id = ?", [AFILIADO_A]);
    afirmar(Number(conComision[0].n) === 1, "el afiliado A tiene una comision registrada");

    await conn.query("DELETE FROM Affiliates WHERE id = ?", [AFILIADO_A]);
    const [tras] = await conn.query(
        "SELECT COUNT(*) n FROM AffiliateCommissions WHERE affiliate_id = ?", [AFILIADO_A]);
    afirmar(Number(tras[0].n) === 0,
        "borrar el afiliado ARRASTRA sus comisiones (por eso eliminarAfiliado lo niega)",
        `quedaron ${tras[0].n}`);

    // Y suspender, que es la alternativa: conserva el referido y el historial,
    // pero deja de devengar. El paso anterior se llevo el referido en cascada,
    // asi que hay que volver a atribuir el tenant o el chequeo pasa vacio y no
    // prueba nada.
    await conn.query(
        `INSERT INTO Affiliates (id, name, email, referral_code, commission_pct, status)
         VALUES (?, 'Socio C', ?, ?, '20.00', 'SUSPENDED')`,
        [AFILIADO_C, `sus_${SUFIJO}@example.test`, `sus_${SUFIJO}`.slice(0, 60)]);
    await conn.query(
        "INSERT IGNORE INTO AffiliateReferrals (affiliate_id, tenant_id) VALUES (?, ?)", [AFILIADO_C, TENANT]);

    const [hayReferido] = await conn.query(
        "SELECT COUNT(*) n FROM AffiliateReferrals WHERE tenant_id = ?", [TENANT]);
    afirmar(Number(hayReferido[0].n) === 1, "el tenant queda atribuido al afiliado suspendido");

    const [susp] = await conn.query(
        `SELECT r.affiliate_id FROM AffiliateReferrals r
         JOIN Affiliates a ON a.id = r.affiliate_id
         WHERE r.tenant_id = ? AND a.status = 'ACTIVE'`, [TENANT]);
    afirmar(susp.length === 0,
        "suspendido: la consulta de devengo no lo matchea, deja de acumular",
        `matchearon ${susp.length}`);
} finally {
    await limpiar();
    await conn.end();
}

console.log(fallos === 0 ? "\n✅ El camino del dinero se comporta como debe.\n" : `\n❌ ${fallos} chequeo(s) fallaron.\n`);
process.exit(fallos === 0 ? 0 : 1);
