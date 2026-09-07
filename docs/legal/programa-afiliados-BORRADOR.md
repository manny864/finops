# Programa de Afiliados — Términos y Condiciones

> ## ⚠️ BORRADOR. NO PUBLICAR NI FIRMAR SIN REVISIÓN PROFESIONAL.
>
> Este documento **no es asesoramiento legal** y no lo redactó un abogado. Es la
> traducción a lenguaje contractual de lo que el sistema **hace de verdad hoy**,
> escrita para que quien redacte el acuerdo definitivo no tenga que leer el
> código y no invente reglas que la plataforma no aplica.
>
> Cada cláusula que describe una regla automática lleva la referencia al lugar
> del código que la implementa. Si el texto final se aparta de alguna, hay que
> cambiar el código o el texto: hoy coinciden.
>
> Las secciones marcadas **[A DEFINIR]** son parámetros de negocio que el código
> **no** fija. Están vacíos a propósito.
>
> Última verificación contra el código: 2026-09-07.

---

## 1. Objeto

CSCloudSolutions ("la Plataforma") ofrece al Afiliado una comisión sobre los
pagos de los clientes que el Afiliado traiga a la Plataforma mediante su enlace
de referido personal.

El Afiliado actúa por cuenta propia. Este acuerdo **no** crea relación laboral,
societaria, de agencia ni de representación, y no autoriza al Afiliado a
contratar, cobrar ni obligarse en nombre de la Plataforma.

## 2. Enlace de referido y atribución

**2.1.** La Plataforma asigna al Afiliado un código único y un enlace de la
forma `https://finops.cscloudsolutions.com.ar/signup?ref=CODIGO`.

**2.2. Ventana de atribución: 60 días.** Al ingresar por el enlace, el código
queda almacenado en el navegador del visitante durante 60 días corridos. Si el
visitante crea una cuenta dentro de esa ventana, el cliente se atribuye al
Afiliado.
<sub>Implementa: `DIAS_ATRIBUCION = 60` en `src/components/AffiliateTracker.tsx`.</sub>

**2.3. Primer toque.** Un cliente pertenece a **un solo** Afiliado y la
atribución **no se reasigna**. Si el visitante ingresó por el enlace de A y
luego por el de B, el cliente queda atribuido a A.
<sub>Implementa: índice `uq_referral_tenant` en `AffiliateReferrals`.</sub>

**2.4. Momento de la atribución.** La atribución ocurre **al crear la cuenta**.
Un cliente que ya existía en la Plataforma no se atribuye por ingresar más tarde
a un enlace de referido.
<sub>Implementa: la atribución corre en `/api/onboard`, dentro de la transacción de alta.</sub>

**2.5. Limitación técnica que el Afiliado acepta.** La atribución depende de que
el visitante conserve las cookies de su navegador. Navegación privada, borrado
de datos del sitio, cambio de dispositivo o bloqueadores pueden impedirla. La
Plataforma no compensa atribuciones no registradas por estas causas.

## 3. Exclusiones

**3.1. Auto-referidos.** No se atribuye un cliente cuando el correo del Afiliado
coincide con el de la identidad que crea la cuenta o con el de cualquier usuario
de ese cliente. La Plataforma rechaza la atribución de forma automática.
<sub>Implementa: `atribuirReferido` compara contra el correo verificado por Entra ID **y** contra la tabla `Users`.</sub>

**3.2. [A DEFINIR] Otras causales de exclusión.** El acuerdo debería enumerar
al menos: publicidad pagada sobre la marca, spam, sitios de cupones,
declaraciones falsas sobre el producto o su precio, y reventa no autorizada. Hoy
**ninguna de estas está implementada**: se detectan y se aplican a mano.

## 4. Comisión

**4.1. Porcentaje.** El porcentaje se acuerda por Afiliado. El valor por defecto
del sistema es **20 %**.
<sub>Implementa: `commission_pct DECIMAL(5,2) NOT NULL DEFAULT 20.00`.</sub>

**4.2. Base de cálculo.** La comisión se calcula sobre el **subtotal antes de
impuestos** de cada cobro, en la moneda del cobro. No se comisionan impuestos,
percepciones ni cargos de la pasarela de pago.
<sub>Implementa: el webhook usa `details.totals.subtotal` y guarda la moneda junto al monto.</sub>

**4.3. Recurrencia.** La comisión se devenga en **cada** cobro del cliente
atribuido, incluidas las renovaciones, mientras el cliente siga pagando y el
Afiliado siga activo.
<sub>Implementa: el devengo corre en cada `transaction.completed`.</sub>

**4.4. El porcentaje vigente se congela por cobro.** Cada comisión guarda el
porcentaje que estaba acordado en el momento de devengarse. Una renegociación
posterior **no** modifica lo ya devengado; aplica desde el cobro siguiente.
<sub>Implementa: `commission_pct` se copia en cada fila de `AffiliateCommissions`.</sub>

**4.5. Un cobro, una comisión.** Un mismo cobro genera una única comisión,
aunque la pasarela reintente la notificación.
<sub>Implementa: índice único `uq_commission_transaction`.</sub>

## 5. Reembolsos y contracargos

**5.1.** Si un cobro se reembolsa, la comisión correspondiente **se anula**
siempre que no haya sido liquidada.
<sub>Implementa: `transaction.refunded` sólo revierte comisiones en estado `PENDING` o `APPROVED`.</sub>

**5.2.** Una comisión **ya liquidada** no se anula automáticamente. Su importe se
descuenta de la liquidación siguiente.
<sub>Implementa: la reversa excluye el estado `PAID`. El ajuste es manual y deliberado.</sub>

**5.3. [A DEFINIR] Ventana de retención.** Plazo entre el devengo y la
aprobación para cubrir reembolsos. Hoy el sistema **no** impone ninguno: una
comisión puede aprobarse y pagarse el mismo día del cobro. Es una decisión
operativa, no técnica.

## 6. Liquidación

**6.1. Estados.** Una comisión pasa por *Pendiente* → *Aprobada* → *Pagada*.
Puede además quedar *Revertida* (reembolso) o *Cancelada* (anulación manual).

**6.2. [A DEFINIR] Umbral mínimo de pago.** Importe acumulado por debajo del
cual no se emite pago y el saldo se arrastra. Hoy **no hay umbral** en el
sistema.

**6.3. [A DEFINIR] Frecuencia y plazo de pago.** Por ejemplo "mensual, dentro de
los primeros 10 días hábiles". Hoy la liquidación es **manual y sin plazo
comprometido**.

**6.4. Medio de pago.** Lo acuerdan las partes y se registra en la ficha del
Afiliado. La Plataforma no retiene ni tramita impuestos por cuenta del Afiliado.

**6.5. [A DEFINIR] Obligaciones fiscales y documentación.** Quién emite
comprobante, bajo qué condición fiscal, y qué pasa si el Afiliado no lo emite.

## 7. Suspensión y baja

**7.1. Suspensión.** La Plataforma puede suspender al Afiliado. La suspensión
**detiene el devengo de comisiones nuevas** y **conserva** el historial y los
clientes ya atribuidos.
<sub>Implementa: la consulta de devengo filtra por `status = 'ACTIVE'`.</sub>

**7.2. Baja.** Un Afiliado con comisiones registradas **no puede eliminarse**:
la Plataforma lo impide para no destruir el registro de lo liquidado. La vía es
la suspensión.
<sub>Implementa: `eliminarAfiliado` responde 409 si existe cualquier comisión.</sub>

**7.3. [A DEFINIR] Efecto de la baja sobre lo devengado.** Si el Afiliado se da
de baja o es dado de baja, ¿se paga lo pendiente? ¿Se pierden las comisiones
recurrentes futuras de sus clientes? Hoy la suspensión corta el devengo futuro y
deja lo devengado en su estado; el acuerdo debería decir si eso se paga.

## 8. Datos y confidencialidad

**8.1.** El Afiliado accede únicamente a sus propios números —clientes
referidos, comisiones y estados— y **no** tiene acceso a la Plataforma ni a
datos de los clientes referidos.
<sub>Implementa: no existe panel de afiliado; la información se comparte fuera de la Plataforma.</sub>

**8.2.** El Afiliado no puede divulgar los importes ni la identidad de los
clientes referidos.

## 9. [A DEFINIR] Modificaciones, vigencia y ley aplicable

Preaviso para cambiar el porcentaje o las condiciones, plazo de vigencia,
renovación, jurisdicción y ley aplicable. Nada de esto está implementado ni
asumido en el código.

---

## Anexo: qué NO está implementado

Para que el acuerdo no prometa lo que la Plataforma no puede cumplir:

| Cláusula típica | Estado |
|---|---|
| Umbral mínimo de pago | **No existe** |
| Ventana de retención antes de aprobar | **No existe** |
| Plazo comprometido de liquidación | **No existe** |
| Detección automática de fraude o auto-referido por otros medios | **No existe** (sólo la regla de correo de 3.1) |
| Panel de autogestión para el Afiliado | **No existe** |
| Atribución multi-touch o última interacción | **No existe** (es primer toque) |
| Atribución cross-device | **No existe** (depende de la cookie del navegador) |
| Retención de impuestos | **No existe** |

## Anexo: dónde vive cada regla

| Regla | Archivo |
|---|---|
| Ventana de 60 días | `src/components/AffiliateTracker.tsx` |
| Primer toque, una comisión por cobro | `migrations/20260907-001-affiliates-program.sql` |
| Guard de auto-referido, devengo, reversa | `src/services/affiliates.service.ts` |
| Base pre-impuestos, recurrencia, reembolso | `src/app/api/webhooks/paddle/route.ts` |
| Atribución en el alta | `src/app/api/onboard/route.ts` |
| Suspensión y baja | `src/services/affiliates.service.ts`, `src/app/api/superadmin/affiliates/route.ts` |

Detalle técnico en `docs/lld/00-lld-completo.md` §38, arquitectónico en
`docs/hld/00-hld-completo.md` §17.3, y el manual de operación en
`docs/manual/MANUAL_SUPERADMIN_ES.md` §17.
