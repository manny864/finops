# Pricing Page SOP

## Objetivo
Crear una página de "Pricing" (Precios) pública atractiva que se mostrará antes del inicio de sesión (Login), basada en la imagen de referencia. 

## Lógica y Pasos a seguir

1. **Creación del Componente**: Crear `src/components/PricingPage.tsx` con un diseño moderno, limpio y alineado al tema de la aplicación (vibrante, dark mode, glassmorphism opcional).
2. **Estructura de la Página**:
   - **Título**: "Planes Simples y Transparentes" (o similar).
   - **Tarjetas de Precios**:
     - **Free/Starter**: $0. Botón "Sign up".
     - **Professional**: $299/mes. Botón "Sign up" con etiqueta "14 Day Free Trial".
     - **Enterprise**: Custom / $899. Botón "Schedule a call".
3. **Integración en ClientShell**:
   - Modificar `src/components/ClientShell.tsx`.
   - Cuando el usuario no esté autenticado (`!isAuthenticated`), en lugar de mostrar directamente el formulario de inicio de sesión actual, mostraremos una landing que contenga la tabla de precios.
   - Alternativamente, se puede añadir un estado `showLogin` para alternar entre el "Pricing Page" y el "Login Page" actual, o que los botones de "Sign up" de los planes de Pricing redirijan directamente a `instance.loginRedirect()`.
4. **Diseño (Estética)**:
   - Uso de TailwindCSS.
   - Animaciones sutiles (hover effects en botones y tarjetas).
   - Tipografía moderna (Montserrat / Open Sans, ya configuradas).

## Trampas y Restricciones
- Asegurar que la página de Pricing sea completamente responsiva (apilando tarjetas en móvil).
- El botón "Sign up" debe iniciar el flujo de autenticación de MSAL.
- Mantener la coherencia visual con la marca "CSCloudSolutions".
