# Directiva: Commit de Refactorización de Autenticación Multi-Tenant

## Objetivo
Hacer staging de los cambios realizados en el motor del backend (`azure.ts`, endpoints de las rutas) y sus directivas operativas, y generar un commit atómico.

## Lógica y Pasos (Python)
1. Ejecutar `git add .` en el directorio base.
2. Ejecutar `git commit -m "refactor: Migrate Azure authentication to multi-tenant ClientSecretCredential model"`.

## Trampas Conocidas / Restricciones
- Asegurarse de capturar los códigos de error en Python para informar a la UI si el `git commit` falla (ej. si no hay cambios listos para el commit).
