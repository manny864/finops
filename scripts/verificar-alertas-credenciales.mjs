/**
 * Verificación de punta a punta de las alertas de vencimiento de credenciales.
 *
 * Prueba el borde que estaba roto: que la fila que escribe el panel sea la que
 * levanta el cron. Inserta una regla con el mismo INSERT del servicio, corre el
 * SELECT literal del cron y borra lo que creó.
 *
 *   node --env-file=.env.development scripts/verificar-alertas-credenciales.mjs <tenantId>
 *
 * No manda correos ni llama a Microsoft Graph: eso lo hace el botón "Probar"
 * del panel, que usa la misma plantilla que el cron.
 */
import mysql from "mysql2/promise";

const tenantId = process.argv[2];
if (!tenantId) {
  console.error("Falta el tenantId.\n  node --env-file=.env.development scripts/verificar-alertas-credenciales.mjs <tenantId>");
  process.exit(1);
}

const NOMBRE = `__verificacion_alertas_${Date.now()}`;
const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

let ok = true;
const decir = (paso, bien, detalle = "") => {
  console.log(`${bien ? "  ok " : " FAIL"}  ${paso}${detalle ? ` — ${detalle}` : ""}`);
  if (!bien) ok = false;
};

try {
  // 1. Lo que escribe el panel: una fila por umbral x canal x destinatario.
  const filas = [
    { dias: 30, canal: "email", destino: "verificacion@example.com" },
    { dias: 7, canal: "email", destino: "verificacion@example.com" },
  ];
  for (const f of filas) {
    await conn.query(
      `INSERT INTO AlertRules
         (tenant_id, rule_name, rule_type, threshold_value, threshold_unit,
          channel, channel_target, reminder_frequency_hours, enabled, trigger_count, created_by)
       VALUES (?, ?, 'credential_expiry', ?, 'days', ?, ?, 24, 1, 0, 'verificacion')`,
      [tenantId, NOMBRE, f.dias, f.canal, f.destino]
    );
  }
  decir(`INSERT del panel (${filas.length} filas)`, true);

  // 2. El SELECT literal del cron /api/cron/credential-expiry-alerts.
  const [levantadas] = await conn.query(
    `SELECT id, rule_name, threshold_value, channel, channel_target, reminder_frequency_hours
       FROM AlertRules
      WHERE rule_type = 'credential_expiry' AND enabled = TRUE
        AND (
          last_triggered_at IS NULL
          OR (reminder_frequency_hours IS NOT NULL AND last_triggered_at < DATE_SUB(NOW(), INTERVAL reminder_frequency_hours HOUR))
        )
        AND rule_name = ?`,
    [NOMBRE]
  );
  decir("el cron levanta las filas recién creadas", levantadas.length === filas.length,
    `${levantadas.length} de ${filas.length}`);

  // 3. El horizonte de la consulta a Graph sale del mayor umbral del tenant.
  const maxDias = Math.max(...levantadas.map((r) => Number(r.threshold_value) || 0));
  decir("el horizonte a Graph es el umbral mayor", maxDias === 30, `${maxDias} días`);

  // 4. Lo que lee el panel: agrupado por nombre, una sola regla.
  const [delPanel] = await conn.query(
    `SELECT rule_name, COUNT(*) filas, GROUP_CONCAT(threshold_value ORDER BY threshold_value DESC) umbrales
       FROM AlertRules
      WHERE tenant_id = ? AND rule_type = 'credential_expiry' AND rule_name = ?
      GROUP BY rule_name`,
    [tenantId, NOMBRE]
  );
  decir("el panel las reagrupa en una sola regla", delPanel.length === 1,
    delPanel[0] ? `umbrales ${delPanel[0].umbrales}` : "sin filas");

  // 5. Una regla ya avisada hace 1 hora no se vuelve a levantar hasta las 24.
  await conn.query(
    `UPDATE AlertRules SET last_triggered_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) WHERE rule_name = ?`,
    [NOMBRE]
  );
  const [antiSpam] = await conn.query(
    `SELECT id FROM AlertRules
      WHERE rule_type = 'credential_expiry' AND enabled = TRUE AND rule_name = ?
        AND (last_triggered_at IS NULL
             OR (reminder_frequency_hours IS NOT NULL AND last_triggered_at < DATE_SUB(NOW(), INTERVAL reminder_frequency_hours HOUR)))`,
    [NOMBRE]
  );
  decir("el anti-spam de 24 h la deja fuera", antiSpam.length === 0, `${antiSpam.length} levantadas`);
} finally {
  await conn.query(`DELETE FROM AlertRules WHERE rule_name = ?`, [NOMBRE]);
  await conn.end();
}

console.log(ok ? "\nTodo el camino hasta el cron está conectado." : "\nHay pasos rotos, ver arriba.");
process.exit(ok ? 0 : 1);
