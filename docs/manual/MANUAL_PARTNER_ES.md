<div class="cover">
<img src="../../public/CSCloudSolutions.png" alt="CSCloudSolutions" class="cover-logo" width="360" />
<h1 class="cover-title">Manual del Partner y del Equipo Comercial</h1>
<p class="cover-sub">FinOps SaaS · CSCloudSolutions</p>
<p class="cover-meta">Versión 1.0 · Octubre 2026</p>
<p class="cover-copyright">© 2026 CSCloudSolutions. Todos los derechos reservados.</p>
</div>

# 📘 Manual del Partner y del Equipo Comercial — FinOps SaaS (CSCloudSolutions)

**Versión:** 1.0
**Idioma:** Español
**Última actualización:** Octubre 2026
**Audiencia:** partners y afiliados, comerciales y equipo de preventa. No hace falta saber Azure ni FinOps para usarlo: explica qué es la plataforma, cómo funciona por dentro, qué ve el cliente y cómo venderla.

---

## Cómo usar este manual

Este manual hace dos cosas a la vez: **explica cómo funciona el SaaS** —de cara a los usuarios que lo van a usar todos los días— y **te da las ayudas para venderlo**: preguntas de descubrimiento, guion de demo, respuestas a objeciones, planes y precios, y cómo cobrás vos.

**Si tenés poco tiempo, andá directo a lo que necesitás:**

| Situación | Leé |
|---|---|
| Tengo una reunión mañana | 1, 6 y 7.3 (guion de demo) |
| Me preguntaron por seguridad o por los permisos en Azure | 3.2, 3.4 y 8 |
| Quiero saber cuánto cuesta y qué incluye cada plan | 6 |
| El cliente dice «ya tenemos Azure Cost Management» | 7.4 y 7.5 |
| Quiero saber cuánto gano y cuándo cobro | 9 |
| No entiendo un término | 10 (glosario) |

> **Una regla para todo el manual:** vendé lo que la plataforma hace hoy. En las secciones de funciones marcamos con claridad los **límites** (qué no hace todavía y qué depende del plan), porque un cliente al que se le prometió de más es un cliente que se pierde en el mes dos.

---

## 📑 Índice

1. [La plataforma en dos minutos](#1-la-plataforma-en-dos-minutos)
2. [A quién se la vendés](#2-a-quién-se-la-vendés)
3. [Cómo funciona por dentro, en lenguaje de venta](#3-cómo-funciona-por-dentro-en-lenguaje-de-venta)
4. [El recorrido del cliente: de la demo al valor](#4-el-recorrido-del-cliente-de-la-demo-al-valor)
5. [Qué ve el usuario: el recorrido por la plataforma](#5-qué-ve-el-usuario-el-recorrido-por-la-plataforma)
6. [Planes, precios y límites](#6-planes-precios-y-límites)
7. [Cómo vender](#7-cómo-vender)
8. [Preguntas frecuentes de los clientes](#8-preguntas-frecuentes-de-los-clientes)
9. [El programa de partners: cómo ganás](#9-el-programa-de-partners-cómo-ganás)
10. [Glosario](#10-glosario)
11. [Anexos](#11-anexos)

---

## 1. La plataforma en dos minutos

### 1.1. Qué es

Una plataforma **SaaS de FinOps para Microsoft Azure**. Le muestra a una empresa **en qué se le va el gasto en la nube**, **dónde lo está tirando**, y le da **los botones para arreglarlo**, con aprobaciones y registro de auditoría de cada cambio.

**El dolor que resuelve es concreto y silencioso:** discos e IPs huérfanos que siguen facturando, máquinas sobredimensionadas o encendidas de noche sin que nadie las use, gateways sin tráfico, recursos sin etiquetar de los que nadie sabe de quién son, compromisos de reservas que vencen todos el mismo mes. Nadie lo mira… hasta que llega la factura.

### 1.2. Por qué conviene frente a hacerlo a mano

- **No reemplaza a Azure Cost Management: lo usa como fuente** y le agrega lo que ese tablero no hace por sí solo —decir **qué hacer**, **quién lo hace** y **cuánto se ahorró de verdad**—. (Detalle en 7.5.)
- **Del dato a la acción en el mismo lugar.** Cada hallazgo trae su remediación (scripts de CLI, PowerShell o Terraform y, según el plan, ejecución directa desde la plataforma con aprobación).
- **Precio fijo y público.** A diferencia de las plataformas que cobran un porcentaje del consumo en nube, acá la cuota **no sube porque al cliente le crezca la infraestructura**. Sabe lo que paga antes de firmar.
- **Copilot con IA en español, inglés y portugués.** Un asistente que lee la pantalla en la que está el usuario, detecta ahorros y responde preguntas. Está en los tres planes.
- **Estándar internacional.** Exportación **FOCUS 1.1**, el formato de la FinOps Foundation: sirve al cliente que ya tiene herramientas propias o que reporta a una casa matriz.
- **Todo el equipo, no sólo el de TI.** Hay una vista ejecutiva para Dirección, tableros de costo por equipo para Finanzas y cockpits técnicos para quien opera la nube.

### 1.3. El discurso, en tres tamaños

> **En 30 segundos.** «Tu factura de Azure tiene dinero que se va en cosas que nadie usa. Esta plataforma se conecta a tu Azure en modo lectura, te muestra dónde está ese dinero y te da los botones para recuperarlo, con aprobación y auditoría. Plan fijo, sin porcentaje sobre tu consumo, y probás 7 días gratis.»

> **En 2 minutos.** Sumá a lo anterior: *cómo se conecta* (un script que crea una identidad de sólo lectura; el cliente lo ejecuta y puede revocarlo cuando quiera), *qué ve cada persona* (Dirección una vista ejecutiva; Finanzas presupuestos y reparto de costos por equipo; Operaciones recursos zombis, horarios de apagado y rightsizing) y *cómo se paga a sí misma* (el Ahorro Potencial que muestra la primera pantalla, contra el precio del plan).

> **Para un CFO.** «Previsibilidad y reparto: ves cuánto gasta cada equipo, cuánto va a gastar a fin de mes, y recibís el reporte por correo cada lunes sin entrar a buscarlo. El gasto deja de ser una sorpresa.»

### 1.4. Lo que la plataforma NO es (decíselo vos antes de que lo descubra el cliente)

- **Es sólo Azure.** No cubre AWS ni Google Cloud. (Con la *Ingesta CSV* en formato FOCUS se puede sumar facturación de terceros para analizarla junto a Azure, pero no es un tablero multi-nube.)
- **No pide ni usa el rol Contributor.** El techo de lo que puede ejecutar es un **rol personalizado** acotado (apagar VMs, etiquetar y, en Enterprise, eliminar ciertos recursos huérfanos). Lo que necesite más permisos **se muestra y se recomienda, pero no se ejecuta**.
- **La IA aconseja, no ejecuta.** El Copilot analiza y recomienda; no modifica la infraestructura del cliente.
- **No es consultoría.** Es un producto. El onboarding y la demo técnica los acompañan nuestros ingenieros, pero la plataforma se usa de forma autónoma.
- **Una sola región de despliegue** hoy (Azure West US 2). No se ofrece selección de región de datos.

---

## 2. A quién se la vendés

### 2.1. El cliente ideal

Una organización que **ya usa Azure** y cuya factura mensual justifica mirarla de cerca: la plataforma se paga con lo que encuentra (ver 7.6). Cuantas más suscripciones, más equipos desplegando por su cuenta y menos etiquetado, más valor se ve desde la primera semana.

| Tamaño y perfil | Plan que suele encajar |
|---|---|
| Empresa mediana que quiere **entender tendencias y reportar** | **Professional** |
| Empresa en crecimiento, **varios entornos** (desarrollo, pruebas, producción) y necesidad de **automatizar** | **Business** |
| Corporación con **topologías complejas** (Hub & Spoke), muchos equipos, necesidad de reparto de costos y gobernanza fuerte | **Enterprise** |
| **MSP o partner de Microsoft** que administra la nube de sus clientes | **Enterprise** (Lighthouse, markup CSP, Power BI para clientes finales) |

### 2.2. Las personas que compran (y qué le importa a cada una)

| Persona | Qué le preocupa | Qué mostrarle | Frase que funciona |
|---|---|---|---|
| **CFO / Finanzas** | Previsibilidad, presupuesto, reparto del gasto entre áreas, sorpresas en la factura | Whiteboard, Presupuestos, Gastos y Proyección, reportes por correo, showback/chargeback | «El gasto de nube deja de ser una sorpresa a fin de mes.» |
| **CTO / Dirección de TI** | Control, riesgo, gobernanza, que la nube no se desordene | Whiteboard, Gobernanza (etiquetas, políticas, fin de soporte), Madurez FinOps, Copilot | «Una vista ejecutiva y reglas que impiden el desperdicio antes de que exista.» |
| **Cloud Admin / DevOps / SRE** | Quitarse de encima el trabajo manual, no romper nada | Recursos Zombis, Horarios de Apagado, Rightsizing, TTL, Shift-Left | «Cada hallazgo trae el script y, si querés, se ejecuta con aprobación.» |
| **Analista FinOps** | Datos confiables, reparto, compromisos | Perspectives, Unit Economics, Compromisos (ESR), FOCUS, Prorrateo | «Todo en el estándar FOCUS y con el reparto auditable: la suma siempre cierra.» |
| **Líder de equipo / Product Owner** | «¿Cuánto cuesta lo mío y estoy gastando bien?» | Alcance por equipo, Leaderboard, Cost Groups | «Entra y ve sólo su porción, no el gasto de toda la empresa.» |
| **MSP / partner CSP** | Operar muchos clientes, facturarles con margen | Lighthouse, Partner Markup, Power BI de facturación, multi-tenant | «Conectás el tenant de tu cliente sin pedirle credenciales.» |

### 2.3. Qué dispara una compra

- La **factura de Azure creció** y nadie sabe por qué.
- Llega el **cierre de año fiscal** o la **planificación de presupuesto** y Finanzas pide proyecciones y reparto por área.
- Hubo una **migración reciente a Azure** y nadie gobierna lo desplegado.
- Se acerca la **renovación de un EA/MCA** o de un compromiso (MACC) y hay que llegar al número.
- Dirección pide **showback/chargeback** y no hay etiquetas confiables.
- Una **auditoría** o un incidente de seguridad exige saber quién cambió qué.
- Un **sobrecosto puntual** (un entorno de pruebas que quedó encendido todo el mes) puso el tema en la agenda.

### 2.4. Cuándo NO es para ellos (y conviene decirlo)

- **No usan Azure** (sólo AWS o Google Cloud, o sólo on-premise): la plataforma es Azure.
- **Gasto en nube muy bajo**: el precio de lista de Professional es US$ 299,99 por mes; si el gasto de Azure es muy chico, no hay de dónde recuperarlo (7.6 enseña a hacer la cuenta con los números del cliente).
- Necesitan que una herramienta **ejecute cambios con permisos amplios** sobre su nube: acá el techo es un rol acotado, a propósito.

---

## 3. Cómo funciona por dentro, en lenguaje de venta

### 3.1. El modelo, en cuatro pasos

| Paso | Qué pasa | Quién lo hace |
|---|---|---|
| **1. Conectar** | El cliente corre un **script** (que genera la propia plataforma) y crea una **identidad de lectura** (un *Service Principal*) con los roles que corresponden a su plan. Alternativa Enterprise: **Azure Lighthouse**, sin credenciales. | El cliente, con nuestra ayuda |
| **2. Leer** | La plataforma trae **costos**, **inventario de recursos**, **métricas**, **recomendaciones de Azure Advisor** y datos de identidad (credenciales por vencer, licencias), de forma programada. | La plataforma, sola |
| **3. Analizar** | Motores propios detectan desperdicio, anomalías, falta de etiquetas, compromisos mal usados, versiones por retirarse, etc., y la IA los explica. | La plataforma, sola |
| **4. Actuar** | Cada hallazgo trae su **remediación**: scripts para copiar y pegar y, según el plan, **ejecución directa con aprobación** y auditoría. | El cliente decide; la plataforma ejecuta |

### 3.2. Qué permisos pide y qué puede (y no puede) hacer en Azure

Es la pregunta de seguridad número uno. Respondela con la tabla:

| Plan | Roles de Azure | Qué puede hacer con ellos |
|---|---|---|
| **Professional** | Reader, Cost Management Reader, Monitoring Reader, Billing Reader, Security Reader y, a nivel tenant, Reservations Reader (para ver las reservas) | **Sólo leer.** No puede modificar ni borrar nada. |
| **Business** | Los de Professional + Tag Contributor + un **rol personalizado** (*CSCloudSolutions Remediation Role*) | Etiquetar; **encender, apagar, reiniciar y desasignar VMs**; gestionar presupuestos de Azure; y **eliminar recursos huérfanos** (VMs, discos, snapshots, planes de App Service, NICs, IPs públicas, NSGs y los demás tipos de red que detecta Limpieza de Nube). |
| **Enterprise** | Los de Business + Monitoring Contributor | Lo de Business más crear grupos de recursos. |

Cuatro puntos para tranquilizar al cliente:

1. **Nunca se pide el rol Contributor ni Owner** sobre la suscripción. Lo que necesite más permisos que el rol personalizado **se muestra pero no se ejecuta**.
2. **Los cambios de infraestructura que proponen los motores de optimización pasan por un flujo de aprobación** (principio de cuatro ojos: quien lo pide no lo aprueba) y **toda acción queda en el log de auditoría**. Antes de borrar un disco se puede exigir un **snapshot de respaldo**, y si el snapshot falla, el borrado no se hace.
3. **Los roles son de plano de administración** (costos, inventario, métricas, facturación): no dan acceso al contenido de las bases de datos ni de los archivos del cliente.
4. **El cliente conserva el control:** puede quitar los roles o revocar la identidad cuando quiera, y con Lighthouse delega y revoca desde su propio directorio.

Además, el script concede **permisos de lectura de Microsoft Graph** (directorio, reportes, usuarios y organización) y, según el plan, algunos puntuales: rotar secretos de App Registrations (Business+, sólo sobre las apps de las que la identidad es *owner*), actividad de inicio de sesión para el módulo de licencias y el conector de Copilot M365 (Enterprise).

> **Cuentas EA o MCA** (Enterprise Agreement / Microsoft Customer Agreement): además hace falta que el administrador de facturación del cliente asigne un rol de lectura a nivel de *billing account* (`Enrollment Reader` o `Billing Account Reader`). El script no puede hacerlo solo; hay que coordinarlo con el cliente. Es el motivo más común de una pantalla de Consumo vacía el primer día.

### 3.3. De dónde salen los datos y cada cuánto se actualizan

- **Costos:** de Azure Cost Management, sincronizados **todas las noches**. La plataforma guarda el histórico hasta **13 meses** hacia atrás, de modo que los rangos de 30 y 90 días responden al instante y no consumen la cuota de consultas de Azure.
- **El mes en curso** se consulta en vivo, con la base de la plataforma como respaldo si Azure no responde, y hay un botón **Actualizar** que omite el caché.
- **Inventario y recomendaciones:** Azure Resource Graph y Azure Advisor.
- **Métricas de uso** (CPU, memoria, RU, ancho de banda…): Azure Monitor. Si Azure no devuelve una métrica, la pantalla dice **«sin dato»** y no un cero: un cero se leería como «ocioso» y llevaría a apagar algo que quizá trabaja.
- **La primera sincronización** trae el primer set de costos en hasta un minuto desde el asistente de onboarding.

### 3.4. Seguridad y confianza

Lo que podés afirmar, con las palabras del **Centro de Confianza** público de la plataforma:

| Tema | Qué decir |
|---|---|
| **Cifrado** | TLS 1.2 o superior en tránsito; AES-256 en reposo para la base de datos y las copias de seguridad. Las claves se administran por separado en **Azure Key Vault**. |
| **Acceso** | Inicio de sesión con **Microsoft Entra ID**; **2FA propio con TOTP** (Google Authenticator, Microsoft Authenticator…), exigido para las operaciones sensibles —eliminar un tenant, cancelar la suscripción, cambiar la facturación—; **SSO SAML** para Enterprise (vía WorkOS); control por **roles** y por **permisos de dominio**. |
| **Auditoría** | Todas las acciones de usuario quedan registradas y se conservan **7 años**; el log se puede exportar. |
| **Infraestructura** | Microsoft Azure, **región West US 2**; base de datos MySQL administrada con copias automáticas; Redis con alta disponibilidad; Cloudflare delante como CDN/WAF. |
| **Continuidad** | Copias georredundantes; objetivo de recuperación **RTO menor a 4 horas** y **RPO menor a 1 hora**; **SLA de 99,9%** de disponibilidad para planes pagos (excluye mantenimiento programado). |
| **Incidentes** | Los incidentes de seguridad se investigan dentro de las **2 horas** de detectados y, ante una filtración de datos confirmada, se notifica a los clientes afectados dentro de las **72 horas**. |
| **Subencargados** | Microsoft Azure (cómputo, almacenamiento, redes), Paddle (pagos), WorkOS (SSO) y Google Gemini (modelos de lenguaje opcionales). La lista completa está en el Centro de Confianza. |
| **Privacidad** | Cumplimiento declarado del **RGPD**; **DPA** disponible; el Centro de Confianza reúne la política de privacidad, los términos, el DPA, la ficha de seguridad y la lista de subencargados. |

> ⚠️ **Lo que NO podés decir.** La plataforma **no tiene hoy certificación SOC 2**: está **en preparación para SOC 2 Tipo II, con meta en el tercer trimestre de 2027**, y **ISO 27001 está planificado para 2028**. El informe que se publica es un *resumen del estado de preparación*, no un reporte de auditoría de un tercero. Si el cliente lo exige como requisito, decilo tal cual y avisanos: no lo prometas.
>
> Tampoco ofrezcas **residencia de datos por región**: hay una sola región de despliegue.

### 3.5. La IA: qué hace, qué ve y quién la paga

- **FinOps Copilot.** Un asistente flotante, disponible en los tres planes, que **lee el contenido de la pantalla donde está el usuario** y genera un reporte ejecutivo (hallazgos, ahorros priorizados, riesgos y plan de acción a 7 días), además de responder preguntas. Responde en el idioma de la plataforma (español, inglés o portugués) y **recuerda la conversación** aunque el usuario cambie de página.
- **Aconseja, no ejecuta:** no modifica la infraestructura del cliente.
- **Cuota mensual de consultas:** Professional **50**, Business **150** y Enterprise **sin tope**. Con **clave de IA propia** del cliente (BYOK) no hay tope.
- **Quién paga la IA:** el consumo de IA con la clave de la plataforma **lo absorbe CSCloudSolutions; no se le factura al cliente** hoy.
- **Control del cliente:** un Admin del tenant puede **apagar las funciones de IA**, elegir si se comparten con el proveedor los **nombres de recursos** y las **etiquetas**, y ajustar la sensibilidad de la detección de anomalías. CSCloudSolutions además tiene un interruptor maestro que apaga la IA para todos ante un incidente con el proveedor.

---

## 4. El recorrido del cliente: de la demo al valor

### 4.1. La demo interactiva (sin conectar nada)

Es el mejor primer paso: el prospecto **ve la plataforma funcionando con datos sintéticos** y sin conectar su Azure.

1. Desde la página de precios, el botón **Demo Interactiva** (o directamente `https://finops.cscloudsolutions.com.ar/demo`). El parámetro `?tier=` elige qué plan mostrar: `professional`, `business` o `enterprise`.
2. La demo pide primero **datos de contacto** (nombre, correo, teléfono y empresa) con verificación reCAPTCHA: es también una forma de que CSCloudSolutions registre el interés.
3. Después se entra con el usuario `demo` y la contraseña `demo`.
4. Aparece un banner de **modo demo** en toda la plataforma. Las acciones que modifican algo **no se guardan** (por ejemplo, las Perspectives son de ejemplo).

> 💡 Hacé siempre la demo del **plan que le conviene al cliente**, no del más alto: ver Enterprise a un cliente de Professional genera deseo de lo que no va a poder usar.

### 4.2. Contratar y probar 7 días gratis

1. El cliente elige un plan en la **página de precios** (mensual o anual; el anual tiene un 12% de descuento) y la plataforma le pide un **correo laboral**: no se aceptan proveedores gratuitos (Gmail, Outlook…). Ese correo queda como la **cuenta administradora** del tenant.
2. Si entró por **tu enlace de referido** (`/signup?ref=TUCODIGO`), la atribución queda registrada (ver 9.2).
3. El **checkout** lo procesa **Paddle**. Es al pasar por el checkout que se activa la **prueba gratuita de 7 días**; sin pasar por ahí, el tenant no tiene acceso.
4. Mientras dura la prueba, un banner muestra los días restantes (azul, amarillo a los 4 días y rojo a los 2). Si la prueba vence sin plan pago, la cuenta queda en acceso limitado hasta que se active un plan.

### 4.3. El onboarding: lo que hace el cliente y lo que hacemos nosotros

Al entrar por primera vez, el administrador ve un **asistente de 5 pasos** (se puede saltear y retomar):

| Paso | Qué hace el cliente | Resultado |
|---|---|---|
| **1. Bienvenida** | Confirma el nombre de la empresa, la moneda de visualización y la zona horaria | Preferencias iniciales |
| **2. Conectar Azure** | Pega el **Client ID**, el **Client Secret** y el **Tenant ID** del Service Principal que creó con el script, y valida | La conexión queda lista |
| **3. Primera sincronización** | Presiona *Ejecutar sincronización* | Trae su primer set de costos (hasta un minuto) |
| **4. Primer presupuesto** | Define nombre, límite mensual y umbral de alerta | Primer presupuesto activo |
| **5. Notificaciones** | Agrega un canal (correo, Slack o Teams) | Recibe alertas |

**Lo que tiene que preparar el cliente del lado de Azure** (la checklist del anexo B):
- Un usuario con permisos para **ejecutar el script** y asignar roles en sus suscripciones.
- Saber **qué suscripciones** quiere monitorear (el plan define el tope: 2, 3 o ilimitadas).
- Si tiene **EA/MCA**, que el administrador de facturación asigne el rol de lectura a nivel de *billing account*.
- Si va a usar **Lighthouse** (Enterprise), un administrador del directorio que acepte la delegación.

**Lo que hacemos nosotros:** acompañamos la demo técnica, la arquitectura y el onboarding. La plataforma incluye además una **Academia FinOps** (cursos, videos, glosario) que cada usuario nuevo recorre al comenzar.

### 4.4. Los primeros 30 días: cómo se ve el valor

| Cuándo | Qué ve el cliente | Qué conviene pedirle que haga |
|---|---|---|
| **Día 1** | El Whiteboard con el costo del mes, el forecast, los recursos zombis y el **Ahorro Potencial** | Revisar el número de Ahorro Potencial: es el argumento del retorno |
| **Semana 1** | Recursos zombis y huérfanos concretos, con su costo mensual; recomendaciones de Advisor; cumplimiento de etiquetas | Remediar los primeros hallazgos y **configurar un canal de notificación** |
| **Semana 2-3** | Horarios de apagado de entornos de desarrollo y pruebas, Cost Groups por equipo, presupuestos | Programar apagados fuera de horario; asignar presupuestos |
| **Mes 1** | Primer reporte ejecutivo, anomalías con responsable, **Ahorro Capturado** | Suscribir a Dirección y a Finanzas a un reporte periódico |

> Una buena práctica del propio manual del usuario: *«es común ver ahorros del 60% en horas de cómputo inactivas»* al programar apagados en entornos de desarrollo y pruebas. Usalo como orientación, no como promesa: el ahorro real depende de cada cliente.

---

## 5. Qué ve el usuario: el recorrido por la plataforma

Este es el mapa de lo que el cliente va a usar todos los días. Para cada pantalla: **el problema que resuelve**, **qué ve el usuario** y **cómo contarlo**. El menú lateral agrupa todo en cinco pilares; casi cada entrada es un *hub* con pestañas. El plan mínimo figura en cada fila (**P** = Professional, **B** = Business, **E** = Enterprise; «+» significa «desde ese plan»).

> El detalle de cada pantalla, paso a paso, está en el **Manual de Usuario** (se descarga desde el ícono de ayuda de la plataforma). Este manual es la versión para vender.

### 5.1. Visibilidad — «¿cómo vamos?»

| Pantalla | Problema que resuelve | Qué ve el usuario | Cómo contarlo | Plan |
|---|---|---|---|---|
| **White Board** | «¿Cómo viene el gasto este mes y dónde hay plata para recuperar?» | Costo del período (mes en curso, 30 o 90 días), forecast, recursos zombis, **Ahorro Potencial**, impacto ambiental, presupuestos, servicios que más pesan y **Quick Wins** con botón *Optimizar* | La pantalla para Dirección: en diez segundos sabe si hay un problema | P+ |
| **Azure Advisor** | Las recomendaciones de Microsoft están dispersas y nadie les da seguimiento | Las recomendaciones nativas de Azure en tu idioma, con ahorro estimado, y la posibilidad de **posponer** o **descartar** con registro | «Lo que Azure ya te recomienda, ordenado y con seguimiento» | P+ |
| **Madurez FinOps** | «¿Qué tan bien gestionamos la nube?» | Evaluación Crawl / Walk / Run en 6 dimensiones, con puntaje y hoja de ruta; el cliente elige si manda la autoevaluación del equipo, la telemetría de Azure o un promedio | Una conversación de Dirección: dónde estamos y qué sigue | P+ |
| **Progreso Histórico** | «¿Estamos mejorando?» | Tendencia mensual, hitos de ahorro, comparativas mes a mes y año a año, anotaciones | Prueba de resultados para el comité | P+ |
| **TOP Gastos** | «¿Qué es lo que más pesa?» | Ranking por servicio, suscripción o grupo de recursos, con detalle por recurso | Dónde enfocar el esfuerzo | P+ |
| **Recursos** | «¿Qué tengo desplegado y a cuánto?» | Inventario completo con filtros, etiquetado en masa y exportación | El inventario que Azure no te da con costo al lado | B+ |
| **Green FinOps** | «¿Cuál es la huella de mi nube?» | Estimación de carbono por servicio y comparación de regiones | Un argumento de sostenibilidad | P+ |
| **Ahorro Capturado** | «¿Cuánto ahorramos de verdad?» | Los ahorros ya conseguidos, incluso los hechos **directamente en Azure**, con cálculo de ROI | **La prueba del retorno** | P+ |
| **Fugas Financieras** | «¿Dónde se escapa el dinero?» | Recursos abandonados, sobredimensionamiento y redundancia, con calendario de remediación | Una lista de acciones, no un reporte | P+ |
| **Academia FinOps** | «Mi equipo no sabe de FinOps» | Cursos, videos y glosario; los usuarios nuevos la recorren al comenzar | Capacitación incluida | P+ |

### 5.2. Inteligencia Financiera — «¿dónde está la plata y qué hago?»

| Hub | Problema que resuelve | Qué ve el usuario | Cómo contarlo | Plan |
|---|---|---|---|---|
| **Consumo y Presupuesto** | Entender el gasto real, presupuestarlo y proyectarlo | Consumo real por servicio y recurso, por categoría, **presupuestos con alertas**, **Cost Groups** por proyecto o línea de negocio, presupuesto por centro de costo con **arrastre del saldo no gastado**, **proyección** a 3-24 meses, ingesta de CSV FOCUS | «De la factura al presupuesto, en un solo lugar» | P+ (las pestañas avanzadas B/E) |
| **Optimización y Ahorro** | Pagar menos por lo mismo | **Rightsizing** (el SKU óptimo con 30 días de uso real), **Reservas** y Savings Plans con simulador de punto de equilibrio, **tasa efectiva de ahorro (ESR)**, aviso de reservas que vencen juntas, **avisos automáticos a 90, 60 y 30 días del vencimiento de cada reserva**, Hybrid Benefit, costo cero, Índice de Optimización | «Cada decisión de compra con su número» | E |
| **Bases de Datos** | Las bases de datos son de las partidas más volátiles | Cosmos DB (con **optimizador de RU/s**), SQL, PostgreSQL, MySQL, MongoDB, Redis y Fabric, con métricas reales | «Dónde sobra capacidad y dónde falta» | B+ |
| **Cómputo** | VMs, contenedores y serverless sobredimensionados o ociosos | VMs, App Services, Functions, **Azure Virtual Desktop** (costo por usuario), contenedores, VMSS, **Kubernetes** (con chargeback por namespace) y OpenShift | El cockpit del equipo de operaciones | B+ |
| **Almacenamiento** | Cuentas, discos y backups que crecen sin dueño | Storage Accounts, discos, backups y Data Lake, con ahorro potencial y eficiencia | «Qué storage no necesita estar donde está» | E |
| **Redes** | Costos de red que no aparecen en el costo de los recursos | Análisis de red, conectividad híbrida, balanceo, **egress** (a dónde se va la plata de mover datos) y **capacidad de enlaces** (ExpressRoute/VPN sobredimensionados) | «Los costos ocultos de la red, a la vista» | B+ |
| **Usuarios y Licencias** | Licencias M365 sin uso | KPIs de M365 y Entra ID, actividad de usuarios y optimización de licencias | Ahorro en licencias, no sólo en Azure | E |
| **Azure AI** | El gasto en IA crece rápido y sin control | Costo por modelo y consumo de tokens (Foundry/OpenAI), AI Search, Document Intelligence, Speech, Vision, ML, Databricks | «El gasto de IA, bajo control» | E |
| **Azure Integration Services** | Integraciones (Logic Apps, APIM, Service Bus…) que cuestan más de lo esperado | Operación y costo de Logic Apps, APIM, Service Bus, Event Grid, Event Hubs y Data Factory | Para clientes con muchas integraciones | E |
| **Monitoreo** y **Seguridad** | Los servicios de observabilidad y seguridad también facturan | Log Analytics, Application Insights, Sentinel, Defender, Key Vault, WAF, DDoS… con oportunidades de ahorro | «Hasta lo que cuesta vigilar, bajo control» | E |
| **Analítica Avanzada** | Decisiones financieras de nivel experto | **Unit Economics** (costo por transacción o cliente), **prorrateo** de costos compartidos, Scorecard, **detección de anomalías**, salud del tenant, simulador **What-If** y seguimiento del compromiso **MACC** | Lo que pide un analista FinOps | E |
| **Perspectives** | Repartir el gasto por equipo, producto o entorno **sin depender de que todo esté etiquetado** | Reglas ordenadas que reparten el costo; **la suma de los grupos más lo «sin asignar» da exactamente el total** | «Un reparto que cierra y se puede auditar» | E |
| **Leaderboard de equipos** | Premiar a quien optimiza, no a quien gasta menos | Ranking por **mejora**, split costo de venta / gasto operativo (cada equipo se clasifica desde la tabla) y **margen bruto** | «Gamificación con criterio» | E |

### 5.3. Limpieza de Nube — «dejá de pagar lo que nadie usa»

| Pantalla | Problema que resuelve | Qué ve el usuario | Plan |
|---|---|---|---|
| **Recursos Zombis** | Discos, IPs, NICs, planes y VMs huérfanos que siguen facturando | Barrido de 25 tipos de recursos, desperdicio **duro** (plata directa) vs **blando** (gobernanza), remediación con snapshot previo | P+ (remediación B+) |
| **Networking Zombies** | Gateways, IPs y endpoints de red sin uso | Gateways VPN/ExpressRoute ociosos, IPs huérfanas, Private Endpoints desconectados, NAT y firewalls sin uso | P+ (remediación B+) |
| **Expiraciones TTL** | Entornos de prueba que quedan vivos para siempre | Políticas de vida útil, etiqueta de expiración, semáforo de vencimiento y prórrogas | B+ |
| **Backups Huérfanos** | Backups de recursos que ya no existen | Detección, costo exacto, purga segura y exenciones por cumplimiento legal | P+ (remediación B+) |

### 5.4. Gobernanza — «que no vuelva a pasar»

| Pantalla | Problema que resuelve | Qué ve el usuario | Plan |
|---|---|---|---|
| **Cumplimiento de Etiquetas** | Sin etiquetas no hay reparto de costos | Auditoría de las 4 etiquetas estructurales, **sugerencia con IA** de las que faltan y herencia desde el grupo de recursos | P+ (auto-corrección B+) |
| **Alertas Self-Service** | Enterarse de un desvío cuando ya pasó | Reglas por presupuesto, umbral fijo, anomalía o forecast, con entrega a Teams, Slack, correo, webhook o ServiceNow | P+ |
| **Horarios de Apagado** | Máquinas encendidas de noche y fines de semana | Programación de encendido y apagado con **Smart Shutdown** (no apaga una VM que está trabajando) y ahorro calculado | B+ |
| **Alta Disponibilidad** | No saber qué tan expuesto está lo crítico | Brechas de redundancia, SLA actual vs alcanzable en minutos de caída por mes | B+ |
| **Fin de soporte** | Versiones que Azure retira, sin presupuesto para migrar | Qué corre sobre una versión que se retira, cuándo, y **cuánto cuesta hoy** | B+ |
| **Credenciales por Expirar** | La caída por un secreto vencido | Inventario de secretos y certificados de Entra ID, alertas previas y rotación | B+ |
| **Aprobaciones** | Cambios sin control | Flujo de **cuatro ojos** sobre los cambios que proponen los motores, con historial auditable | B+ |
| **Políticas Auto-Block** | Prevenir el costo antes de que exista | Azure Policy con plantillas (restringir tamaños, regiones, exigir etiquetas) | E |
| **Reporte de Gobernanza** | «¿Qué tan seguros y ordenados estamos?» | **Score de Seguridad Financiera** 0-100, cumplimiento de políticas, RBAC y recursos zombis | E |
| **Shift-Left FinOps** | El costo se decide cuando alguien escribe el código | El costo de un `terraform plan` **dentro del Pull Request**, con umbrales por repositorio | B+ |

### 5.5. Administración y transversales

| Pantalla o función | Qué ve el usuario | Plan |
|---|---|---|
| **Usuarios y Accesos** | Alta de usuarios (con búsqueda en Entra ID), roles, permisos por módulo, 2FA, SSO SAML (E), onboarding y Lighthouse (E) | P+ |
| **Reportes y Exportación** | **Reporte ejecutivo** en PDF, historial, reporte de facturación, Workbooks, plantillas Power BI, exportación **FOCUS 1.1** y **suscripciones por correo** a la cadencia que se elija | P+ (algunos B/E) |
| **Integraciones y API** | API REST pública, claves MCP para asistentes de IA, Copilot M365 | E |
| **Facturación y Auditoría** | Plan, cuotas, cambio de plan con prorrateo, **audit trail** exportable | P+ |
| **Marketplace** | Módulos y cupos a la carta con pases temporales | Todos |
| **Soporte** | Tickets con el equipo dentro de la plataforma, con SLA | P+ |
| **App móvil (PWA)** | Resumen, alertas, aprobaciones, soporte y perfil desde el celular | Todos |
| **Multi-idioma y multi-moneda** | Español, inglés y portugués; el usuario ve los importes en su moneda | Todos |
| **Alcance por equipo** | Que cada responsable vea **sólo su porción** del gasto, aplicado en el servidor; se asigna desde la pantalla de usuarios | E |

---

## 6. Planes, precios y límites

Los precios son los de lista, en **dólares estadounidenses**, vigentes a octubre de 2026. **Todos los planes arrancan con prueba gratuita de 7 días.**

### 6.1. Los tres planes

| | Professional | Business | Enterprise |
|---|---|---|---|
| **Precio mensual** | US$ 299,99 | US$ 999,99 | A convenir |
| **Precio anual** | US$ 3.167,88 | US$ 10.559,88 | A convenir |
| **Ahorro pagando anual** | 12% | 12% | — |
| **Suscripciones de Azure** | Hasta 2 | Hasta 3 | Ilimitadas |
| **Usuarios** | Hasta 3 | Hasta 5 | Ilimitados |
| **Para quién es** | Empresas medianas que necesitan entender tendencias y reportar | Empresas en crecimiento con varios entornos | Corporaciones con topologías complejas, y MSPs |

> **Business no se compra por el volumen de suscripciones** (incluye 3 y cuesta casi 3,3 veces Professional): se paga por **capacidades** —remediación, automatización, FOCUS, markup, API—. Si el cliente sólo necesita más suscripciones o usuarios, hay add-ons más baratos (6.3).

### 6.2. Qué incluye cada plan

✓ = incluido · — = no incluido

**Capacidad y cuentas**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Suscripciones de Azure | Hasta 2 | Hasta 3 | Ilimitadas |
| Usuarios | Hasta 3 | Hasta 5 | Ilimitados |
| Multi-moneda | ✓ | ✓ | ✓ |
| Delegaciones multi-tenant | — | ✓ | ✓ |

**Visibilidad y control de costos**

| | Professional | Business | Enterprise |
|---|---|---|---|
| White Board (vista ejecutiva) | ✓ | ✓ | ✓ |
| Historial, facturación y presupuestos | ✓ | ✓ | ✓ |
| Consumo real (dashboard detallado) | ✓ | ✓ | ✓ |
| Alertas multicanal (presupuesto, anomalías, umbrales) | ✓ | ✓ | ✓ |
| Madurez FinOps | ✓ | ✓ | ✓ |
| Exportación FOCUS 1.1 | ✓ | ✓ | ✓ |
| Progreso histórico, TOP gastos, Green FinOps, ahorro capturado, fugas financieras | ✓ | ✓ | ✓ |
| Recursos (inventario) y costos por categoría | — | ✓ | ✓ |
| Cost Groups (presupuesto y forecast por unidad de negocio) | — | ✓ | ✓ |
| Ingesta CSV | — | ✓ | ✓ |
| Reporte ejecutivo | — | ✓ | ✓ |
| Gastos y proyección a 12 meses, presupuesto por centro de costos | — | — | ✓ |
| Perspectives, Leaderboard y alcance por equipo | — | — | ✓ |
| Prorrateo de costos compartidos (Allocation) | — | — | ✓ |

**Ahorro y remediación**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Recursos zombis y Networking zombis | Detecta | Detecta y remedia | Detecta y remedia |
| Cumplimiento y auditoría de etiquetas | Audita | Audita y corrige | Audita y corrige |
| Backups huérfanos | Detecta | Detecta y remedia | Detecta y remedia |
| Encendido y apagado automático de VMs | — | ✓ | ✓ |
| Expiraciones TTL | — | ✓ | ✓ |
| Credenciales por expirar (Entra ID) | — | ✓ | ✓ |
| Alta disponibilidad, Fin de soporte, Shift-Left | — | ✓ | ✓ |
| Action Center (Quick Fixes con scripts) y supresión de recomendaciones | ✓ | ✓ | ✓ |
| Aprobaciones de remediación (flujo de cuatro ojos) | — | ✓ | ✓ |
| Rightsizing de cómputo y base de datos | — | — | ✓ |
| Reservas, Savings Plans y simulador de punto de equilibrio | — | — | ✓ |
| Beneficios Híbridos (AHB) | — | — | ✓ |
| Inventario de costo cero | — | — | ✓ |
| Simulador What-If | — | — | ✓ |
| Eficiencia de storage y de cómputo | — | — | ✓ |
| MACC tracking y burn-rate | — | — | ✓ |

**Bases de datos, cómputo, redes y servicios (hubs)**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Bases de Datos, Cómputo y Redes | — | ✓ | ✓ |
| Kubernetes (AKS), chargeback por namespace y Unit Economics | — | — | ✓ |
| Almacenamiento, Usuarios y Licencias, Azure AI, Integration Services, Monitoreo, Seguridad, Analítica Avanzada | — | — | ✓ |

**Inteligencia artificial**

| | Professional | Business | Enterprise |
|---|---|---|---|
| FinOps Copilot (consultas por mes) | 50 | 150 | Sin tope |
| Detección de anomalías (Z-Score) | — | — | ✓ |
| AI Cost Analytics (Azure OpenAI y Cognitive Services) | — | — | ✓ |
| Costos de Microsoft 365 Copilot y claves MCP | — | — | ✓ |

**Automatización, gobernanza e integraciones**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Registro de auditoría completo | ✓ | ✓ | ✓ |
| Notificaciones (Slack, Teams, correo, webhook) | ✓ | ✓ | ✓ |
| 2FA para operaciones sensibles | ✓ | ✓ | ✓ |
| Azure Key Vault (cifrado gestionado) | ✓ | ✓ | ✓ |
| Políticas preventivas (Auto-Block) y Reporte de Gobernanza | — | — | ✓ |
| Azure Lighthouse (multi-tenant MSP) | — | — | ✓ |
| Motor de billing para partners CSP y markup de reventa | — | — | ✓ |
| Plantillas Power BI y Power BI de facturación | — | — | ✓ |
| SSO federado (SAML 2.0) | — | — | ✓ |
| API REST pública | — | — | ✓ |

**Soporte**

| | Professional | Business | Enterprise |
|---|---|---|---|
| Tickets incluidos | 20 por mes | Ilimitados | Ilimitados |
| Primera respuesta (SLA) | 24 h | 8 h | 4 h |
| Soporte dedicado | — | — | ✓ |

> **Azure Lighthouse es el argumento de peso con MSPs.** Permite conectar el tenant de un cliente sin pedirle credenciales ni correr scripts en su entorno: el cliente delega el acceso desde su propio directorio y lo revoca cuando quiere.

> **Azure Marketplace.** La compra a través del Marketplace de Azure (útil para clientes Enterprise que quieren consumir su compromiso con Microsoft) está construida técnicamente, pero **la oferta se publica por un circuito administrativo aparte**. Antes de ofrecerla a un cliente, confirmá con nosotros su estado. Un cliente facturado por el Marketplace de Azure no puede, además, contratar módulos adicionales desde la plataforma.

### 6.3. Add-ons y Marketplace de la plataforma

Si el cliente necesita **una función o un cupo** que su plan no incluye, no hace falta saltar de plan. En **Administración → Marketplace** se contratan complementos sueltos, con **suscripción mensual prorrateada** o con un **pase temporal** de 1, 3, 6, 9 o 12 meses (se paga una vez y, al vencer, se desactiva solo, sin tocar el plan). Precios de lista de referencia, por mes; el Marketplace muestra el vigente.

| Complemento | US$ / mes |
|---|---|
| **Suscripción de Azure adicional** | 40 |
| **Asientos de usuario extra (+5)** | 35 |
| **Tenant adicional** (otro tenant de Azure con la misma cuenta) | 90 (Professional) · 240 (Business) |
| Simulador de Compromisos RIs & Savings Plans | 49 |
| Auditoría Avanzada de Zombies y Redes | 59 |
| Informes Ejecutivos en PDF | 39 |
| Módulo **Aprobaciones** | 39 |
| Módulos **TTL**, **Horarios de Apagado** y **Alta Disponibilidad** | 59 c/u |
| Módulos **Inventario de Recursos** y **Credenciales por Expirar**, y **Redes** | 79 c/u |
| Módulos **Bases de Datos** y **Cómputo** | 129 c/u |
| Módulos de Enterprise (**Optimización y Ahorro**, **Almacenamiento**, **Usuarios y Licencias**, **Azure AI**, **Integration Services**, **Monitoreo**, **Seguridad**, **Analítica Avanzada**, **Políticas y Auto-Block**, **Reporte de Gobernanza**) | 129 c/u |

El **tenant adicional** cuesta aproximadamente el **30% del plan base** (no un monto plano): un monto fijo sería el 50% del plan para Professional y el 19% para Business. **Enterprise** no usa add-ons por unidad: su capacidad se negocia por contrato, porque una factura por unidad vuelve impredecible justo lo que ese comprador rechaza.

### 6.4. Facturación

- Los cobros los procesa **Paddle**; los precios se confirman ahí. Mensual o anual (el anual tiene un **12%** de descuento).
- Cambiar de plan muestra **antes de confirmar** el monto real calculado por la pasarela («Se cobrará ahora $X» o «Recibirás un crédito de $X»), con prorrateo inmediato, en el próximo ciclo o sin cobro inmediato. Hasta confirmar, se cancela sin costo.
- El cliente descarga sus facturas y actualiza su tarjeta desde **Facturación**.
- Los importes que ve la plataforma se pueden mostrar en la **moneda del usuario** (con tipo de cambio), pero **los precios de lista son en dólares**.

### 6.5. Cuándo recomendar cada plan

| Si el cliente… | Recomendá |
|---|---|
| Quiere **entender y reportar** el gasto de 1 o 2 suscripciones, con pocos usuarios | **Professional** |
| Quiere **actuar** (apagar, remediar, etiquetar), tiene varios entornos o necesita repartir costos por unidad de negocio | **Business** |
| Necesita **repartir por equipo con reglas propias**, optimizar compromisos, anomalías, SSO, API, o es un **MSP** | **Enterprise** |
| Está en un plan y le falta **una sola cosa** | Un **add-on** del Marketplace, antes que un salto de plan |

Un cliente puede **empezar chico y subir**: la plataforma le avisa cuando algo está fuera de su plan (con un candado y un modal que explica qué desbloquea), y el cambio con prorrateo se hace en un par de clics.

---

## 7. Cómo vender

### 7.1. Preguntas de descubrimiento

No vendas funciones: **escuchá el dolor** y mostrá la pantalla que lo resuelve. Estas preguntas abren la conversación; anotá las respuestas, vas a usarlas en la demo.

| Tema | Preguntas |
|---|---|
| **Contexto** | ¿Cuántas suscripciones y tenants de Azure tienen? ¿Cómo contratan: EA, MCA o CSP? ¿Más o menos cuánto gastan por mes y cómo viene la tendencia? |
| **Visibilidad** | ¿Quién mira la factura de Azure y cada cuánto? Cuando el gasto se desvía, ¿cómo se enteran y cuántos días tardan? |
| **Reparto** | ¿Cómo reparten el gasto entre áreas o clientes hoy: planilla, etiquetas, nada? ¿Qué porcentaje de los recursos está etiquetado? |
| **Desperdicio** | ¿Qué hacen con los recursos que nadie usa? ¿Los entornos de desarrollo y pruebas se apagan fuera de horario? ¿Cuándo fue la última limpieza? |
| **Compromisos** | ¿Tienen Reservas o Savings Plans? ¿Cuándo vencen? ¿Quién decide la renovación? |
| **Control** | ¿Quién aprueba un cambio en producción? ¿Les piden evidencia en una auditoría? |
| **Equipo** | ¿Hay alguien dedicado a FinOps o lo hace TI «en sus ratos»? |
| **Decisión** | ¿Quién decide una compra de este tipo? ¿Hay presupuesto? ¿Hay una fecha (cierre de año, renovación de EA, planificación) que fije el momento? |

**Preguntas extra por persona:** al **CFO**, «¿Qué tan seguido te sorprende la factura de nube?». Al **CTO**, «¿Cómo sabés que lo que se despliega cumple tus reglas?». Al **responsable de operaciones**, «¿Cuántas horas por mes dedican a buscar recursos sin dueño?».

### 7.2. Calificación: ¿vale la pena avanzar?

| Señales verdes | Señales de alerta |
|---|---|
| Usan Azure con varias suscripciones o equipos | Sólo AWS, Google Cloud u on-premise |
| La factura creció o los sorprende | Gasto muy bajo, sin perspectiva de crecer |
| Poco etiquetado y nadie dueño de los recursos | Quieren que una herramienta ejecute cambios con permisos amplios |
| Hay una fecha (cierre, renovación) que apura | Exigen hoy una certificación SOC 2 o residencia de datos por región |
| Quien decide está en la conversación | Ninguna persona con decisión ni presupuesto a la vista |

### 7.3. Guion de demo en 20 minutos

**Antes:** elegí la demo del **plan que le conviene al cliente** (`?tier=`), recorré el guion una vez (usa datos sintéticos y algunas acciones de escritura no se guardan) y tené a mano las respuestas de descubrimiento.

| Min | Pantalla | Qué mostrar | Qué decir |
|---|---|---|---|
| 0-2 | — | Retomá su dolor con sus propias palabras | «Me dijiste que la factura te sorprende. Veamos cómo se ve eso resuelto.» |
| 2-5 | **White Board** | Costo del período (cambiá entre mes, 30 y 90 días), forecast, **Ahorro Potencial**, zombis, Quick Wins | «Esta es la vista de Dirección. Y este número es plata que se puede recuperar.» |
| 5-9 | **Limpieza → Recursos Zombis** | Los 25 tipos, desperdicio duro vs blando, el botón de remediación con snapshot previo, y **Aprobaciones** | «Cada recurso sin uso, con su costo mensual. Y nada se borra sin que otra persona lo apruebe.» |
| 9-11 | **Gobernanza → Horarios de Apagado** | Una regla de apagado y el **Smart Shutdown** (no apaga una VM que está trabajando) | «Apagar los entornos de pruebas de noche y fines de semana es de lo más rentable que hay.» |
| 11-13 | **Gobernanza → Etiquetas** y **Cost Groups** | La sugerencia de etiquetas con IA y el reparto por unidad de negocio | «Sin etiquetas no hay reparto justo. Esto lo ordena casi solo.» |
| 13-15 | **Consumo y Presupuesto** y **Alertas Self-Service** | Un presupuesto con umbral, una alerta que llega a Teams o Slack | «Te enterás del desvío cuando pasa, no cuando llega la factura.» |
| 15-17 | **Copilot** | Una pregunta en vivo sobre la pantalla actual | «Le preguntás en tu idioma y analiza lo que estás viendo.» |
| 17-19 | **Reportes** | El reporte ejecutivo y las **suscripciones por correo** | «Dirección y Finanzas lo reciben solos, cada lunes.» |
| 19-20 | **Planes** | El plan que corresponde y la prueba de 7 días | «Se prueba 7 días gratis. ¿Armamos el onboarding esta semana?» |

**Variantes.** *Enterprise:* sumá **Perspectives y Leaderboard** (el reparto que cierra, el ranking por mejora), **Reservas** con ESR y reservas que vencen juntas, **Shift-Left** (el costo en el Pull Request) y, si es un MSP, **Lighthouse**. *Para Finanzas:* menos recursos, más Presupuestos, Gastos y Proyección y Reportes. *Para Operaciones:* más Zombis, Cómputo y Horarios.

### 7.4. Manejo de objeciones

| Objeción | Qué hay detrás | Cómo responder |
|---|---|---|
| «Ya tenemos Azure Cost Management / Advisor» | Cree que ya está cubierto | «Son el punto de partida, y los usamos como fuente. Lo que agregamos es decir qué hacer, quién lo hace y cuánto se ahorró: zombis con remediación y aprobación, etiquetas con IA, apagados, reparto por equipo, presupuestos con alertas y reportes que llegan solos.» |
| «Es caro» | No ve el retorno | «Hagamos la cuenta con tu gasto» (7.6). «Y el precio es fijo: no sube cuando crece tu consumo.» |
| «No queremos darle permisos a un tercero» | Riesgo de seguridad | 3.2: roles de **sólo lectura** en Professional, sin Contributor ni Owner en ningún plan, revocables, y con Lighthouse sin credenciales. «Podés empezar sólo con lectura.» |
| «¿Y si ejecuta algo y rompe producción?» | Miedo a la automatización | Los cambios pasan por **aprobación de cuatro ojos**, con snapshot previo y auditoría; el rol está acotado a propósito; **el Copilot no ejecuta**. |
| «No tenemos tiempo para implementar otra herramienta» | Costo de adopción | «Se conecta con un script y la primera sincronización trae datos en un minuto. Probás 7 días sin compromiso, y nuestros ingenieros acompañan el onboarding.» |
| «Lo armamos nosotros con Power BI o planillas» | Prefiere construir | «Se puede, pero alguien lo mantiene. Acá ya tenés los motores, el estándar FOCUS y las plantillas de Power BI. Y tu equipo se dedica a decidir, no a mantener consultas.» |
| «Ya usamos otra plataforma FinOps» | Costo de cambio | Preguntá qué le falta. Diferenciales: **precio fijo** (no un porcentaje del consumo), remediación con aprobación, Copilot en tres idiomas, FOCUS 1.1. «No tenés que decidir hoy: probalo en paralelo 7 días.» |
| «Nuestro gasto no es tan grande» | No ve el retorno | Hacé la cuenta (7.6). Si de verdad es muy chico, decíselo: es mejor un «todavía no» honesto que un cliente que se va. |
| «¿Dónde están nuestros datos?» | Compliance | 3.4: región **West US 2**, TLS 1.2+ y AES-256, Key Vault, auditoría por 7 años, DPA y lista de subencargados públicos. |
| «Necesitamos SOC 2» | Requisito formal | Con honestidad: **está en preparación (meta Q3 2027)**. Ofrecé el Centro de Confianza, el DPA y una reunión con nuestros ingenieros; y avisanos. |
| «Usamos más de una nube» | Alcance | «Hoy es Azure. Con la ingesta de CSV en formato FOCUS podés sumar facturación de otros proveedores para analizarla al lado.» |
| «¿La IA ve nuestros datos?» | Privacidad | 3.5: lee lo que está en pantalla, el cliente elige si comparte nombres de recursos y etiquetas, puede **apagar la IA**, y no ejecuta cambios. |
| «Esperemos a fin de año» | Falta de urgencia | «La prueba es de 7 días y no hay compromiso. Lo que se desperdicia cada mes no se recupera.» |

### 7.5. Posicionamiento frente a las alternativas

| Alternativa | Qué hace bien | Dónde se queda corta | Cómo posicionar |
|---|---|---|---|
| **Azure Cost Management y Advisor** (nativos) | Muestran el gasto y recomendaciones de Microsoft, sin costo extra | Dicen *qué* pasa, pero no organizan *quién* lo corrige, ni lo ejecutan con aprobación, ni reparten por equipo con reglas propias, ni mandan el reporte solos | «Complemento: usamos sus datos y cerramos el ciclo hasta el ahorro capturado» |
| **Planillas y Power BI propios** | Total flexibilidad | Alguien tiene que mantenerlos; cada cambio de Azure los rompe; no accionan | «Tu equipo decide en vez de mantener» |
| **Otras plataformas FinOps de terceros** | Cobertura amplia, muchas multi-nube | Muchas cobran un **porcentaje del consumo**, así que la cuota sube con el cliente | «Precio fijo y público; foco profundo en Azure; remediación con aprobación» |
| **Consultoría o auditoría puntual** | Una foto experta | Se desactualiza apenas termina | «La plataforma lo hace todos los días; puede complementar a la consultoría» |

> Sé justo con la competencia: no la desacredites ni afirmes lo que no podés demostrar. El cliente compara.

### 7.6. Cómo cuantificar el valor

La plataforma se paga con lo que encuentra. La cuenta, con los números del propio cliente:

1. **Mirá el Ahorro Potencial** del White Board (en la demo, con los datos sintéticos; en la prueba de 7 días, con los suyos). Sumá lo que ves en **Recursos Zombis** (el costo mensual de lo huérfano), el **apagado de entornos** de desarrollo y pruebas (horas fuera de horario por el costo de esas máquinas) y, si es Enterprise, lo que muestra **Reservas** y el simulador de punto de equilibrio.
2. **Aplicá una estimación prudente** de cuánto se concreta (por ejemplo, la mitad).
3. **Compará contra el precio anual del plan** (Professional: US$ 3.167,88; Business: US$ 10.559,88).
4. **Después de la prueba, usá Ahorro Capturado**: el ahorro real, con la fecha y quién lo hizo.

> **Ejemplo ilustrativo, con números inventados para mostrar la cuenta (no es una promesa ni un dato de ningún cliente).** Si el White Board mostrara un Ahorro Potencial de US$ 2.000 por mes y se concretara sólo la mitad, serían US$ 1.000 por mes, US$ 12.000 por año, contra US$ 3.167,88 del plan Professional anual: unas 3,8 veces lo que cuesta.

**Qué NO hacer:** prometer un porcentaje de ahorro. El ahorro depende del cliente. Mostrá su dato.

### 7.7. Mensajes listos para usar

**Primer contacto (correo corto)**

> **Asunto:** La factura de Azure de [Empresa]
>
> Hola [Nombre]: trabajo con una plataforma de FinOps para Azure que le muestra a empresas como la tuya en qué se va el gasto de nube y dónde hay dinero para recuperar —recursos que nadie usa, máquinas encendidas de más, compromisos mal usados—, con aprobaciones y auditoría. Es de precio fijo y se prueba 7 días gratis. ¿Te parece si te muestro en 20 minutos cómo se ve con datos de ejemplo? — [Tu nombre]

**Después de la demo**

> Hola [Nombre]: gracias por el tiempo. Resumo lo que vimos: [dolor 1 → pantalla], [dolor 2 → pantalla]. Para probarlo con tus datos, este es el enlace de registro: [tu enlace de referido]. Son 7 días gratis y te acompañamos con el onboarding. ¿Lo armamos esta semana?

**Mensaje corto (LinkedIn o chat)**

> Hola [Nombre], ¿cómo viene la factura de Azure? Si te interesa ver dónde se escapa plata sin que nadie lo note, tengo una demo de 20 minutos de una plataforma FinOps. Sin compromiso.

> Recordá: usá siempre **tu enlace de referido** (`…/signup?ref=TUCODIGO`) cuando compartas el registro, así el cliente queda atribuido a tu nombre (9.2).

---

## 8. Preguntas frecuentes de los clientes

### Producto

**¿Qué es y qué no es?** Una plataforma de FinOps **para Azure**: visibilidad, optimización, gobernanza y reportes. No es multi-nube y no es consultoría.

**¿Reemplaza a Azure Cost Management?** No: lo usa como fuente de datos y le suma análisis, remediación con aprobaciones, reparto por equipo, reportes y la IA.

**¿Funciona con EA, MCA y CSP?** Sí. En EA y MCA hace falta además un rol de lectura a nivel de *billing account* que asigna el administrador de facturación del cliente. Con CSP, el plan Enterprise suma el motor de facturación para partners, el *markup* de reventa y Power BI de facturación.

**¿Cuántos datos históricos trae?** Hasta **13 meses** de costos.

**¿Cada cuánto se actualizan los datos?** Los costos, **todas las noches**; el mes en curso se consulta en vivo y el usuario puede forzar una actualización con el botón *Actualizar*.

**¿En qué idiomas está?** Español, inglés y portugués (Brasil), incluidos los manuales y el Copilot.

**¿Se puede usar desde el celular?** Sí: hay una app web instalable (PWA) con resumen, alertas, aprobaciones, soporte y perfil.

**¿Puede exportar los datos?** Sí: exportación **FOCUS 1.1** (CSV, JSON, NDJSON), reportes en PDF, plantillas de Power BI y, en Enterprise, una **API REST pública** y claves MCP para asistentes de IA.

### Conexión y permisos

**¿Cuánto tarda en estar funcionando?** El cliente corre un script, carga las credenciales en el asistente y presiona *Ejecutar sincronización*: la primera sincronización trae los primeros costos en hasta un minuto.

**¿Qué permisos necesita?** Ver 3.2. En Professional, sólo lectura. Business y Enterprise suman un rol personalizado acotado para actuar. Nunca Contributor ni Owner.

**¿Y si el cliente tiene muchas suscripciones?** El plan define el tope (2, 3 o ilimitadas). Si hay más de las que permite, las que quedan afuera se ven atenuadas con la marca «Fuera del plan» y **no alimentan ningún tablero**; el cliente elige cuáles monitorear o amplía el cupo con un add-on.

**¿Se puede conectar sin darnos credenciales?** Con **Azure Lighthouse** (Enterprise): el cliente delega el acceso desde su propio directorio y lo revoca cuando quiera.

**¿Una suscripción nueva en Azure requiere rehacer el onboarding?** No: los roles de lectura se asignan en el grupo de administración raíz y se heredan; aparece sola al sincronizar. Sólo hay que asignar a mano el rol de remediación si se quiere *actuar* sobre ella.

### Seguridad y datos

**¿Dónde se guardan los datos?** En Azure, región **West US 2**. Hay una sola región de despliegue.

**¿Cómo se protege la información?** Cifrado TLS 1.2+ y AES-256, claves en Azure Key Vault, 2FA para operaciones sensibles, SSO SAML en Enterprise, roles y permisos por módulo, y log de auditoría con retención de 7 años.

**¿Tienen SOC 2?** No todavía: **en preparación, meta tercer trimestre de 2027**. ISO 27001, planificado para 2028. Hay Centro de Confianza, DPA y lista de subencargados públicos.

**¿Qué proveedores externos intervienen?** Microsoft Azure, Paddle (pagos), WorkOS (SSO) y Google Gemini (modelos opcionales).

**¿Quién puede ver los datos de mi organización?** Sólo los usuarios del tenant que el propio cliente da de alta, con el rol y los permisos que defina. Un administrador puede además **acotar** a una persona a su porción de gasto, y la restricción la aplica el servidor.

### Facturación y soporte

**¿Cuánto cuesta?** Ver 6. Professional US$ 299,99 al mes, Business US$ 999,99, Enterprise a convenir; el anual tiene un 12% de descuento.

**¿Hay prueba gratuita?** Sí, **7 días**, que se activa al pasar por el checkout.

**¿Puedo cambiar de plan?** Sí, con prorrateo calculado por la pasarela y visible antes de confirmar. También puede sumar módulos o cupos sueltos desde el Marketplace.

**¿Qué soporte incluye?** Tickets dentro de la plataforma: 20 por mes con respuesta en 24 horas (Professional), ilimitados con 8 horas (Business) o 4 horas (Enterprise, con soporte dedicado).

**¿Dónde veo si la plataforma está funcionando?** En la **página de estado** pública (`/status`), con el estado de cada componente y el historial de incidentes.

### Inteligencia artificial

**¿La IA modifica mi infraestructura?** No. Analiza y recomienda.

**¿La IA ve mis datos?** Trabaja con lo que está en la pantalla. El cliente puede elegir si se comparten los nombres de recursos y las etiquetas, usar **su propia clave** de IA o **apagar** las funciones de IA.

**¿Cuánto me cuesta usar la IA?** Hoy el consumo de IA con la clave de la plataforma lo absorbe CSCloudSolutions: no se factura aparte. Hay una cuota mensual de consultas al Copilot por plan (50, 150 o sin tope).

---

## 9. El programa de partners: cómo ganás

Sin exclusividad, sin cuota mínima y sin que tengas que hacer una demo técnica: eso lo hacemos nosotros. Elegís cuánto te querés involucrar en cada cuenta y podés usar las dos modalidades con clientes distintos.

### 9.1. Las dos modalidades

| | **Referido** | **Co-venta** |
|---|---|---|
| **Comisión** | **15%** | **20%** |
| **Sobre qué** | Cada cobro del cliente | El valor anual de la venta |
| **Durante** | Los primeros **12 meses** del cliente | Ver abajo |
| **Qué hacés** | Compartís tu enlace | Presentás la cuenta y co-liderás la oportunidad |
| **Qué hacemos nosotros** | Todo lo demás | Demo técnica, arquitectura y onboarding |

**La ventana de 12 meses se cuenta por cliente, no desde que firmás vos.** Si traés una cuenta en marzo y otra en noviembre, cada una comisiona sus doce meses desde su propio primer cobro. Se mide en meses y no en cantidad de cobros: «hasta 12 cobros» le daría doce años a un cliente que paga anual.

**Cómo se devenga la co-venta**, según cómo paga el cliente:

- **Contrato mensual:** una cuota por mes, que equivale al 20% de cada cobro mensual, hasta 12 cuotas. El primer mes no se liquida (período de onboarding) y vence junto con el segundo: tras el segundo cobro se liquidan las dos primeras cuotas, y del tercer mes en adelante cada cobro devenga su cuota.
- **Contrato anual:** una sola cuota, el 20% del cobro anual, exigible a partir del **segundo mes** de la venta. La renovación del año siguiente no la vuelve a pagar.
- Si el cliente se da de baja, se cancelan las cuotas que todavía no eran exigibles; lo ya exigible o pagado no se toca.

**Qué significa en plata** (sobre precios de lista, suponiendo que el cliente paga los doce meses):

| Plan que contrata tu cliente | Referido (15%) | Co-venta (20%) |
|---|---|---|
| Professional — US$ 299,99/mes | US$ 540 | US$ 720 |
| Business — US$ 999,99/mes | US$ 1.800 | US$ 2.400 |
| Enterprise — a convenir | Según contrato | Según contrato |

Los importes se calculan sobre el **subtotal antes de impuestos** de cada cobro. No se comisionan impuestos, percepciones ni cargos de la pasarela de pago.

### 9.2. Tu enlace de referido y cómo queda un cliente a tu nombre

Te damos un enlace propio con tu código:

```
https://finops.cscloudsolutions.com.ar/signup?ref=TUCODIGO
```

1. Compartís el enlace por donde quieras: correo, LinkedIn, tu propia web.
2. Alguien entra por ahí y su navegador guarda tu código por **60 días corridos**.
3. Si se da de alta dentro de esa ventana, el cliente queda **atribuido a vos**.
4. Desde su primer cobro, cada pago suyo te devenga comisión durante 12 meses.

**Las cuatro reglas:**

- **Primer toque gana.** Un cliente pertenece a un solo partner y la atribución no se reasigna. Si entró por tu enlace y después por el de otro, es tuyo.
- **La atribución ocurre en el alta.** Una empresa que ya era cliente antes no se atribuye por entrar más tarde a un enlace de referido.
- **Tu porcentaje se congela en cada cobro.** Si más adelante renegociamos el %, lo ya devengado no se toca: lo nuevo aplica desde el cobro siguiente.
- **Sin auto-referidos.** No se atribuye un cliente cuando tu correo coincide con el de alguien de esa empresa. El sistema lo rechaza solo.

> **El límite que conviene que sepas.** La atribución depende de que el visitante conserve las cookies de su navegador. La navegación privada, el borrado de datos del sitio, el cambio de dispositivo o los bloqueadores pueden impedirla. Si estás trabajando una cuenta importante, **avisanos antes de que se registre** y la atribuimos a mano: es la forma segura de no depender de una cookie.

### 9.3. Tu panel

Cuando te damos de alta recibís un **enlace personal de sólo lectura** a tu panel. No necesitás usuario ni contraseña: **el enlace es la credencial**.

```
https://finops.cscloudsolutions.com.ar/partner#k=…
```

Se abre en el idioma de tu navegador, y lo cambiás con el **selector de idioma** de arriba a la derecha (español, inglés o portugués) sin perder el acceso.

**Qué ves:**

- Cuánto tenés **por cobrar** y cuánto **ya te pagamos**.
- Tus **clientes referidos**, con la fecha hasta la que comisiona cada uno.
- El detalle de cada comisión: empresa, fecha, base, porcentaje, importe y estado.
- **Este manual**, en español, inglés y portugués, para descargar en PDF o en Markdown, desde el botón *Manual del partner* del panel.

**Qué NO ves** (a propósito): el gasto en nube de los clientes que trajiste, sus identificadores de Azure ni nada de otros partners. Sólo el nombre de la empresa, las fechas y tus propios importes.

**Cuidá el enlace:** quien lo tenga ve tus números. No lo pegues en un grupo. Si lo perdés, pedinos uno nuevo: el anterior deja de funcionar. Si dejamos de trabajar juntos, lo revocamos y el panel se cierra.

### 9.4. Cómo y cuándo cobrás

Cada comisión pasa por estos estados, y los ves todos en tu panel:

| Estado | Qué significa |
|---|---|
| **Pendiente** | Devengada. El cliente pagó y tu comisión quedó registrada; se espera la ventana de reembolsos antes de aprobarla. |
| **Exigible** | Lista para liquidar. |
| **Aprobada** | Revisada de nuestro lado. |
| **Pagada** | Ya te la transferimos, con su comprobante. |
| **Revertida** | El cliente pidió reembolso y la comisión se anuló. |
| **Cancelada** | Anulada a mano. |

- Las transferencias se arman **por lote**: agrupamos todo lo que te corresponde en un pago, no una transferencia por comisión. Si hay un **mínimo**, el saldo que no lo alcanza se arrastra al pago siguiente.
- **Si un cliente pide reembolso**, la comisión se anula si todavía no te la liquidamos. Si ya te la pagamos, se descuenta de la liquidación siguiente.
- Una comisión **Pagada** no se vuelve atrás desde el sistema: una corrección es una operación contable.

**Lo que acordamos al firmar.** Preferimos decirlo ahora y no que lo descubras después. Estas cuatro cosas **no** están fijadas de antemano y se definen con vos en el acuerdo:

1. **Con qué frecuencia liquidamos.** Hoy no hay un calendario automático.
2. **El medio de pago.** Transferencia, o lo que acordemos; lo registramos en tu ficha.
3. **Si hay un mínimo** por debajo del cual el saldo se arrastra al pago siguiente.
4. **La documentación fiscal.** Quién emite comprobante y bajo qué condición. No retenemos ni tramitamos impuestos por tu cuenta.

> Los porcentajes de este manual son los del **programa estándar** y se confirman en el acuerdo firmado.

### 9.5. Cómo empezar

1. **Una llamada de 15 minutos:** vemos si tu red encaja y respondemos lo que falte.
2. **Firmamos el acuerdo**, con tu porcentaje y las condiciones de liquidación.
3. **Te damos de alta:** recibís tu enlace de referido y el enlace de tu panel.
4. **Te pasamos el material comercial** y coordinamos la primera demo cuando la necesites.

No hace falta que sepas Azure ni FinOps. Hace falta que tengas llegada a CTOs, CFOs, directores de tecnología o responsables de infraestructura.

### 9.6. Buenas prácticas para vender sin pasarte

- **Prometé lo que la plataforma hace hoy.** Los límites están marcados en 1.4, 3.4 y 6.2.
- **No prometas una certificación** (SOC 2, ISO 27001) ni la residencia de datos por región.
- **No garantices un porcentaje de ahorro:** mostrá el dato del propio cliente (7.6).
- **Confirmá precios y condiciones antes de cotizar.** Los de este manual son los de lista a octubre de 2026; cualquier condición especial (descuento, plazo, piloto) se coordina con CSCloudSolutions antes de ofrecerla.
- **Compartí siempre tu enlace de referido** y avisanos de las cuentas importantes antes de que se registren.
- **Ante una duda técnica o de seguridad, escalala:** nuestros ingenieros están para eso.

---

## 10. Glosario

| Término | Qué significa |
|---|---|
| **FinOps** | La práctica de gestionar el gasto en la nube con datos compartidos entre Finanzas, Tecnología y Negocio. |
| **FOCUS** | *FinOps Open Cost and Usage Specification*: formato estándar de la FinOps Foundation para los datos de costo. La plataforma exporta en FOCUS 1.1. |
| **Service Principal** | La identidad de aplicación que el cliente crea en Entra ID para que la plataforma lea su Azure con los roles justos. |
| **Azure Lighthouse** | Mecanismo de Azure para **delegar** el acceso a un tenant sin compartir credenciales; el cliente lo revoca cuando quiere. |
| **RBAC** | Control de acceso basado en roles. En Azure, qué roles tiene una identidad; en la plataforma, qué puede hacer cada usuario. |
| **EA / MCA / CSP** | Modalidades de contrato con Microsoft: *Enterprise Agreement*, *Microsoft Customer Agreement* y *Cloud Solution Provider* (a través de un partner). |
| **MACC** | *Microsoft Azure Consumption Commitment*: compromiso de consumo mínimo anual con Microsoft. |
| **Reserva (RI)** | Compromiso de 1 o 3 años sobre un recurso específico a cambio de un descuento frente al pago a demanda. |
| **Savings Plan** | Compromiso de gasto por hora, más flexible que una reserva. |
| **Pago a demanda (PAYG)** | Pagar por uso sin compromiso: la tarifa más alta. |
| **ESR** | *Effective Savings Rate*: cuánto se ahorra realmente contra pagar todo a precio de lista, descontando el compromiso que no se usó. |
| **Azure Hybrid Benefit (AHB)** | Descuento por usar licencias de Windows Server o SQL Server que el cliente ya tiene. |
| **Rightsizing** | Ajustar el tamaño de un recurso a su uso real. |
| **Recurso zombi** | Recurso que sigue facturando sin cumplir ninguna función (disco sin adjuntar, IP huérfana, VM sin uso…). |
| **Hard waste / Soft waste** | Desperdicio monetario directo / desalineación de gobernanza (por ejemplo, falta de etiquetas). |
| **TTL** | *Time-To-Live*: vida útil de un recurso efímero antes de su expiración. |
| **Etiqueta (tag)** | Metadato clave-valor en un recurso (Entorno, Centro de costos…), base del reparto de costos. |
| **Showback / Chargeback** | Mostrar a cada área cuánto gasta / cobrárselo internamente. |
| **Cost Group / Centro de costo** | Agrupación de costos por proyecto, línea de negocio o área. |
| **Perspective** | Reparto del gasto por reglas ordenadas (equipo, producto, entorno) en el que cada recurso cae en un solo grupo. |
| **Unit Economics** | Costo por unidad de negocio (por transacción, por usuario, por cliente). |
| **Anomalía** | Desvío de gasto fuera de lo normal, detectado por estadística (Z-Score). |
| **Forecast / proyección** | Estimación del gasto futuro. |
| **MTD** | *Month-To-Date*: lo acumulado en el mes en curso. |
| **Shift-Left** | Llevar el control de costos a una etapa más temprana: el Pull Request, antes del despliegue. |
| **Budget Gate** | Umbral que hace fallar un Pull Request si el cambio agrega más costo del permitido. |
| **BYOK** | *Bring Your Own Key*: el cliente usa su propia clave de IA. |
| **PAL / CPOR** | Mecanismos de Microsoft para asociar a un partner con un cliente (*Partner Admin Link*, *Claiming Partner of Record*). |
| **PWA** | Aplicación web instalable en el celular. |
| **Tenant** | La organización del cliente dentro de la plataforma (y, en Azure, su directorio de Entra ID). |

---

## 11. Anexos

### Anexo A. Checklist de la reunión

**Antes**
- [ ] Sé a qué plan apuntar y tengo la demo de ese plan lista (`?tier=`).
- [ ] Recorrí el guion de demo (7.3) una vez.
- [ ] Tengo mi enlace de referido a mano.

**Durante**
- [ ] Hice las preguntas de descubrimiento (7.1) y anoté las respuestas.
- [ ] Mostré el dolor del cliente, no una lista de funciones.
- [ ] Respondí las objeciones con honestidad (7.4), incluidos los límites.
- [ ] Acordé el siguiente paso con fecha.

**Después**
- [ ] Mandé el resumen con el enlace de registro.
- [ ] Si es una cuenta importante, le avisé a CSCloudSolutions **antes** de que se registre.

### Anexo B. Lo que el cliente tiene que preparar para el onboarding

- [ ] Una persona con permisos para **ejecutar el script** y **asignar roles** en las suscripciones a monitorear.
- [ ] La lista de **suscripciones** a conectar (dentro del tope de su plan).
- [ ] Si tiene **EA o MCA**: el administrador de facturación asigna el rol de lectura a nivel de *billing account*.
- [ ] Un **correo laboral** para el administrador del tenant (no se aceptan proveedores gratuitos).
- [ ] Al menos un **canal de notificación** (correo, Slack o Teams).
- [ ] Si usa **Lighthouse**: un administrador del directorio que acepte la delegación.
- [ ] Si usa **SSO** (Enterprise): los datos de su proveedor de identidad.

### Anexo C. Contactos y enlaces

| Para… | Dónde |
|---|---|
| Hablar con el equipo comercial, tu alta como partner, cuentas importantes | **sales@cscloudsolutions.com.ar** |
| Soporte técnico de la plataforma | **soporte@cscloudsolutions.com.ar** (o un ticket desde *Soporte*) |
| Privacidad, DPA y estado de la certificación | **privacy@cscloudsolutions.com.ar** |
| La plataforma | https://finops.cscloudsolutions.com.ar |
| Demo interactiva | https://finops.cscloudsolutions.com.ar/demo |
| Centro de Confianza | `/legal/security` · `/legal/privacy` · `/legal/terms` · `/legal/dpa` · `/legal/subprocessors` |
| Estado de la plataforma | `/status` |

---

**Manual del Partner y del Equipo Comercial — FinOps SaaS**
**Versión 1.0 | Español | Octubre 2026**

Los precios y las capacidades de este documento son los vigentes a octubre de 2026. Los porcentajes de comisión son los del programa estándar y se confirman en el acuerdo firmado.
