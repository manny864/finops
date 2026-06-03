# Directiva: Inicialización de Repositorio Git

## Objetivo
Inicializar el repositorio Git local para mantener control de versiones de la arquitectura FinOps, añadiendo los archivos existentes y creando el commit inicial.

## Entradas
- El directorio de trabajo `/Users/manuelchavez/Documents/FinOpsProyect` con los archivos base.

## Salidas
- Repositorio de Git inicializado (`.git/`).
- Commit inicial con el mensaje: "Initial Next.js and Docker architecture setup".

## Lógica y Pasos (vía Python)
1. Ejecutar `git init` en el directorio raíz.
2. Ejecutar `git add .` para incluir todo el código base (ignorando lo que esté en el `.gitignore` creado en el paso de bootstrap).
3. Ejecutar `git commit -m "Initial Next.js and Docker architecture setup"`.

## Trampas Conocidas / Restricciones
- No ejecutar `git push` automáticamente. El control del remoto y el empuje del código queda a discreción del usuario.
- Si el cliente de git carece de usuario/email configurado de forma global, la ejecución de la lógica fallará.
