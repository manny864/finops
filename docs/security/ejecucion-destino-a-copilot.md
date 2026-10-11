# Ejecución del destino A del origen: guía para un agente con terminal

Esta guía es para un agente (Copilot en VS Code) que ejecuta, junto con una persona, el cierre del origen web por el **destino A: certificado propio (Cloudflare Origin CA), NAT Gateway y filtro a Cloudflare**. El porqué está en [`endurecimiento-infraestructura-saas-2026-10-09.md`](./endurecimiento-infraestructura-saas-2026-10-09.md), sección 7.3; esta guía agrega el cómo operativo, lo que se espera ver en cada paso y cuándo parar. Se escribió el 2026-10-11 (UTC); el estado de partida (sección 2) se verificó ese día: si algo no coincide, es una señal para parar.

## 1. Reglas (no se negocian)

1. **Una etapa por vez.** Al terminar cada una, reportá la evidencia y esperá el "sigue" de la persona. Antes de cualquier acción que **cambie producción** (`gh workflow run ... -f confirm=APPLY-PROD`, `gh secret set`, `az containerapp hostname bind`, `az containerapp job start`) mostrá el comando exacto y esperá un "sí" explícito.
2. **Nunca `terraform apply` ni `terraform plan` en la máquina local contra producción.** Todo apply de prod va por el workflow `terraform`. (Un plan local intenta reemplazar el role assignment del Key Vault y fallaría de todos modos contra el firewall del vault.)
3. **Nunca imprimas, leas ni pegues secretos o claves:** `~/origen-cert/*` (la clave `origen.key` no se abre jamás), el contenido de `infra/terraform/environments/prod/terraform.tfvars` (gitignored; tiene GUIDs de tenant y suscripción), valores de secretos de Key Vault. Usá `grep -n` sobre líneas concretas y ediciones acotadas, y **siempre `--query`** con `az containerapp show` (la salida completa trae variables de entorno).
4. **No hagas `git push`, no toques Entra ID, Cloudflare ni los ajustes de seguridad de GitHub** (ramas protegidas, credenciales federadas, environments). Cloudflare y la carpeta `~/origen-cert` los maneja la persona.
5. **No inventes comandos, flags ni nombres de recursos.** Usá los de esta guía y los del runbook 7.3. Si un comando falla de forma inesperada, **parar**, mostrar el error íntegro (sin secretos) y esperar instrucciones. No reintentes con variantes por tu cuenta.
6. **Criterio de parada general:** un plan con recursos extra, `delete` o `replace` que la etapa no prevé, un check de Terraform en rojo, o un resultado de verificación distinto del esperado → **no aplicar y no avanzar**; mostrar la diferencia y preguntar.
7. **No edites** archivos `.tf`, workflows ni scripts. Esto es operación. Las únicas ediciones permitidas son líneas concretas de `infra/terraform/environments/prod/terraform.tfvars` (sección 5) y, al cerrar, la tabla de la sección 6 del documento de seguridad (sección 7 de esta guía).

## 2. Estado de partida

- `main` en GitHub incluye todos los cambios de infraestructura (Front Door eliminado; módulo de certificado propio, NAT Gateway y filtro de origen apagados).
- El secret `TF_VARS_PROD` se actualizó el 2026-10-11 a las 00:30 UTC desde el `terraform.tfvars` local, y ya trae `custom_domain_certificate_source = "byo_staged"` en el stamp `us`. **El archivo local es la copia maestra:** GitHub no deja leer un secret, así que cada cambio de variables es editar el archivo local y volver a subirlo entero.
- El Key Vault `cscs-finops-prod-wus2-kv` (firewall `Deny`, 0 reglas de IP) tiene los secretos `origin-cert-pfx` y `origin-cert-pfx-password`.
- El certificado Origin CA emitido cubre `finops.cscloudsolutions.com.ar`, `cscloudsolutions.com.ar` y `*.cscloudsolutions.com.ar`, vence el 2041-10-07; el primero que se emitió (sin el hostname exacto) está revocado. La clave y el CSR siguen en `~/origen-cert` de la persona (no se tocan).
- **Hoy:** el dominio usa el certificado gestionado `finops.cscloudsolutions.com-cscs-fin-260729100741`; el ingress no tiene restricciones de IP; no hay NAT Gateway. El modo SSL de Cloudflare **no está verificado** (preguntar).
- Cada apply del workflow incluye un `update` **benigno** de `module.stamp["us"].module.app.azurerm_container_app.this`: Terraform ve como deriva la variable `APP_VERSION` que setea el deploy, y el paso "Restaurar APP_VERSION" del workflow la repone. Es la **única** línea extra aceptable en un plan.

## 3. Datos fijos

| Dato | Valor |
|---|---|
| Repositorio / rama | `manny864/finops` / `main` |
| Suscripción | `CSCS-LandingZone` (`ec03e8ce-ceee-4638-b303-64ae431d5b1e`) |
| Resource group | `cscs-finops-prod-westus2-rg` |
| App web / entorno | `cscs-finops-prod-westus2-web` / `cscs-finops-prod-westus2-cae` |
| FQDN directo del app | `cscs-finops-prod-westus2-web.victoriousmoss-01886ec5.westus2.azurecontainerapps.io` |
| Dominio público (Cloudflare) | `finops.cscloudsolutions.com.ar` |
| Certificado gestionado (hoy) | `finops.cscloudsolutions.com-cscs-fin-260729100741` |
| Certificado propio (a crear) | `finops-cscloudsolutions-com-ar-byo` |
| Key Vault | `cscs-finops-prod-wus2-kv` |
| IP pública del NAT (a crear) | `cscs-finops-prod-westus2-nat-pip` |
| Cron de prueba | `cron-prewarm-dashboard` |

## 4. Cómo operar el workflow `terraform`

Inputs: `environment` (siempre `prod`), `confirm` (vacío = **sólo plan**; `APPLY-PROD` = planea **y aplica en la misma corrida**) y `replace` (dirección de un recurso a recrear o, ver etapa 4, a destruir). Un apply vuelve a planear: la corrida de sólo plan es la revisión, y `confirm` es el gate. El validador del apply bloquea cualquier `delete` que no sea el de `replace` y cualquier check en rojo.

Lanzar un plan (sólo lectura):

```bash
gh workflow run terraform.yml --repo manny864/finops --ref main -f environment=prod
```

Encontrar la corrida (la más reciente, `workflow_dispatch`, con `headSha` igual a `git rev-parse origin/main`) y esperarla:

```bash
gh run list --repo manny864/finops --workflow terraform.yml --limit 1 --json databaseId,status,event,createdAt,headSha
```

```bash
gh run watch <ID> --repo manny864/finops --exit-status
```

Leer el resumen del plan. GitHub enmascara con `***` todo lo que coincida con el secret `TF_VARS_PROD`, así que el texto del plan sale a medias ilegible; el paso "Resumen del plan (auditable)" lista sólo `acción dirección`:

```bash
gh run view <ID> --repo manny864/finops --log | awk -F'\t' '$2=="Resumen del plan (auditable)" { l=$3; sub(/^[^ ]+ /,"",l); if (l ~ /^(create|update|delete|replace|read)/ || l ~ /^ +[0-9]+ [a-z+-]+$/) print l }'
```

Aplicar (sólo después del "sí" de la persona y de un plan de sólo lectura que coincida con lo esperado):

```bash
gh workflow run terraform.yml --repo manny864/finops --ref main -f environment=prod -f confirm=APPLY-PROD
```

Si una corrida falla: `gh run view <ID> --repo manny864/finops --log-failed` y parar (regla 5).

## 5. Cómo cambiar `TF_VARS_PROD`

1. Ubicá la línea con `grep -n '<variable>' infra/terraform/environments/prod/terraform.tfvars` y cambiá **sólo esa línea** (o agregá las nuevas donde indica la etapa). No imprimas el archivo entero.
2. Mostrá a la persona exactamente qué cambió (las líneas, nada más).
3. Con su "sí", subí el archivo entero (reemplaza el secret completo):

```bash
gh secret set TF_VARS_PROD --repo manny864/finops < infra/terraform/environments/prod/terraform.tfvars
```

## 6. Etapas

### Etapa 0: preflight (sólo lectura)

```bash
git fetch origin && git status -sb && git log --oneline -3
```

Esperado: `## main...origin/main` sin adelanto ni atraso y sin cambios en archivos versionados.

```bash
az account show --query '{suscripcion:name, id:id, usuario:user.name}' -o json
```

Esperado: id `ec03e8ce-ceee-4638-b303-64ae431d5b1e`.

```bash
gh secret list --repo manny864/finops
```

Esperado: `TF_VARS_PROD` con fecha igual o posterior a `2026-10-11T00:30:00Z`.

```bash
az containerapp env certificate list -g cscs-finops-prod-westus2-rg -n cscs-finops-prod-westus2-cae -o table
```

Esperado: un solo certificado, el gestionado, en `Succeeded`.

```bash
az containerapp show -g cscs-finops-prod-westus2-rg -n cscs-finops-prod-westus2-web --query 'properties.configuration.ingress.customDomains[].{dominio:name, enlace:bindingType, certificado:certificateId}' -o json
```

Esperado: un dominio, `finops.cscloudsolutions.com.ar`, `SniEnabled`, con el id del certificado gestionado.

```bash
az containerapp show -g cscs-finops-prod-westus2-rg -n cscs-finops-prod-westus2-web --query 'length(properties.configuration.ingress.ipSecurityRestrictions || `[]`)' -o tsv
```

Esperado: `0`.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://finops.cscloudsolutions.com.ar/api/health
```

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://cscs-finops-prod-westus2-web.victoriousmoss-01886ec5.westus2.azurecontainerapps.io/api/health
```

Esperado: `200` en las dos (el origen todavía está abierto).

```bash
az containerapp job execution list -g cscs-finops-prod-westus2-rg -n cron-prewarm-dashboard --query '[0:3].properties.status' -o tsv
```

Esperado: `Succeeded`.

**Preguntas a la persona antes de seguir** (no se pueden verificar desde aquí): (a) ¿qué modo SSL tiene Cloudflare hoy? (para saber a qué volver); (b) ¿los webhooks de Paddle y cualquier monitor externo apuntan a `finops.cscloudsolutions.com.ar` y no al FQDN `azurecontainerapps.io`? (con el filtro, el FQDN directo da 403).

### Etapa 1: crear el certificado propio en el entorno (`byo_staged`)

No hay nada que editar: `TF_VARS_PROD` ya trae `byo_staged`. Lanzá un **plan de sólo lectura** (sección 4). Esperado, exactamente:

```
create module.stamp["us"].module.custom_domain.azurerm_container_app_environment_certificate.byo[0]
update module.stamp["us"].module.app.azurerm_container_app.this      <- benigno (APP_VERSION)
```

Y en el conteo: `1 create`, `1 update`. El plan tiene que leer los dos secretos del vault sin error. Cualquier otra línea → parar.

Con el "sí" de la persona, aplicá. Verificá:

```bash
az containerapp env certificate list -g cscs-finops-prod-westus2-rg -n cscs-finops-prod-westus2-cae -o table
```

Esperado: dos certificados, el gestionado y `finops-cscloudsolutions-com-ar-byo`, ambos `Succeeded`. Y que la versión del app no quedó en `unknown`:

```bash
curl -s https://finops.cscloudsolutions.com.ar/api/status | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('status'), d.get('version','')[:7])"
```

Esperado: `operational` y un SHA de 7 caracteres.

Esta etapa es la **primera prueba real** de que Container Apps acepta el `.pfx` de una CA privada. Si el apply falla creando el certificado, no cambia nada en el app: **parar** y mostrar el error íntegro. La persona decide cómo rearmar el `.pfx` (necesita su clave).

### Etapa 2: asociar el certificado al hostname

Con el "sí" de la persona (es un cambio en el lugar del binding, sin downtime):

```bash
az containerapp hostname bind --hostname finops.cscloudsolutions.com.ar -g cscs-finops-prod-westus2-rg -n cscs-finops-prod-westus2-web --environment cscs-finops-prod-westus2-cae --certificate finops-cscloudsolutions-com-ar-byo
```

Si el comando pide `--validation-method` u otro dato, **parar**. Verificar:

```bash
az containerapp show -g cscs-finops-prod-westus2-rg -n cscs-finops-prod-westus2-web --query 'properties.configuration.ingress.customDomains[].{dominio:name, enlace:bindingType, certificado:certificateId}' -o json
```

Esperado: `SniEnabled` y el id termina en `/certificates/finops-cscloudsolutions-com-ar-byo`.

```bash
echo | openssl s_client -connect cscs-finops-prod-westus2-web.victoriousmoss-01886ec5.westus2.azurecontainerapps.io:443 -servername finops.cscloudsolutions.com.ar 2>/dev/null | openssl x509 -noout -issuer -enddate
```

Esperado: el emisor contiene `CloudFlare Origin SSL Certificate Authority` y `notAfter` es de octubre de 2041.

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://finops.cscloudsolutions.com.ar/api/health
```

Esperado: `200`. **Marcha atrás** si da 52x o falla: volver al gestionado con el mismo comando y `--certificate finops.cscloudsolutions.com-cscs-fin-260729100741`.

### Etapa 3: modo SSL de Cloudflare (lo hace la persona)

Pedile que, en Cloudflare, SSL/TLS, Overview, pase a **Full (strict)** (acordate de qué modo tenía, pregunta de la etapa 0). Después:

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://finops.cscloudsolutions.com.ar/api/health
```

Esperado: `200`. Si da 525 o 526, que vuelva de inmediato al modo anterior y reportalo.

### Etapa 4: borrar el certificado gestionado (`byo`)

Precondición: etapas 2 y 3 verificadas (Azure no deja borrar un certificado en uso). Cambiá en el stamp `us` de `terraform.tfvars` la línea `custom_domain_certificate_source = "byo_staged"` por `"byo"` y subí el secret (sección 5).

**El validador del apply bloquea cualquier `delete` que no sea el de `replace`**, así que esta etapa lleva el input `replace` (se probó contra el state real: el plan sigue siendo un `delete` del certificado y el validador lo deja pasar; sin el input, lo bloquea). Plan de sólo lectura:

```bash
gh workflow run terraform.yml --repo manny864/finops --ref main -f environment=prod -f replace='module.stamp["us"].module.custom_domain.azurerm_container_app_environment_managed_certificate.this[0]'
```

Esperado, exactamente: `delete module.stamp["us"].module.custom_domain.azurerm_container_app_environment_managed_certificate.this[0]` más el `update` benigno del app. El log mostrará el aviso fijo "Se va a RECREAR": aquí no aplica, el recurso ya no está en la configuración. Con el "sí", aplicá con los dos inputs:

```bash
gh workflow run terraform.yml --repo manny864/finops --ref main -f environment=prod -f confirm=APPLY-PROD -f replace='module.stamp["us"].module.custom_domain.azurerm_container_app_environment_managed_certificate.this[0]'
```

Verificar: `az containerapp env certificate list ...` (sólo queda el propio), el dominio sigue enlazado al propio (consulta de la etapa 2) y `/api/health` en 200.

### Etapa 5: NAT Gateway

Agregá en el stamp `us` de `terraform.tfvars` la línea `nat_gateway_enabled = true` y subí el secret. Esto **cambia la salida de todo el entorno** (el app y los cron pasan a salir por una IP fija). Plan de sólo lectura, esperado: 4 `create` más el `update` benigno:

```
create module.stamp["us"].module.network.azurerm_public_ip.nat[0]
create module.stamp["us"].module.network.azurerm_nat_gateway.this[0]
create module.stamp["us"].module.network.azurerm_nat_gateway_public_ip_association.this[0]
create module.stamp["us"].module.network.azurerm_subnet_nat_gateway_association.apps[0]
```

Con el "sí", aplicá. Si Azure rechaza asociar el NAT a la subred del entorno, no cambia nada: **parar** y reportar. Después de aplicar:

```bash
az network public-ip show -g cscs-finops-prod-westus2-rg -n cscs-finops-prod-westus2-nat-pip --query '{ip:ipAddress, estado:provisioningState}' -o json
```

**Anotá la IP**: es la que va a la etapa 6. Esperá 2 o 3 minutos y verificá `/api/health` en 200 y un cron de punta a punta (con el "sí", porque lanza una ejecución):

```bash
az containerapp job start -g cscs-finops-prod-westus2-rg -n cron-prewarm-dashboard
```

```bash
az containerapp job execution list -g cscs-finops-prod-westus2-rg -n cron-prewarm-dashboard --query '[0].properties.status' -o tsv
```

Esperado: pasa de `Running` a `Succeeded` en 1 o 2 minutos (repetí la consulta). Si falla, **parar**: la salida por el NAT no funciona y no se debe filtrar el origen.

### Etapa 6: filtrar el origen a Cloudflare

Precondiciones: etapa 5 verificada, la IP del NAT anotada, y la persona confirmó la pregunta (b) de la etapa 0. En `terraform.tfvars`, **al nivel de arriba** (fuera de `stamps`), junto a `allowed_ip_ranges`, agregá:

```hcl
origin_cloudflare_only         = true
origin_extra_allowed_ip_ranges = ["<IP del NAT>/32"]
```

Subí el secret y lanzá un plan de sólo lectura. Esperado: **sólo** el `update` de `module.stamp["us"].module.app.azurerm_container_app.this` (sin `create` ni `delete`) y ningún check en rojo. Ojo: es la misma línea que el `update` benigno de `APP_VERSION`, así que el resumen **no distingue** el cambio de ingress: la verificación real es la de después del apply, y la marcha atrás tiene que estar lista.

Con el "sí", aplicá y verificá, en este orden:

```bash
az containerapp show -g cscs-finops-prod-westus2-rg -n cscs-finops-prod-westus2-web --query 'length(properties.configuration.ingress.ipSecurityRestrictions)' -o tsv
```

Esperado: `16` (15 rangos IPv4 de Cloudflare más la IP del NAT).

```bash
curl -s -m 15 -o /dev/null -w '%{http_code}\n' https://cscs-finops-prod-westus2-web.victoriousmoss-01886ec5.westus2.azurecontainerapps.io/api/health
```

Esperado: `403` (antes daba 200).

```bash
curl -s -o /dev/null -w '%{http_code}\n' https://finops.cscloudsolutions.com.ar/api/health
```

Esperado: `200`. Y un cron manual de punta a punta (`az containerapp job start ...` y la consulta de estado de la etapa 5): esperado `Succeeded`. Si da 403, el ingress ve otra IP de origen para los cron: la IP de los extras es la equivocada.

**Marcha atrás inmediata** si el dominio da 403 o 5xx, o el cron falla: poner `origin_cloudflare_only = false` en `terraform.tfvars`, subir el secret y aplicar por el workflow (unos minutos). Avisale a la persona en el mismo momento que detectes el problema, y no sigas hasta resolverlo.

## 7. Cierre

1. **Convergencia:** un plan de sólo lectura final debe mostrar únicamente el `update` benigno de `module.stamp["us"].module.app.azurerm_container_app.this`. Si trae algo más, mostralo.
2. **Documento:** en la sección 6 de `endurecimiento-infraestructura-saas-2026-10-09.md`, pasá las filas "P0 Origen" y "P1 Certificado del dominio" a "Cerrado" con la fecha y la evidencia (certificado propio hasta 2041-10-07, 16 reglas de ingress, 403 directo, 200 por el dominio, cron en `Succeeded`). Hacé un commit **local** con un mensaje claro; **no hagas push** (lo decide la persona).
3. **La persona:** borra la carpeta de la clave (`rm -rf ~/origen-cert`) y anota el vencimiento del certificado (Cloudflare no avisa).
4. El `drift` del workflow corre los lunes a las 07:00 UTC y compara el código y `TF_VARS_PROD` con la realidad: si la ejecución se interrumpe a medias, `TF_VARS_PROD` tiene que quedar **igual a lo ya aplicado**.

## 8. Qué reportar al final

Una tabla por etapa con: qué se ejecutó, el resultado y la evidencia (la salida de las verificaciones, sin secretos); cualquier diferencia con lo esperado y cómo se resolvió; y el estado final de `TF_VARS_PROD` (qué líneas se agregaron o cambiaron respecto de hoy).
