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

## 3. Navegación Principal

El sistema está dividido en cinco (5) pilares estratégicos en el menú lateral izquierdo:

### 3.1. Visibilidad
- **Dashboard:** Panel principal que resume el estado general de salud del Tenant. Incluye el Ahorro Potencial Total, Recursos Zombis detectados y una calificación de Gobernanza.
- **Azure Advisor:** Sincronización directa con las recomendaciones nativas de Microsoft Azure, clasificadas por Costo, Seguridad, y Excelencia Operativa.
- **Madurez FinOps:** Evaluación interactiva para determinar la madurez de la organización (Crawl, Walk, Run).

### 3.2. Inteligencia Financiera
- **Consumo Real y Presupuestos:** Monitoreo del gasto mensual contra los límites preestablecidos por departamento o centro de costos (Budget Burn).
- **Rightsizing:** Detección de Máquinas Virtuales subutilizadas con recomendaciones específicas de cambio de familia (SKU) para maximizar el retorno de inversión.
- **Licencias M365:** Identificación de licencias de Microsoft 365 asignadas pero inactivas en los últimos 30 días, promoviendo su reasignación o cancelación.
- **Ingesta CSV:** Herramienta para cargar facturación histórica de nubes de terceros bajo el estándar FOCUS.

### 3.3. Limpieza de Nube (Hygiene)
- **Recursos Zombis:** Identificación proactiva de recursos huérfanos (Ej. Discos sin adjuntar, IPs públicas sin uso, App Service Plans vacíos) que generan gastos innecesarios.
- **Expiraciones TTL:** Control sobre entornos efímeros (como Sandboxes) que han superado su Tiempo de Vida estipulado.

### 3.4. Gobernanza
- **Cumplimiento de Etiquetas:** Auditoría de la infraestructura contra las políticas de etiquetado corporativas (Ej. CostCenter, Owner, Environment).
- **Horarios de Apagado (Power Schedules):** Creación de rutinas automáticas para el encendido y apagado de flotas de Máquinas Virtuales durante horarios no productivos (Ej. Apagar a las 8 PM, encender a las 6 AM).

### 3.5. Administración
- **Usuarios y Permisos:** Visualización del personal de la organización importado desde Entra ID.
- **Configuración:** Administración general del perfil del Tenant y preferencias de suscripciones.
- **Reporte Ejecutivo:** Generación automatizada de reportes periódicos en formato de alto nivel.

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
