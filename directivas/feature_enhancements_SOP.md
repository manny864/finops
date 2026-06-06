# Directiva: Enhancements de Advisor, Madurez y Facturación

## Objetivo
Mejorar la localización de Advisor, expandir los pilares de Madurez a 5 e incluir Tooltips, y agregar manejo de errores estandarizado en la Facturación.

## Restricciones/Casos Borde
- **Azure SDK Locale**: Se debe inyectar `Accept-Language` en headers de la request (vía customHeaders en el SDK).
- **Mapeo JSON**: Usar `recommendationType.name` en lugar de duplicar `problem`.
- **Error Codes**: Usar claves estandarizadas para i18n (`ERR_INSUFFICIENT_PERMISSIONS`, etc).
