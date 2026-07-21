# Acuerdo de Tratamiento de Datos (DPA)

Acuerdo de Tratamiento de Datos conforme al Artículo 28 del RGPD

## 1. Definiciones (Art. 4, RGPD)
- Responsable del tratamiento: la organización del cliente, que determina los fines y medios del tratamiento de datos personales.
- Encargado del tratamiento: CSCloudSolutions, que trata datos personales por cuenta del cliente.
- Datos personales: cualquier información relativa a una persona física identificada o identificable.
- Tratamiento: cualquier operación realizada sobre datos personales (recopilación, registro, análisis, supresión, etc.).

## 2. Objeto y Duración (Art. 28.3)
- Objeto: tratamiento de datos de costos de Azure y metadatos asociados.
- Duración: durante la vigencia de la suscripción con CSCloudSolutions. El tratamiento cesa al finalizar la relación, salvo que la ley exija lo contrario.
- Naturaleza: almacenamiento, análisis y generación de informes de datos de facturación y gobernanza del cliente.
- Finalidad: prestar servicios de optimización FinOps, análisis de costos y gobernanza.

## 3. Categorías de Interesados y Datos Personales (Art. 28.3.a)
**Interesados:**
- Empleados del cliente con suscripciones de Azure
- Propietarios de recursos y administradores
- Usuarios finales del cliente a quienes se atribuyen costos

**Categorías de datos personales:**
- Direcciones de correo electrónico y nombres visibles
- ID de objeto de Azure AD (OID)
- Etiquetas de recursos que contienen identificadores de usuario
- Patrones de uso y atribución de costos

## 4. Subencargados (Art. 28.2 y 28.4)
CSCloudSolutions contrata a los siguientes subencargados. Se notifican los cambios y el cliente puede objetar dentro de los 30 días.

| Subencargado | Finalidad |
|---|---|
| Microsoft Azure | Cómputo y almacenamiento |
| MySQL Provider | Alojamiento de base de datos |
| Paddle | Procesamiento de pagos |
| WorkOS | Autenticación/SSO |

## 5. Derechos de los Interesados (Art. 28.3.e)
Asistimos al cliente en el cumplimiento de las solicitudes de los interesados conforme a los artículos 15 a 22 del RGPD (acceso, rectificación, supresión, limitación, portabilidad, oposición). Las solicitudes deben enviarse a privacy@cscloudsolutions.com.ar dentro de los 10 días hábiles.

## 6. Medidas de Seguridad (Art. 28.3.c y 32)
CSCloudSolutions implementa:
- Cifrado: TLS 1.2 o superior en tránsito; AES-256 en reposo
- Control de acceso: RBAC, integración con MSAL/Entra ID, MFA obligatorio
- Monitoreo: monitoreo de seguridad continuo y detección de intrusiones
- Registros de auditoría: todo acceso queda registrado y se conserva durante 7 años
- Recuperación ante desastres: copias de seguridad georredundantes; RTO < 4 horas

## 7. Derecho de Auditoría (Art. 28.3.h)
El cliente (o un auditor independiente) puede realizar auditorías de las prácticas de seguridad y cumplimiento de CSCloudSolutions. Los informes de auditoría SOC 2 Tipo II anuales están disponibles a pedido para clientes Enterprise.

## 8. Devolución/Eliminación de Datos (Art. 28.3.g)
Al finalizar la suscripción, el cliente puede solicitar la eliminación de datos dentro de los 30 días. Todos los datos se eliminarán de forma permanente mediante borrado criptográfico. Las copias de seguridad se conservan para recuperación ante desastres y se eliminan a los 90 días.

## Anexo 1: Tabla de Subencargados
Ver listado completo de Subencargados (finops.cscloudsolutions.com/legal/subprocessors).

## Anexo 2: Medidas Técnicas y Organizativas (TOMs)
- Medidas técnicas: cifrado, firewalls, IDS/IPS, SIEM, prácticas de codificación segura
- Medidas organizativas: controles de acceso, capacitación del personal, plan de respuesta a incidentes, evaluación de proveedores
- Detalles disponibles en el informe SOC 2 Tipo II a pedido.

---
Última actualización: 7/21/2026
