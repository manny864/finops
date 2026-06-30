# Directiva: Generación de README y Commit de Fase 1

## Objetivo
Sobrescribir el README.md predeterminado de Next.js con documentación propia del proyecto FinOps, hacer staging de todos los cambios de arquitectura Frontend/Backend y generar el commit formal de Fase 1.

## Lógica y Pasos (Python)
1. Generar y escribir un `README.md` que detalle la arquitectura (Next.js, Azure Backend, Frontend SPA, Docker).
2. Ejecutar `git add .` en la raíz del proyecto.
3. Ejecutar `git commit -m "feat: Complete Phase 1 base architecture, backend Azure APIs, and Frontend SPA layout"`.

## Trampas Conocidas
- El `README.md` previo de Next.js será sobrescrito completamente. Esto es intencional para eliminar rastro de boilerplates genéricos.
