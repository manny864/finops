# SOP - Control de Acceso Estricto en Login para Usuarios Registrados y Compras Reales

## Objetivo
Garantizar que únicamente los usuarios que existan efectivamente en la base de datos (`Users` / `Tenants`) o que cuenten con una compra/suscripción activa puedan acceder a las rutas y módulos internos del SaaS CSCloudSolutions. Si un usuario autenticado mediante Microsoft Entra ID / SSO no existe en la base de datos ni posee un entorno asociado, el sistema debe bloquear el acceso y desplegar una pantalla de advertencia institucional clara.

---

## Flujo Lógico y Principios de Autorización

1. **Autenticación vs. Autorización**:
   - La autenticación (MSAL / Microsoft Entra ID) comprueba la identidad criptográfica del usuario.
   - La autorización comprueba si esa identidad pertenece a una organización registrada en la base de datos de CSCloudSolutions (`Tenants` / `Users` / `BillingTransactions`).
2. **Validación en `/api/tenants`**:
   - `SuperAdmin` (dominio `@cscloudsolutions.com.ar` o `Users.system_role = 'SUPERADMIN'`): acceso total a los entornos.
   - `Usuario Corporativo`: debe existir en `Users` vinculado a un `tenant_id`, o su `tenant_id` de Microsoft Entra debe coincidir con un `Tenants` con suscripción activa o credenciales cargadas.
   - Si no existe: `/api/tenants` devuelve `tenants: []` e `isRegistered: false`. Bajo ninguna circunstancia se inyectan `mockTenants` a usuarios no registrados.
3. **Estado Global en `TenantProvider`**:
   - No generar ningún tenant fallback sintético (`Mi Entorno (Azure)`).
   - Exponer la bandera `isUserRegistered: boolean | null`.
4. **Barrera de Acceso en `ClientShell`**:
   - Si `isAuthenticated === true` pero `isUserRegistered === false` (y no es una ruta demo o pública):
     - Interceptar y renderizar `<UnregisteredUserScreen />`.
     - Mostrar mensaje informativo con el email autenticado, motivo del bloqueo y 3 acciones:
       1. Ver Planes y Precios (para adquirir licencia).
       2. Contactar a Soporte (`soporte@cscloudsolutions.com.ar`).
       3. Cerrar Sesión / Cambiar Cuenta (`instance.logoutRedirect()`).

---

## Restricciones y Casos Borde

1. **Cuentas Personales (MSA / Outlook / Hotmail)**:
   - Se rechazan inmediatamente con `MSA_CONSUMERS_TENANT_ID` (error 403).
2. **Rutas Demo (`/demo`)**:
   - Continúan operando mediante el session context de demo sin requerir base de datos.
3. **Rutas Públicas y Tokens de Invitación**:
   - `/legal/*`, `/status`, `/pricing`, `/auth/accept-invite/*` se excluyen de la intercepción para permitir el onboarding.
