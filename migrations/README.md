# Migraciones Explícitas

Cada archivo `.sql` en este directorio es **una migración versionada e idempotente**.
El runner (`src/modules/storage/migrations.ts`) las aplica en orden alfabético y
registra cada aplicación en la tabla `SchemaMigrations` para no re-ejecutarlas.

## Convención de nombres

```
YYYYMMDD-NNN-descripcion-breve.sql
```

Ejemplos:
- `20260629-001-alertrules-budget-id.sql`
- `20260701-002-add-expiring-creds-severity.sql`

## Reglas

1. **Cada archivo es idempotente**: usar `IF NOT EXISTS`, `IF EXISTS`, o `ALTER ... ADD COLUMN ...` envuelto en try/catch a nivel runner. Ejecutarla 2 veces NUNCA debe romper.
2. **Una migración = un cambio lógico**. No mezcles 5 cosas en un archivo; eso hace imposible roll-forward parcial.
3. **NUNCA editar un archivo ya aplicado en producción.** Si necesitás cambiar algo, escribí una migración nueva. El runner detecta los archivos por hash en `SchemaMigrations.checksum` y avisa si cambió uno aplicado.
4. **No usar tipos con default float**: para columnas de costo/ahorro usar `DECIMAL(p,s)`.

## Cómo correr manualmente

```bash
# Vía endpoint admin (recomendado, requiere super-admin):
curl -X POST https://<tu-host>/api/admin/migrations/run \
  -H "Authorization: Bearer <token>"

# O via script CLI (local/CI):
npx tsx scripts/migrate.ts
```

El runner también se ejecuta automáticamente al primer hit de
`initializeDatabase()` desde cualquier endpoint, así que en runtime normal
no necesitás invocarlo a mano.
