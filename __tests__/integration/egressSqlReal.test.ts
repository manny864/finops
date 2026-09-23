// @vitest-environment node
//
// Verificación del SQL de egress CONTRA MySQL DE VERDAD (MEJ-19).
//
// Los tests unitarios evalúan las reglas del `CASE` con un intérprete en JS: eso
// cubre el orden de los WHEN, pero no que MySQL las interprete igual. Este
// archivo inserta los nueve medidores reales de Azure, corre la consulta y
// compara. Fue lo que confirmó que el `Standard Data Processed` de Azure
// Firewall deja de contarse como NAT Gateway.
//
// SE SALTEA salvo que se pase `DB_PORT`, porque CI no tiene MySQL. Se corre así,
// con el docker local levantado:
//
//   DB_PORT=3307 npx vitest run __tests__/integration/egressSqlReal.test.ts
//
// El resto de las credenciales salen de los defaults de `db.ts`
// (finops_user/finopspassword/finops_app), que son las del compose local.
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import pool from "@/modules/storage/db";
import { getMapaEgress } from "@/services/networkEgress.service";

const TENANT = "tmp-egress-verificacion";

// Los nueve medidores son los reales de la Retail Prices API.
const FILAS: Array<[string, string, number, number]> = [
    ["Bandwidth", "Standard Data Transfer Out", 100, 1000],
    ["Bandwidth", "Standard Inter-Availability Zone Data Transfer Out", 50, 5000],
    ["Bandwidth", "Inter Continent Data Transfer Out - NAM or EU To Any", 30, 600],
    ["Bandwidth", "Intra Continent Data Transfer Out", 20, 1000],
    ["Bandwidth", "Standard Data Transfer In", 5, 9000],
    ["NAT Gateway", "Standard Data Processed", 45, 1000],
    ["Azure Firewall", "Standard Data Processed", 60, 1300],
    ["Load Balancer", "Gateway Data Processed", 12, 480],
    ["Virtual Network", "Standard Data Processed - Egress", 8, 800],
];

describe.skipIf(!process.env.DB_PORT)("SQL de egress contra MySQL real", () => {
    beforeAll(async () => {
        await pool.query(
            `INSERT IGNORE INTO Tenants (tenant_id, company_name, status) VALUES (?, 'tmp verificacion', 'inactive')`,
            [TENANT]
        );
        for (const [servicio, medidor, costo, qty] of FILAS) {
            await pool.query(
                `INSERT INTO CostMeterSnapshots
                    (tenant_id, subscription_id, date, service_name, MeterCategory, MeterSubCategory, MeterName, resource_location, cost_usd, Quantity, UnitOfMeasure, currency)
                 VALUES (?, 'sub-tmp', CURDATE(), ?, '', ?, ?, 'eastus', ?, ?, '', 'USD')
                 ON DUPLICATE KEY UPDATE cost_usd = VALUES(cost_usd)`,
                [TENANT, servicio, medidor, medidor, costo, qty]
            );
        }
    }, 30000);

    afterAll(async () => {
        // El CASCADE de la FK se lleva los snapshots con el tenant.
        await pool.query(`DELETE FROM Tenants WHERE tenant_id = ?`, [TENANT]);
        await pool.end().catch(() => { /* el pool puede estar compartido */ });
    }, 30000);

    // Firewall 60 + Load Balancer 12 + Private Link 8 = 80 en `procesamiento`, y
    // sólo los 45 del NAT Gateway en `nat_gateway`. Con el filtro que se fue a
    // producción en ff081db, los cuatro sumaban 125 bajo "NAT Gateway".
    it("MySQL clasifica igual que el intérprete del test unitario", async () => {
        const r = await getMapaEgress(TENANT, 30);
        const porCat = Object.fromEntries(r.porCategoria.map((c) => [c.categoria, c.costoUsd]));
        expect(porCat).toEqual({
            internet: 100,
            entre_zonas: 50,
            entre_continentes: 30,
            entre_regiones: 20,
            entrada: 5,
            nat_gateway: 45,
            procesamiento: 80, // Firewall 60 + LB 12 + Private Link 8
        });
        expect(r.costoSalidaUsd).toBe(325);
    }, 30000);
});
