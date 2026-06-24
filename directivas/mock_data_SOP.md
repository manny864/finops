# Standard Operating Procedure (SOP): Inyección de Mock Data

## Objetivo
Garantizar que todo nuevo módulo o funcionalidad desarrollada dentro de la plataforma (especialmente en los dashboards de Inteligencia y Gobernanza) cuente siempre con datos ficticios (Mocks) predecibles y realistas para su demostración y validación.

## Restricciones y Reglas Estrictas (Trampas Conocidas)
- **AISLAMIENTO CRÍTICO:** NUNCA se deben inyectar mocks condicionando la respuesta a `if (data.length === 0)`. Esto contamina y destruye la experiencia de tenants reales que legítimamente no poseen recursos en esa área.
- **USO EXCLUSIVO DEL TENANT DEMO:** Los mocks solo deben activarse si el `tenantId` actual forma parte de la lista blanca de tenants de demostración controlados en la plataforma.
- **CENTRALIZACIÓN:** Los datos mock no deben estar hardcodeados (escritos en duro) dentro de cada ruta individual (`route.ts`). Todo mock debe estar registrado en el archivo central.

## Pasos de Implementación para Nuevas Funcionalidades

1. **Definir el Mock en el Archivo Central:**
   Al crear un nuevo módulo, dirigirse inmediatamente a `src/lib/mockData.ts`.
   Agregar un nuevo `case` en el `switch (route)` correspondiente al nombre del nuevo módulo. Devolver los datos imitando exactamente la interfaz y estructura JSON que devolvería la API en producción.

2. **Interceptar la Ruta del Backend:**
   En el archivo de la ruta (ej. `src/app/api/nuevo-modulo/route.ts`), importar las utilidades:
   `import { isMockTenant, getMockDataForRoute } from "@/lib/mockData";`

3. **Inyectar Tempranamente (Early Return):**
   Justo después de realizar las validaciones de Autenticación y Autorización, y **ANTES** de efectuar consultas costosas a las APIs de Azure (ARG o Cost Management), se debe evaluar la condición del tenant:
   ```typescript
   if (isMockTenant(tenantId)) {
       return NextResponse.json(getMockDataForRoute('nombre_del_caso', tenantId));
   }
   ```

4. **Validar Visualización:**
   Correr la interfaz bajo el tenant de demo (o ingresando a `/demo`) y verificar que los datos fluyan correctamente hacia el UI.
