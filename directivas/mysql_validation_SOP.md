# Directiva: Validación de Contenedor MySQL Local

## Objetivo
Levantar la base de datos y verificar que el pool de conexiones de Node.js (`mysql2`) autentique exitosamente sin errores de acceso o permisos.

## Lógica y Pasos
1. Ejecutar `docker compose up -d` en la raíz del proyecto.
2. Esperar a que el motor de la base de datos se inicialice y exponga el puerto TCP 3306.
3. Ejecutar un script de prueba de Node.js invocando a `mysql2/promise` hacia `mysql://finops_user:finopspassword@localhost:3306/finops_app`.

## Trampas Conocidas
- **Binarios de Docker**: En instalaciones modernas de macOS/Docker Desktop, usar `docker-compose` (con guión) fallará por archivo no encontrado. Se debe utilizar la sintaxis v2: `docker compose` (separado por espacio).
- MySQL 8.0 toma varios segundos (a veces más de 15s) en su primer arranque para inicializar el contenedor y crear el esquema de base de datos interno. Si Node.js intenta conectarse de inmediato, arrojará el error `ECONNREFUSED` o fallos de autenticación temporal. Es obligatorio incluir un bucle de reintentos (`retry loop`) en la verificación para dar tiempo a que el socket de MySQL responda.
