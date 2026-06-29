# Manual de Usuario - CSCloudSolutions FinOps Platform

Bienvenido a la Plataforma FinOps de CSCloudSolutions. Este manual está diseñado para ayudarte a navegar, comprender y aprovechar al máximo las capacidades de gobernanza, optimización y gestión financiera de recursos en la nube.

---

## 1. Introducción y Acceso

La plataforma es una solución SaaS B2B que se integra directamente con tu entorno de **Microsoft Azure** utilizando **Entra ID (Active Directory)** para la autenticación y validación de identidades.

- **Para Iniciar Sesión:** Ve a la pantalla principal de la aplicación y haz clic en "Iniciar Sesión con Microsoft".
- **Modo Demo:** Si deseas probar la plataforma sin conectar tu propio entorno de Azure, puedes utilizar uno de los perfiles comerciales preconfigurados desde la pantalla principal, los cuales proveen datos y métricas simuladas.

---

## 2. Jerarquía de Roles (RBAC)

La plataforma mapea automáticamente tu perfil corporativo hacia uno de los siguientes roles internos:

1. **SuperAdmin:** Rol global reservado para los dueños de la plataforma. Permite la administración total, incluyendo la creación de nuevos Tenants (Clientes) y configuración de pasarelas de pago.
2. **Admin (Propietario del Tenant):** Tiene acceso completo a la visibilidad financiera, modificación de configuraciones, y ejecución de acciones correctivas (como el apagado de máquinas o eliminación de recursos).
3. **Colaborador:** Acceso a inteligencia financiera y visibilidad. Puede sugerir cambios pero está restringido en áreas de administración de facturación y usuarios.
4. **Reader (Auditor):** Visibilidad exclusiva en paneles de control y reportes de solo lectura. No puede aplicar cambios ni ver datos sensibles de configuración.

---

## 3. Onboarding de Nuevos Clientes (Flujo SuperAdmin)

Para que un nuevo Tenant de Azure pueda operar dentro de la plataforma (si no ha pasado por un registro automático), un **SuperAdmin** debe completar el siguiente flujo:

1. **Registrar Tenant Manual:** Dirígete a la sección `Gestión de Tenants` (`/admin/tenants`). Aquí debes ingresar el Entra ID del Tenant, el nombre comercial de la empresa y asignar un Tier inicial. **Nota:** Si tu cuenta de Microsoft Entra oculta tu correo en la propiedad `upn`, la plataforma ya está parcheada para reconocer tu identidad y otorgarte acceso de SuperAdmin.
2. **Generar Credenciales:** Una vez creado en la base de datos, ve a `Onboarding de Clientes` (`/admin/onboarding`). Solo ahora aparecerán las casillas de **Client ID** y **Client Secret** junto al nombre del entorno, permitiéndote pegar las credenciales del Service Principal generadas por el script de PowerShell.

### 3.1. Roles Azure que el script PowerShell asigna (por tier)

El script de onboarding asigna los roles RBAC al Service Principal a nivel **suscripción**, según el tier contratado:

| Tier | Roles built-in | Custom Role |
|---|---|---|
| **Essential** | Reader, Cost Management Reader, Monitoring Reader, Billing Reader | — |
| **Professional** | Essential + Tag Contributor | — |
| **Business** | Pro + Tag Contributor | VM start/stop/restart/deallocate + tags |
| **Enterprise** | Business + Tag Contributor | Business + disk/snapshot/NIC/PublicIP/NSG delete |

> **Importante:** Los 4 roles de Essential son el mínimo absoluto para que la página **Consumo Real** muestre datos. Si falta `Cost Management Reader` o `Billing Reader`, Azure devuelve 0 filas silenciosamente.

> **Suscripciones EA/MCA:** Las suscripciones bajo Enterprise Agreement o Microsoft Customer Agreement requieren que el `Billing Admin` asigne adicionalmente `Enrollment Reader` o `Billing Account Reader` al SP en el scope de billing account. El script no puede hacerlo automáticamente — debe coordinarse con el cliente.

### 3.2. Verificación automática de permisos (post-onboarding)

Después de que el cliente ejecutó el script, **siempre validar** que los roles se asignaron correctamente. Hay dos formas:

**A. Endpoint diagnóstico** (recomendado):
```
GET /api/admin/check-sp-roles?tenantId=<tenant-id-del-cliente>
```

Respuesta resumida:
- `summary.okCount` = subs con TODOS los roles requeridos ✅
- `summary.partialCount` = subs con roles incompletos ⚠️
- `summary.noRolesCount` = subs sin ningún rol asignado al SP ❌
- `subscriptions[]` = detalle por sub con `assignedRoles` / `missingRoles`
- `globalHint` = instrucción accionable (qué role asignar y dónde)

**B. Manualmente en Azure Portal:**
Suscripción → **Access control (IAM)** → **Role assignments** → filtrar por el App Registration (`CSCloudSolutions-FinOps-Agent`) y verificar que aparezcan los roles del tier.

### 3.3. Troubleshooting: "Consumo Real no muestra datos"

Si la página `/intelligence/billing` está vacía, el toast indicará uno de estos escenarios:

| Error | Causa | Fix |
|---|---|---|
| `NO_COST_PERMISSION` | El SP ve la sub pero le falta `Cost Management Reader` | Asignar el rol al SP en esa sub |
| `NO_SUBSCRIPTION_ACCESS` | El SP no tiene `Reader` en la sub | Asignar `Reader` o re-ejecutar script |
| `SUBSCRIPTION_INACTIVE` | La sub no tiene consumo ni MTD ni en 30 días | Verificar que la sub correcta esté seleccionada |
| `NO_SUBSCRIPTIONS` | El SP no ve ninguna sub | Asignar `Reader` en al menos una sub |
| `NO_CONSUMPTION` | Subs OK pero sin consumo MTD | Esperar al cierre del ciclo o revisar otra sub |

Llamá a `/api/admin/check-sp-roles` para confirmar cuál escenario aplica antes de tocar Azure.

---

## 3. Navegación Principal

El sistema está dividido en cinco (5) pilares estratégicos en el menú lateral izquierdo:

### 3.1. Visibilidad
- **Dashboard:** Panel principal que resume el estado general de salud del Tenant. Incluye el Ahorro Potencial Total, Recursos Zombis detectados y una calificación de Gobernanza.
- **Azure Advisor:** Sincronización directa con las recomendaciones nativas de Microsoft Azure, clasificadas por Costo, Seguridad, y Excelencia Operativa. Las recomendaciones se muestran en el idioma activo seleccionado por el usuario en la plataforma.
- **Madurez FinOps:** Evaluación interactiva para determinar la madurez de la organización (Crawl, Walk, Run).

### 3.2. Inteligencia Financiera
- **Consumo Real y Presupuestos:** Monitoreo del gasto mensual contra los límites preestablecidos por departamento o centro de costos (Budget Burn).
- **Rightsizing:** Detección de Máquinas Virtuales subutilizadas con recomendaciones específicas de cambio de familia (SKU) para maximizar el retorno de inversión.
- **Rightsizing extendido (Pro):** verticales dedicadas para `VMSS`, `App Service`, `SQL Database` y `Storage` accesibles en `/intelligence/rightsizing/{vmss,appservice,sqldb,storage}`.
- **Storage Efficiency (Business):** análisis de cuentas de Storage con simulación de ahorro al mover blobs entre Hot/Cool/Archive (`/intelligence/storage-efficiency`).
- **Compute $/Core (Pro):** desglose del costo por núcleo vCPU para comparar familias de VM (`/intelligence/compute-efficiency`).
- **Alertas Self-Service (Pro):** creación/edición de reglas de alerta de presupuesto y anomalía sin intervención de soporte (`/intelligence/alerts`).
- **AI Analytics (Enterprise):** consumo de Azure OpenAI (tokens, modelos, $/1k tokens) en `/intelligence/ai-analytics`.
- **MACC Tracker (Enterprise):** seguimiento del consumo de compromiso anual EA/MCA en `/intelligence/macc`.
- **Licencias M365:** Identificación de licencias de Microsoft 365 asignadas pero inactivas en los últimos 30 días, promoviendo su reasignación o cancelación.
- **Ingesta CSV:** Herramienta para cargar facturación histórica de nubes de terceros bajo el estándar FOCUS.

### 3.3. Limpieza de Nube (Hygiene)
- **Recursos Zombis:** Identificación proactiva de recursos huérfanos (Ej. Discos sin adjuntar, IPs públicas sin uso, App Service Plans vacíos) que generan gastos innecesarios.
- **Networking Zombies (Pro):** detección dedicada de Load Balancers vacíos, NSGs sin asociación y Public IPs huérfanas (`/cleanup/zombies/networking`).
- **Expiraciones TTL:** Control sobre entornos efímeros (como Sandboxes) que han superado su Tiempo de Vida estipulado.

### 3.4. Gobernanza
- **Cumplimiento de Etiquetas:** Auditoría de la infraestructura contra las políticas de etiquetado corporativas (Ej. CostCenter, Owner, Environment).
- **HA Recommendations (Business):** VMs en producción sin Availability Zone o Availability Set (`/governance/ha`).
- **Credenciales AAD por Expirar (Business):** alerta proactiva de App Registrations / Service Principals cuyos secretos o certificados expiran en los próximos 30/60/90 días (`/governance/credentials`).
- **Horarios de Apagado (Power Schedules):** Creación de rutinas automáticas para el encendido y apagado de flotas de Máquinas Virtuales durante horarios no productivos (Ej. Apagar a las 8 PM, encender a las 6 AM).

### 3.5. Administración
- **Usuarios y Permisos:** Visualización del personal de la organización importado desde Entra ID.
- **Configuración:** Administración general del perfil del Tenant y preferencias de suscripciones.
- **Reporte Ejecutivo:** Generación automatizada de reportes periódicos en formato de alto nivel.
- **Invoicing Report (Enterprise):** export JSON / CSV / PBIT stub con detalle por `billing_profile`, `invoice_section` y `customer` en `/admin/report`.
- **Azure Lighthouse Onboarding (Enterprise):** generación de ARM template para delegación cross-tenant en `/admin/onboarding/lighthouse`.
- **M365 Copilot (Enterprise):** configuración del tenant + chat asistido sobre datos FinOps en `/admin/copilot-m365`.

---

## 4. FinOps Copilot (Asistente de IA)

La plataforma cuenta con un asistente inteligente integrado (**FinOps Copilot**), accesible a través de un ícono flotante en la esquina inferior de la pantalla.

- **Conciencia de Contexto:** El Copilot sabe en qué página te encuentras. Si estás en la vista de *Presupuestos*, puedes pedirle directamente: *"Resume el estado actual de nuestros presupuestos"*.
- **Acciones Correctivas:** El Copilot no solo provee información; también puede, previa autorización, guiarte en el borrado de recursos zombis o la aplicación de etiquetas faltantes mediante scripts automatizados.

---

## 5. Mejores Prácticas

- **Revisión Semanal:** Sugerimos acceder al **Dashboard** y la sección de **Recursos Zombis** al menos una vez por semana para capturar fugas financieras emergentes.
- **Automatización Temprana:** Activa **Horarios de Apagado** en tus entornos de Desarrollo (Dev/Test) como primera medida para asegurar ahorros del 60% en horas de cómputo inactivas.
- **Delegación de Responsabilidad:** Exige el cumplimiento de **Etiquetas (Tags)** a tus equipos de desarrollo para que el módulo de Showback/Chargeback pueda distribuir justamente la factura mensual.

> **Soporte:** Para cualquier asistencia adicional o reporte de incidencias operativas, por favor contacte al equipo administrativo a través de la sección de soporte.

---

## 6. Política de documentación de cambios

A partir de ahora, cada ajuste funcional, técnico o visual de la plataforma se registra en `CAMBIOS_IMPLEMENTADOS.md`.

Además, cada vez que se aplica un cambio también se actualizan de forma obligatoria:

1. `README.md` (documentación técnica y arquitectura)
2. `MANUAL_DE_USUARIO.md` (impacto en uso funcional)
3. `CAMBIOS_IMPLEMENTADOS.md` (bitácora de cambios realizados y futuros)
