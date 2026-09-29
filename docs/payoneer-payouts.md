# Payoneer — pago a afiliados y comerciales

Puesta en marcha del rail de pago. La parte operativa del día a día —cómo se
invita a un partner, cómo se arma una corrida— está en el **manual de
SuperAdmin, sección 17**; acá está lo que hay que hacer una sola vez y lo que
un desarrollador necesita para seguir la integración.

> **Contrato verificado el 2026-09-28** contra
> <https://developer.payoneer.com/docs/mass-payouts-and-services.html>.
> Si algo de abajo no coincide con la documentación, manda la documentación:
> hay que corregir este archivo y el código, no asumir.

---

## 1. Qué hace falta de Payoneer

Las credenciales las emite Payoneer; no hay autoservicio. Se piden **tres
valores** y se arranca siempre por sandbox:

| Valor | Para qué |
|---|---|
| `client_id` | Identifica la aplicación |
| `client_secret` | El secreto del par OAuth |
| `program_id` | Identifica nuestro programa; va en la URL de cada llamada |

El sandbox replica la funcionalidad de producción y sirve para probar el
circuito entero sin mover plata. Las credenciales de producción se piden al
equipo de integración de Payoneer **cuando el flujo ya funciona**.

---

## 2. Configuración

### Local

En `.env.local`, que gana sobre `.env.development` y está gitignored:

```
PAYONEER_CLIENT_ID=...
PAYONEER_CLIENT_SECRET=...
PAYONEER_PROGRAM_ID=...
PAYONEER_ENV=sandbox
```

Next lee los `.env` al arrancar: hay que reiniciar el dev server.

### Producción

Los secretos van a Key Vault y terraform los mapea a variables de entorno de la
Container App:

```bash
az keyvault secret set --vault-name <kv> --name payoneer-client-id     --value '...'
az keyvault secret set --vault-name <kv> --name payoneer-client-secret --value '...'
az keyvault secret set --vault-name <kv> --name payoneer-program-id    --value '...'
```

y en `infra/terraform/environments/prod/terraform.tfvars`, dentro de
`key_vault_secret_env`:

```hcl
PAYONEER_CLIENT_ID     = "payoneer-client-id"
PAYONEER_CLIENT_SECRET = "payoneer-client-secret"
PAYONEER_PROGRAM_ID    = "payoneer-program-id"
```

**El apply va sólo por CI** (`workflow_dispatch` con `confirm=APPLY-PROD`). El
plan local quiere reemplazar el role assignment del Key Vault y dejaría a CI sin
acceso.

### `PAYONEER_ENV` no es un secreto, y su default importa

Sólo el valor **`production` exacto** habilita el entorno real. Vacío, `prod`,
`Production` o cualquier otra cosa cae a sandbox. Es deliberado: el valor por
defecto de una variable mal escrita no puede ser el que mueve plata. Hay test
que recorre esas variantes.

### Sin configurar no se rompe nada

Si falta cualquiera de las tres, `configDePayoneer()` devuelve `null`, el botón
de invitar responde «Payoneer no está configurado» y el resto de la liquidación
—corridas, CSV, marcar pagado— sigue funcionando igual. **Es el estado normal**
hasta que alguien pida las credenciales.

---

## 3. El contrato, como lo usa el código

### Token de aplicación

```
POST {auth}/api/v2/oauth2/token
Authorization: Basic base64(client_id:client_secret)
Content-Type: application/x-www-form-urlencoded

grant_type=client_credentials&scope=read write
```

Devuelve `access_token` y `expires_in` (~30 días, 2.592.000 s).

Se cachea en memoria del proceso con 24 h de margen antes del vencimiento: un
token que vence en medio de un lote es peor que pedir uno de más. Un reinicio
del contenedor cuesta una llamada extra y nada más.

### Alta de beneficiario

```
POST {api}/v4/programs/{program_id}/payees/registration-link
Authorization: Bearer {token}
```

con `payee_id` (el nuestro), `client_session_id`, `redirect_url`,
`payout_methods` y los datos de contacto para precargar el formulario.

Devuelve un enlace **válido para un solo registro**.

> **Ambigüedad conocida de la documentación.** El esquema de la respuesta se
> dibuja en árbol plano (`result` / `registration_link` / `token`) y no queda
> claro si el enlace cuelga de `result` o va arriba. El código lee las dos
> formas y, si no está en ninguna, falla: devolver el alta con el enlace vacío
> dejaría la ficha marcada como invitada y a la persona sin nada que completar.

### Entornos

| | Autorización | API |
|---|---|---|
| Sandbox | `login.sandbox.payoneer.com` | `api.sandbox.payoneer.com` |
| Producción | `login.payoneer.com` | `api.payoneer.com` |

### `payee_id`: es nuestro

La API recibe «el identificador único del payee en la plataforma del cliente» y
Payoneer lo adopta para las operaciones siguientes. Se arma como
`aff-<id>` / `rep-<id>`, con prefijo por tipo: sin él, el mismo id en
`Affiliates` y en `SalesReps` daría el mismo `payee_id`, que es mandarle la
plata de uno a la cuenta del otro. Hay UNIQUE en las dos tablas y hay test.

---

## 4. Qué falta para pagar de verdad

El alta es el primer paso y el único que se puede probar sin fondear la cuenta.
Para cerrar el circuito faltan tres cosas:

1. **Webhook de estado del payee.** Hoy el estado que guardamos
   (`payoneer_status`) es nuestra copia y sólo avanza a `INVITED` cuando
   invitamos. El paso a `ACTIVE` o `DECLINED` lo manda Payoneer y hay que
   escucharlo.
2. **Envío del lote.** `POST /v4/programs/{program_id}/masspayouts`, hasta 500
   pagos por llamada, con `client_reference_id`, `payee_id`, `description`,
   `currency` y `amount`. Las corridas de pago ya producen exactamente eso:
   `referenciaDeLinea()` es determinista justamente para ser el
   `client_reference_id` —reenviar el mismo lote tiene que ser idempotente del
   otro lado— y cada corrida es de una sola moneda.
3. **Webhook de estado del pago.** El envío es asíncrono; hoy el «confirmar
   pago» lo hace una persona y ahí lo confirmaría Payoneer por línea.

### Dos restricciones operativas que definen el proyecto

- **Hay que pre-fondear.** Payoneer paga con fondos depositados de antemano. Si
  no alcanzan, el lote **no se procesa** — no es un fallo parcial, no sale nada.
- **El receptor paga comisión**, y las condiciones cambian por país. Antes de
  construir el envío conviene preguntarles a los primeros partners si les
  sirve: para alguien en Argentina puede pesar más que la comodidad, y el campo
  *Medio de pago* de su ficha permite pagarle por transferencia sin que se
  registre en ningún lado.

---

## 5. Dónde está cada cosa

| Archivo | Qué tiene |
|---|---|
| `src/services/payoneer.service.ts` | Cliente HTTP: token, alta, `payeeIdDe` |
| `src/services/payoutRuns.service.ts` | Corridas de pago |
| `src/services/commissions.service.ts` | Libro unificado y estado del beneficiario |
| `src/app/api/superadmin/commissions/route.ts` | Endpoints de corridas y de alta |
| `migrations/20260928-002-payout-runs.sql` | `PayoutRuns` + `Commissions.payout_run_id` |
| `migrations/20260928-004-payoneer-payee.sql` | `payoneer_payee_id` y estado |
| `__tests__/unit/payoneerAlta.test.ts` | Contrato del cliente contra `fetch` simulado |
| `__tests__/unit/corridasDePago.test.ts` | Los guardas que impiden pagar dos veces |
