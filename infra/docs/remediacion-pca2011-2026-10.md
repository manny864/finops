# Vencimiento de Windows Production PCA 2011 (19-oct-2026) — evaluación y programa de remediación

Revisión del 2026-10-09 (viernes) sobre `CSCS-LandingZone`
(`ec03e8ce-ceee-4638-b303-64ae431d5b1e`), la suscripción del aviso. Lo medido salió
de `az` y `gh` en modo lectura; lo que dice Microsoft salió de las páginas de §10,
leídas en la fuente. El código se leyó: no se ejecutó ni se escribió nada en prod.

**El resumen en una línea: no hay que cambiar nada en el Terraform para cumplir este
aviso. La infra tiene una sola carga Windows, `vm-mysql-worker`, y lo único sin
verificar está *dentro* de esa VM, no en el código.**

Lo que sí hay que hacer, en orden:

1. **Lun 12-oct, 15 min:** la verificación de §7.1 dentro de la VM (F1).
2. **13-oct → 12-nov:** observar el parche de octubre; no hay nada que ejecutar (F2).
3. **No activar Trusted Launch por este aviso** (H3 y H6): no lo exige y, en Terraform,
   fuerza el reemplazo de la VM.

---

## 1. Qué dice el aviso, y qué no

El aviso mezcla dos cosas que comparten certificado y fecha pero rompen cosas distintas.
Hay que separarlas porque se mitigan distinto:

| | **A. Firma de código** (el aviso) | **B. Secure Boot** (mismo certificado, otro efecto) |
|---|---|---|
| Fuente | KB 5125813, 20-ago-2026 | KB 5062710 + playbook de Windows Server |
| Qué cambia | PCA 2011 → **Microsoft Windows Production PCA 2026**; después RSA-3072 + SHA-384 (fin de 2026) y firma post-cuántica (2027) | PCA 2011 (vive en el DB de UEFI y firma el boot loader) → **Windows UEFI CA 2023** |
| Quién se rompe | Aplicaciones que validan a mano la cadena de Microsoft: fijan emisor/thumbprint/serial, exigen SHA-256 o RSA-2048, parsean Authenticode ellas mismas, o tienen un trust store propio sin rotar | Equipos **con Secure Boot activo** que no reciben el DB nuevo: siguen arrancando, pero pierden protecciones y revocaciones del arranque |
| Cuándo | Los binarios de Windows empiezan a salir con la CA nueva con las actualizaciones del **13-oct**; la vieja vence el **19-oct** | **19-oct** |
| Qué hay que hacer | Nada que aplicar: hay que revisar *tu* software | En Windows Server **no llega solo** (a diferencia de los PC): `AvailableUpdates=0x5944`, GPO o WinCS |

Dos aclaraciones para no confundirse leyendo Azure Service Health:

- **13-oct es también el fin del soporte *mainstream* de Windows Server 2022** (tabla de
  release health). No tiene relación: el soporte extendido, con parches de seguridad,
  llega a 2031-10-14.
- Una VM que sigue con los certificados de 2011 después del vencimiento **sigue
  arrancando** (KB 5062710 y KB 5103014). Lo que pierde son protecciones futuras, no el servicio.

---

## 2. Qué hay realmente en la suscripción

`az resource list` sobre `CSCS-LandingZone`: 43 tipos de recurso. Lo que importa acá:

| Superficie | Resultado |
|---|---|
| VMs | **1** (`vm-mysql-worker`). Sin VMSS, AKS, host pools de AVD, máquinas Arc, galerías ni imágenes |
| App Service | 1 plan `P0v3` **Linux** (`reserved: true`): la web institucional. No está en este Terraform |
| App de la plataforma | Container Apps + jobs, imagen `node:22-alpine` (Linux) |
| CI | Los 3 workflows usan `ubuntu-latest` |
| Código del repo | Cero validaciones de firma o cadena: ni `Get-AuthenticodeSignature`, `WinVerifyTrust`, `signtool`, `certutil`, `X509Chain`, ExecutionPolicy ni thumbprints de Microsoft. Los `thumbprint` que aparecen son de la feature de vencimiento de credenciales de Entra |

**La única VM** (`infra/terraform/modules/mysql_backup/main.tf:251`):

| Atributo | Medido |
|---|---|
| Imagen | Windows Server 2022 Datacenter **Azure Edition**; Terraform pide `version = "latest"` y la imagen es `20348.5386.260711` |
| Seguridad | **Gen2, tipo Standard**: `securityType`, `secureBoot` y `vTpm` en `null` → **Secure Boot apagado** |
| Parcheo | `patchMode = AutomaticByPlatform`, `assessmentMode = AutomaticByPlatform`; sin configuración de mantenimiento asignada (`configurationAssignments` vacío, probado con dos api-version) |
| Extensiones | Sólo `HybridWorkerExtension` 1.3.76 (Terraform declara 1.1 y `auto_upgrade_minor_version = true`). **Sin** extensión de Defender/MDE ni agentes de terceros |
| Backup | Azure Backup con `EnhancedPolicy-msyrwajg`, último 2026-10-08, `Passed` |
| Encendido | 24 h desde el 2026-10-08 (decisión de Manuel; comentario del orquestador) |
| Qué corre | `mysqldump` (MySQL Workbench), `gzip` (Git for Windows), `AzCopy`, PowerShell 7.2 con Az.*. Instalados **a mano** (Fase 4 del manual), no por Terraform |

---

## 3. Los cuatro pasos que pide el aviso, aplicados a esta infra

El aviso no pide respuesta ni acuse: el cumplimiento es esta tabla más F1.

| Paso del aviso | Estado | Evidencia |
|---|---|---|
| 1. Revisar validación propia atada a certificados de Microsoft | Cumple en el código; **pendiente dentro de la VM** | El repo y los runbooks no validan nada (el worker sólo mira `Test-Path`, tamaño de archivo y exit codes). Lo instalado a mano no se ve leyendo Terraform: F1 |
| 2. Pasar la validación a `WinVerifyTrust` | No aplica | No hay validación propia que migrar |
| 3. Confirmar con los proveedores críticos | Sin acción | Microsoft (AzCopy, agente, PowerShell), Oracle (MySQL Workbench), Git for Windows. Ninguno valida firmas de Microsoft con lógica propia que sepamos; el inventario de F1 lo confirma |
| 4. Trust store privado con proceso de rotación | **Verificar** | No hay evidencia de trust store propio; F1 mira `TrustedPublisher`, AppLocker y WDAC |

---

## 4. Hallazgos

| # | Hallazgo | Severidad | Decisión |
|---|---|---|---|
| H1 | Ninguna validación de firma de Microsoft en código, IaC, runbooks ni CI | — | Sin cambios |
| H2 | El software de la VM es manual y no está versionado: es el único lugar donde podría haber una validación propia, y no se puede revisar leyendo código | **Media** (por incertidumbre, no por evidencia) | Verificar dentro de la VM (F1) |
| H3 | Secure Boot apagado según el modelo de la VM → el vencimiento del 19-oct no toca su arranque. F1 lo confirma desde adentro (`Confirm-SecureBootUEFI`) | — | Sin cambios |
| H4 | El parcheo de plataforma funciona y es lo que va a traer el CU del 13-oct. El 2026-10-09 instaló 2 parches (12:18–12:45 UTC): el build pasó de `5499` (≈10:20 UTC) a `5622` (22:51 UTC), 0 fallidos, 0 críticos/seguridad pendientes, y los ciclos de backup posteriores (17, 19 y 21 UTC) salieron `Completed` | Informativo | Observar (F2). **No volver a apagar la VM entre ciclos:** la doc exige que esté encendida en horario valle para parchear |
| H5 | `patch_mode` y `patch_assessment_mode` no están declarados en Terraform (default del provider: `AutomaticByOS` / `ImageDefault`) y la VM corre `AutomaticByPlatform`. El plan de CI del 05-oct no muestra diff para la VM y no sé explicar por qué | Baja | Opcional (§5). Una VM recreada desde Terraform, según la doc del provider, no heredaría el parcheo actual |
| H6 | `secure_boot_enabled` y `vtpm_enabled` **fuerzan reemplazo** de la VM en `azurerm 4.81.0` (doc oficial del provider). Reemplazarla destruye lo hecho a mano en la Fase 4 y el registro del worker | Alta *si* alguien lo toca | Apéndice A. No tocar por este aviso |

Si la falla llegara a ocurrir: el MySQL Flexible Server tiene backups propios
(`backup_retention_days`), así que un problema en la VM no deja la base sin respaldo; sólo
pausa los dumps lógicos, y el orquestador alerta por Teams y mail.

---

## 5. Qué cambiar en Terraform

**Obligatorio antes del 13-oct: nada.**

Opcional y de baja prioridad, con un freno: en `azurerm_windows_virtual_machine.this`
(`infra/terraform/modules/mysql_backup/main.tf`), para que una VM recreada herede el
parcheo que tiene hoy (H5):

```hcl
  patch_mode            = "AutomaticByPlatform"
  patch_assessment_mode = "AutomaticByPlatform"
```

**El freno:** hacerlo en un PR y mirar el *Resumen del plan (auditable)* de `terraform.yml`.
La VM tiene que seguir en `no-op`. Si aparece `update` o `delete+create` sobre
`azurerm_windows_virtual_machine.this`, no se aplica y se revisa. El apply es siempre
manual (`workflow_dispatch` con `confirm = APPLY-PROD`); nunca corre por push ni por PR.

**Descartado, con motivo:**

| Idea | Por qué no |
|---|---|
| Activar Trusted Launch ahora | Secure Boot está apagado: el aviso no lo exige. Cuesta un downtime, fuerza reemplazo en Terraform (H6) y volver atrás es de ida sola |
| `prevent_destroy` en la VM | Rompería el apagado intencional del módulo (`mysql_backup_enabled = false` borra VM + Bastion + Automation) |
| Fijar la `version` de la imagen | No aporta: `latest` sólo se evalúa al crear, y una VM nueva *debería* salir con la imagen más reciente |
| Ventana propia con Azure Update Manager | El parcheo ya funciona sin ventana. Es un cambio de proceso, no un requisito de este aviso |
| Feature de producto (chequeo de Secure Boot en VMs de clientes) | Especulativo: el rol del onboarding no ve dentro del guest y nadie lo pidió |

---

## 6. Programa de remediación

Hoy es viernes 09-oct: el martes 13 es en 4 días (con un solo día hábil de por medio, el
lunes) y el lunes 19 en 10.

| Fase | Cuándo | Qué | Criterio de salida |
|---|---|---|---|
| **F0** | vie 09-oct | Medición y este documento. **Hecho** | Línea base en §8 |
| **F1** | **lun 12-oct**, antes del Patch Tuesday | Verificación **dentro de la VM**, sólo lectura (§7.1): software instalado, AppLocker/WDAC, trust store propio, tareas programadas, scripts que fijen certificados, Secure Boot | Cero hallazgos cierra H2. Si aparece un AV/EDR u otro software de terceros que inspeccione binarios de Microsoft: preguntarle al proveedor si soporta la CA nueva (paso 3 del aviso) y anotarlo acá |
| **F2** | mar 13-oct → jue 12-nov | **Observar el CU de octubre.** La plataforma lo instala dentro de los 30 días, sólo en horario valle y con la VM encendida. No hay nada que ejecutar | Cuando cambie el `build`: 2 ciclos de backup `Completed`, worker con `lastSeen` < 3 min y extensión en `Provisioning succeeded` (§7.2). Si falla: restaurar el disco desde el punto de restauración de Azure Backup |
| **F3** | lun 19-oct | Punto de control del vencimiento: repetir §7.2, confirmar que `securityType/secureBoot/vtpm` siguen en `null` y que el *drift* de los lunes 07:00 UTC (12 y 19) no muestra diff de la VM | Igual que la línea base de §8 |
| **F4** | fin de 2026 y 2027 | Dos cambios ya anunciados: firma más fuerte (RSA-3072/SHA-384) a fin de año y post-cuántica en 2027. Repetir el script de F1 cuando salga el KB de cada uno. Aparte, la rotación de certificados de Windows Update de 2027 pide para WS2022 el parche de **julio-2026 o posterior antes del 19-jun-2027** | El parcheo automático lo cumple solo mientras la VM siga encendida; confirmar el build contra la tabla de release health |

**Qué no hace falta hacer:** parchear a mano, cambiar el tipo de seguridad, tocar el
runbook ni recrear la VM.

---

## 7. Comandos de verificación (sólo lectura)

### 7.1 Dentro de la VM (F1)

Por Bastion/RDP o con Run Command. Es lectura pura, en bloques chicos para que ninguno
devuelva mucha salida.

```powershell
# a) Secure Boot (esperado: False o "no activo")
try { Confirm-SecureBootUEFI } catch { "No activo: $($_.Exception.Message)" }
reg query "HKLM\SYSTEM\CurrentControlSet\Control\SecureBoot" /s 2>&1 | Select-Object -First 15

# b) Software de terceros instalado (lo que no es de Microsoft)
Get-ItemProperty 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Uninstall\*','HKLM:\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\*' -ErrorAction SilentlyContinue |
  Where-Object { $_.DisplayName -and $_.Publisher -notmatch 'Microsoft' } |
  Select-Object DisplayName, Publisher, DisplayVersion

# c) Control de aplicaciones y trust store propio
"AppLocker, reglas: " + (Get-AppLockerPolicy -Effective -ErrorAction SilentlyContinue).RuleCollections.Count
Get-ChildItem 'C:\Windows\System32\CodeIntegrity\CiPolicies\Active' -ErrorAction SilentlyContinue
Get-ChildItem Cert:\LocalMachine\TrustedPublisher | Select-Object Subject, NotAfter

# d) Tareas programadas ajenas a Microsoft y scripts que fijen certificados
Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' } | Select-Object TaskPath, TaskName, State
Get-ChildItem 'C:\Tools','C:\TempBackups' -Recurse -Include *.ps1,*.bat,*.cmd -ErrorAction SilentlyContinue |
  Select-String -Pattern 'PCA 2011','Production PCA','Thumbprint','Get-AuthenticodeSignature' | Select-Object Path, LineNumber
```

Con Run Command, un bloque por invocación (guardado como `bloque.ps1`):

```bash
az vm run-command invoke --subscription CSCS-LandingZone -g CSCS-FINOPS-PROD-WESTUS2-BACKUP-RG \
  -n vm-mysql-worker --command-id RunPowerShellScript --scripts @bloque.ps1
```

Una invocación ejecuta código en la VM de producción (de lectura, pero no es una consulta
del plano de control), por eso no la corrí al hacer esta revisión.

### 7.2 Desde `az` (F2 y F3)

Los tres primeros están probados contra la VM real. El cuarto es el mismo `GET` que usa el
orquestador (`Wait-WorkerListo`).

```bash
# Build, último parche, pendientes y estado de la extensión
az vm get-instance-view --subscription CSCS-LandingZone -g CSCS-FINOPS-PROD-WESTUS2-BACKUP-RG -n vm-mysql-worker \
  --query "{build:instanceView.osVersion, power:instanceView.statuses[?starts_with(code,'PowerState')].displayStatus|[0], ultimoParche:instanceView.patchStatus.lastPatchInstallationSummary.{estado:status,instalados:installedPatchCount,fallidos:failedPatchCount,fin:lastModifiedTime}, criticosYSeguridadPendientes:instanceView.patchStatus.availablePatchSummary.criticalAndSecurityPatchCount, rebootPendiente:instanceView.patchStatus.availablePatchSummary.rebootPending, extension:instanceView.extensions[0].statuses[0].displayStatus}" -o json
```

```bash
# Ciclos de backup (orquestador + worker)
az automation job list --subscription CSCS-LandingZone -g cscs-finops-prod-westus2-backup-rg --automation-account-name aa-mysql-backups \
  --query "sort_by([],&creationTime)[-4:].{runbook:runbook.name,estado:status,inicio:creationTime}" -o table
```

```bash
# Postura de seguridad (tiene que seguir null/null/null)
az vm show --subscription CSCS-LandingZone -g CSCS-FINOPS-PROD-WESTUS2-BACKUP-RG -n vm-mysql-worker \
  --query "{securityType:securityProfile.securityType, secureBoot:securityProfile.uefiSettings.secureBootEnabled, vtpm:securityProfile.uefiSettings.vTpmEnabled}" -o json
```

```bash
# Último poll del worker híbrido (tiene que ser de hace menos de 3 minutos)
az rest --method get --url "https://management.azure.com/subscriptions/ec03e8ce-ceee-4638-b303-64ae431d5b1e/resourceGroups/CSCS-FINOPS-PROD-WESTUS2-BACKUP-RG/providers/Microsoft.Automation/automationAccounts/aa-mysql-backups/hybridRunbookWorkerGroups/hwg-mysql-worker/hybridRunbookWorkers?api-version=2023-11-01" \
  --query "value[].properties.lastSeenDateTime" -o tsv
```

---

## 8. Línea base al 2026-10-09 (para comparar después del 13-oct)

| Dato | Valor |
|---|---|
| Build antes del parche de hoy (≈10:20 UTC) | `10.0.20348.5499` |
| Parche de plataforma de hoy | 12:18–12:45 UTC · `Succeeded` · 2 instalados · 0 fallidos · 0 críticos/seguridad pendientes · sin reinicio pendiente |
| Build a las 22:51 UTC | `10.0.20348.5622` (el último publicado es `5631`, la OOB del 14-sep) |
| Ciclos de backup posteriores al parche (17, 19 y 21 UTC) | `Completed`, orquestador y worker |
| Worker híbrido | `lastSeen` 22:42 UTC, tipo `HybridV2` |
| Seguridad de la VM | `securityType`, `secureBoot`, `vTpm` en `null` |
| Último plan de CI con apply (05-oct) | 148 no-op, 1 update (container app), 1 create (tarea de purga del ACR); la VM, no-op |

---

## 9. Lo que no pude verificar

- **El interior de la VM** (software, AppLocker/WDAC, trust store): es F1. Los cmdlets y
  rutas de su script son de uso estándar de Windows pero no los cotejé contra la
  documentación en esta revisión; es lectura, y el peor caso es una salida vacía.
- **`CSCloudSolution-Production`**, la otra suscripción visible en este login: el `az` no
  pudo autenticar (`AADSTS7000215`, secreto de service principal inválido). El aviso es de
  `CSCS-LandingZone`; si esa suscripción tiene Windows, aplica el mismo criterio. No toqué credenciales.
- **Qué certificados trae una VM *Windows* al activar Trusted Launch.** La guía de Azure que
  encontré (KB 5103014) es de Linux y dice que las VMs creadas después de abril de 2024 ya
  traen los de 2023. Para Windows sólo está el playbook de Windows Server, que dice que no se
  actualizan solos.
- **Que `Standard_D2s_v5` esté en las familias soportadas por Trusted Launch**: la página no lo
  lista en texto legible. Sólo importa si se hace el Apéndice A.
- **Por qué el plan no muestra diff en `patch_mode`** (H5) si el default del provider es distinto
  del valor real.
- **El mapeo build ↔ mes** de `5622` y `5631`: sólo conozco cuál es el último publicado.

---

## 10. Fuentes

- [KB 5125813 — Preparing the Windows ecosystem for next-generation code signing](https://support.microsoft.com/en-us/servicing/os/windows/docs/2026/08/next-generation-code-signing) (es el "Additional information" del aviso)
- [KB 5062710 — Windows Secure Boot certificate expiration and CA updates](https://support.microsoft.com/en-us/servicing/os/secure-boot/2025/06/windows-secure-boot-certificate-expiration-and-ca-updates)
- [Windows Server Secure Boot playbook for certificates expiring in 2026](https://techcommunity.microsoft.com/blog/windowsservernewsandbestpractices/windows-server-secure-boot-playbook-for-certificates-expiring-in-2026/4495789)
- [KB 5103014 — Secure Boot certificate updates for Linux on Azure VMs](https://support.microsoft.com/es-es/servicing/os/secure-boot/2026/06/secure-boot-certificate-updates-for-linux-on-azure-virtual-machines)
- [Enable Trusted launch on existing Gen2 VMs](https://learn.microsoft.com/en-us/azure/virtual-machines/trusted-launch-existing-vm)
- [Automatic VM guest patching](https://learn.microsoft.com/en-us/azure/virtual-machines/automatic-vm-guest-patching)
- [Windows Server release information](https://learn.microsoft.com/en-us/windows/release-health/windows-server-release-info)
- [Prepare for Windows Update certificate rotation in 2027](https://techcommunity.microsoft.com/blog/windows-itpro-blog/prepare-for-windows-update-certificate-rotation-in-2027/4562463)
- [Configuration Assignments - List (REST, Azure Maintenance)](https://learn.microsoft.com/en-us/rest/api/maintenance/configuration-assignments/list?view=rest-maintenance-2023-09-01-preview)
- [`azurerm_windows_virtual_machine` v4.81.0](https://raw.githubusercontent.com/hashicorp/terraform-provider-azurerm/v4.81.0/website/docs/r/windows_virtual_machine.html.markdown)

---

## Apéndice A — Si algún día se activa Trusted Launch

Sólo con un motivo propio (auditoría, política). Este aviso no lo es.

**Precondiciones, según la doc:** VM Gen2 (medido: `V2`), backup con política **Enhanced**
(medido: la tiene; con política Standard Azure no deja activarlo), tamaño soportado (sin
verificar, §9), probar antes en una VM de prueba y crear un punto de restauración.

**El orden importa por H6.** Si se activa por afuera antes de actualizar Terraform, cualquier
plan posterior propone reemplazar la VM, y un apply por otro motivo se la llevaría puesta.

1. PR que agrega a la VM `lifecycle { ignore_changes = [secure_boot_enabled, vtpm_enabled] }`.
   El plan tiene que dar `no-op`; apply manual.
2. Activarlo in-place (desasignar corta 1 o 2 ciclos de backup; el orquestador alerta):

   ```bash
   az vm deallocate -g CSCS-FINOPS-PROD-WESTUS2-BACKUP-RG -n vm-mysql-worker
   az vm update -g CSCS-FINOPS-PROD-WESTUS2-BACKUP-RG -n vm-mysql-worker \
     --security-type TrustedLaunch --enable-secure-boot true --enable-vtpm true
   az vm start -g CSCS-FINOPS-PROD-WESTUS2-BACKUP-RG -n vm-mysql-worker
   ```

3. Dentro de la VM: `Confirm-SecureBootUEFI` en `True` y el estado de los certificados
   (playbook de Windows Server): clave `UEFICA2023Status` en `Updated` y evento 1808 en el
   log System. Si no están, `AvailableUpdates = 0x5944` y reiniciar. El evento 1801 indica que
   no se aplicaron todos los certificados; el 1803 ("no se encuentra una KEK firmada por PK")
   hay que escalarlo al proveedor de la plataforma, o sea Microsoft.
4. PR que cambia el `ignore_changes` por `secure_boot_enabled = true` y `vtpm_enabled = true`.
   El plan **tiene que ser `no-op`**; si dice `delete+create`, se frena.

**Marcha atrás:** `az vm update --security-type Standard` (CLI ≥ 2.86.0, API ≥ 2025-11-01).
Es de ida sola: después no se puede volver a activar Trusted Launch en esa misma VM.
