# Aviso de cambio de ubicación de alojamiento — borrador

**Estado:** borrador para revisión legal. **No enviado.**

## Por qué hace falta

`docs/trust-center/SUBPROCESSORS_*.md` (publicado en `/legal/subprocessors` y
anexado al DPA) dice:

> Podemos cambiar o agregar subencargados en cualquier momento. Se notificará
> con anticipación por correo electrónico (**al menos 30 días antes**), y el
> cliente tiene derecho a: revisar las prácticas del nuevo encargado, **objetar
> la incorporación dentro de los 30 días**, cancelar la suscripción si se agrega
> un encargado que no se pueda aceptar.

La migración del VPS a Azure West US 2 cambia la ubicación de procesamiento y
almacenamiento de todos los datos de clientes, que hasta ahora se declaraba
como Brasil. Es el supuesto que ese párrafo regula.

**Consecuencia de cronograma: el corte no puede ocurrir antes de 30 días
corridos desde el envío de este aviso.**

## Qué ya está actualizado en el repo

- `messages/{es,en,pt-BR}.json` — `/legal/subprocessors` y el FAQ de seguridad.
- `docs/trust-center/` — DPA, Subprocessors y Security Whitepaper, `.md` y
  `.pdf`, en los tres idiomas (regenerados con
  `node scripts/generate-trust-center-docs.js`).
- `docs/data-residency.md`.

**No publicar esos cambios antes de enviar el aviso**: la página diría una cosa
y el cliente no habría sido notificado. El orden es: enviar el aviso → esperar
30 días → desplegar → publicar los textos nuevos.

## Destinatarios

El contacto de facturación/DPO de cada tenant activo. Hoy son 5.

```sql
SELECT tenant_id, name, primary_contact_email, data_residency
FROM Tenants WHERE is_active = 1;
```

Prestar atención a los que tengan `data_residency` en `LATAM` o `EU`: son los
que tienen más motivo para objetar.

## Borrador (ES)

> **Asunto:** Cambio de ubicación de alojamiento de datos — aviso previo de 30 días
>
> Estimado/a [nombre]:
>
> Te escribimos para notificarte, con al menos 30 días de anticipación y según
> lo previsto en nuestra Política de Cambio de Subencargados, un cambio en la
> ubicación de alojamiento de la plataforma FinOps de CS Cloud Solutions.
>
> **Qué cambia.** A partir del [FECHA — 30+ días desde hoy], el procesamiento y
> almacenamiento de los datos de la plataforma pasa de Microsoft Azure región
> Brazil South (Brasil) a Microsoft Azure región **West US 2 (Estados Unidos)**.
>
> **Qué no cambia.** El subencargado sigue siendo Microsoft Azure, con el mismo
> acuerdo de tratamiento de datos y las mismas Cláusulas Contractuales Tipo. No
> cambian las categorías de datos tratados, ni las finalidades, ni los plazos de
> conservación, ni el resto de los subencargados.
>
> **Base legal para transferencias desde la UE.** Microsoft está certificada en
> el EU-US Data Privacy Framework, lo que habilita la transferencia a Estados
> Unidos conforme al Capítulo V del RGPD, con las Cláusulas Contractuales Tipo
> como salvaguarda adicional.
>
> **Motivo.** Migramos de un servidor propio a servicios administrados de Azure
> para mejorar disponibilidad, respaldo y trazabilidad. La región West US 2
> ofrece la mayor cobertura de los servicios que la plataforma necesita.
>
> **Tus derechos.** Podés revisar las prácticas de seguridad y privacidad del
> encargado, objetar este cambio dentro de los 30 días respondiendo a este
> correo, o cancelar tu suscripción si el cambio no te resulta aceptable.
> Documentación actualizada: [enlace a /legal/subprocessors] y
> [enlace al DPA].
>
> Ante cualquier duda, escribinos a privacy@cscloudsolutions.com.ar.
>
> CS Cloud Solutions

Traducir a EN y PT-BR antes de enviar: hay clientes con la plataforma en esos
idiomas y el DPA existe en los tres.

## Checklist antes del corte

- [ ] Revisión legal del texto (no es asesoramiento legal — lo escribió un agente).
- [ ] Traducciones EN y PT-BR.
- [ ] Envío registrado, con fecha y destinatarios anotados.
- [ ] 30 días corridos cumplidos.
- [ ] Objeciones resueltas o sin objeciones.
- [ ] Recién entonces: corte y publicación de los textos actualizados.
