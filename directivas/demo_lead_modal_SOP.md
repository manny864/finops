# Directiva: Demo Lead Gate Modal

## Descripción del Objetivo
Implementar una barrera de entrada obligatoria (Demo Gate) antes de que un usuario pueda acceder a las rutas de `/demo`. El usuario debe completar un formulario de leads que validará un reCAPTCHA v3 e informará al equipo de ventas de CSCloudSolutions por correo.

## Entradas
- Nombre Completo (fullName)
- Correo Electrónico (email)
- Teléfono (phone)
- Nombre de la empresa (companyName)
- reCAPTCHA Token (recaptchaToken)

## Salidas
- Formulario completado con éxito (Status 200).
- Correo de notificación enviado a `sales@cscloudsolutions.com.ar`.
- State en localStorage `hasCompletedDemoLead = true` en el frontend.

## Lógica y Pasos a Seguir
1. **Frontend (Modal):**
   - Renderizar modal con z-index alto y fondo oscuro translúcido (`bg-black/70`).
   - Evitar cualquier opción de cierre o dismiss (sin botón X, sin cerrar en blur).
   - Generar el token reCAPTCHA en el cliente utilizando la Site Key provista al hacer submit.
2. **Backend (API):**
   - Recibir los datos.
   - Validar el token contra la API de Google reCAPTCHA. Debe arrojar un score >= 0.5.
   - Enviar un correo de notificación usando el token de MS Graph API con las credenciales de entorno (`AZURE_CLIENT_ID`, `AZURE_CLIENT_SECRET`, etc.).
   - Retornar éxito.
3. **Frontend (Integración):**
   - Integrar el modal en `src/app/[locale]/demo/page.tsx`.
   - Mostrar el modal solo si el state en localStorage es falso.
   - Bloquear el scroll del background (`overflow: hidden`) mientras esté abierto.

## Restricciones y Casos Borde
- **Precaución 1:** No dejar que el componente se renderice en el servidor (SSR) si depende de `localStorage`. Utilizar `useEffect` para montar el estado, u obligar a renderizarlo siempre si no se encuentra el flag localmente para evitar parpadeos (Hydration Mismatch).
- **Precaución 2:** Google reCAPTCHA v3 requiere que el token se asocie a una acción específica o se cargue de forma dinámica sin entorpecer el flujo. Asegurarse de usar la tag `<script>` o `next/script` correctamente.
