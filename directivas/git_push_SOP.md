# Directiva: Configuración de Repositorio Remoto y Push

## Objetivo
Conectar el repositorio Git local con el remoto de GitHub (`origin`) y sincronizar la rama principal de código.

## Entradas
- Repositorio remoto: `https://github.com/manny864/finops.git`

## Salidas
- Código de la arquitectura base pusheado exitosamente al servidor remoto.

## Lógica y Pasos (vía Python)
1. Ejecutar `git remote add origin https://github.com/manny864/finops.git`.
2. Asegurar el nombramiento de la rama con `git branch -M main`.
3. Empujar los commits usando `git push -u origin main`.

## Trampas Conocidas / Restricciones
- Si la consola arroja `remote origin already exists`, se debe remover el viejo con `git remote remove origin` o usar `set-url` antes de configurar el nuevo.
- El push requiere que la terminal tenga credenciales activas o GitHub CLI autenticado localmente. De lo contrario, fallará pidiendo permisos en la consola.
