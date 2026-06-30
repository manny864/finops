# Directiva: Commit de Fase 2 (Seguridad, JWT y DB)

## Objetivo
Hacer staging de los cambios arquitectónicos introducidos en el backend y frontend (botón Admin Consent, arquitectura de Base de Datos local con MySQL, lógica de aislamiento JWT y abstracción de Key Vault), y consolidarlos en un único commit.

## Lógica y Pasos (Python)
1. Ejecutar `git add .` en el directorio base.
2. Ejecutar `git commit -m "feat: Phase 2 - Add MySQL Docker, JWT tenant isolation, Admin Consent UI, and Key Vault"`.

## Trampas Conocidas / Restricciones
- Los archivos `.env` o `.env.local` son automáticamente ignorados por el `.gitignore` por defecto de Next.js. El script de Python debe asumir que este comportamiento nativo protegerá el `NEXT_PUBLIC_CLIENT_ID` y cualquier secreto del control de versiones.
