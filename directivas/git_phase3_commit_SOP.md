# Directiva: Commit de Fase 3 (Persistencia y UX Authentication)

## Objetivo
Hacer staging y commit atómico de todos los cambios estructurales de la Fase 3, que incluyen la capa de Base de Datos MySQL, las lógicas de Onboarding, la resolución de bugs del Token MSAL (`idToken`), el flujo final de Login/Logout Redirect y la identidad visual de la aplicación (Logo y Meta Título).

## Lógica y Pasos (Python)
1. Ejecutar `git add .` en el directorio base.
2. Ejecutar `git commit -m "feat: Phase 3 - MySQL schema, MSAL Onboarding persistency, and UX refinements"`.

## Trampas Conocidas / Restricciones
- Garantizar que todos los scripts de validación y de inyección en Python (`scripts/`) queden agregados al control de versiones, ya que fungen como la "memoria procedimental ejecutable" que permitió estos cambios (SOPs automatizados).
