# Directiva: Bootstrap Azure FinOps Project

## Objetivo
Inicializar un proyecto Next.js desde cero con configuración para Docker en modo standalone, crear un agente de skill y estructurar la arquitectura base para la integración con Azure FinOps de manera predecible y reproducible.

## Entradas
- Ninguna interactiva (todo debe ser automático sin requerir input del usuario).

## Salidas
- Proyecto Next.js inicializado en el directorio actual.
- Archivo `next.config.ts` modificado para salida `standalone`.
- `Dockerfile` y `.dockerignore` listos para entorno de producción.
- Skill en `.agent/skills/azure-finops-expert/SKILL.md` con instrucciones core para un arquitecto de Azure FinOps.
- Archivos base: `src/lib/azure.ts`, `src/app/api/consumption/route.ts`, `src/app/api/recommendations/route.ts`.

## Lógica y Pasos
1. Ejecutar `npx create-next-app@latest ./ --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --yes` en el directorio raíz.
2. Leer y reemplazar el contenido de `next.config.ts` para agregar `output: 'standalone'`.
3. Crear el `Dockerfile` de múltiples etapas para Next.js (base, deps, builder, runner).
4. Crear `.dockerignore` para excluir `node_modules`, `.next`, etc.
5. Crear la carpeta y el archivo `.agent/skills/azure-finops-expert/SKILL.md` con las instrucciones de búsqueda de recursos zombie y optimización.
6. Crear los archivos base (esqueletos vacíos) en `src/lib/` y `src/app/api/`.

## Trampas Conocidas / Restricciones
- **CRÍTICO**: El `Dockerfile` debe usar obligatoriamente la imagen `node:22-alpine` para todas sus etapas para coincidir con el host.
- La CLI de `create-next-app` podría fallar si el directorio no está vacío.
- **Nota**: Los archivos vacíos en `app/api/.../route.ts` deben contener `export {}` para que TypeScript los reconozca como módulos válidos, de lo contrario el build fallará.
- El archivo `next.config.ts` depende del tipado de Next.js (`NextConfig`), por lo que su modificación debe hacerse respetando la constante principal del archivo generado.
- **Nota**: No hacer `create-next-app@latest .` si el directorio actual contiene mayúsculas (ej. "FinOpsProyect"), porque causa el error de restricciones de npm (`name can no longer contain capital letters`). En su lugar, hacer el bootstrap en una carpeta temporal con un nombre en minúsculas (ej. `finops-project`) y mover los archivos ocultos y visibles al directorio actual.
