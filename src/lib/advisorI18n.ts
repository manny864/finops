/**
 * Traductor de textos de Azure Advisor.
 *
 * Azure Advisor REST API recibe `Accept-Language`, pero en la práctica los
 * campos `shortDescription.problem` y `shortDescription.solution` suelen volver
 * en inglés para la mayoría de recomendaciones. Este helper aplica
 * pattern-matching (case-insensitive) sobre los textos en inglés y devuelve la
 * versión traducida al locale activo. Si no hay match, devuelve el texto
 * original tal cual lo entrega Azure.
 *
 * Cobertura priorizada: optimización de costos (categoría Cost), más patrones
 * frecuentes de Security/Reliability/Performance/OperationalExcellence.
 */

export type AdvisorLocale = "es" | "en" | "pt-BR";

type Trio = Record<AdvisorLocale, string>;

type Entry = {
  match: RegExp;
  problem?: Trio;
  solution?: Trio;
};

type GlossaryEntry = {
  match: RegExp;
  replace: Record<Exclude<AdvisorLocale, "en">, string>;
};

function normalize(locale: string | undefined): AdvisorLocale {
  const l = (locale || "es").toLowerCase();
  if (l.startsWith("pt")) return "pt-BR";
  if (l.startsWith("en")) return "en";
  return "es";
}

const ENTRIES: Entry[] = [
  {
    match: /^security$/i,
    problem: {
      es: "Seguridad",
      en: "Security",
      "pt-BR": "Segurança",
    },
  },
  {
    match: /^cost$/i,
    problem: {
      es: "Costo",
      en: "Cost",
      "pt-BR": "Custo",
    },
  },
  {
    match: /^highavailability$/i,
    problem: {
      es: "Alta disponibilidad",
      en: "High availability",
      "pt-BR": "Alta disponibilidade",
    },
  },
  {
    match: /^performance$/i,
    problem: {
      es: "Rendimiento",
      en: "Performance",
      "pt-BR": "Desempenho",
    },
  },
  {
    match: /^operationalexcellence$/i,
    problem: {
      es: "Excelencia operativa",
      en: "Operational excellence",
      "pt-BR": "Excelência operacional",
    },
  },
  {
    match: /delete.*unattached.*managed.*disk/i,
    problem: {
      es: "Eliminar discos administrados no conectados",
      en: "Delete unattached managed disks",
      "pt-BR": "Excluir discos gerenciados não conectados",
    },
    solution: {
      es: "Estos discos administrados no están conectados a ninguna máquina virtual y continúan generando costos de almacenamiento. Elimínalos para ahorrar costos.",
      en: "These managed disks are not attached to any virtual machine and continue to incur storage costs. Delete them to save costs.",
      "pt-BR": "Esses discos gerenciados não estão conectados a nenhuma máquina virtual e continuam gerando custos de armazenamento. Exclua-os para economizar custos.",
    },
  },
  {
    match: /enable.*mfa.*privileged.*account/i,
    problem: {
      es: "Habilitar MFA para cuentas con privilegios",
      en: "Enable MFA for privileged accounts",
      "pt-BR": "Habilitar MFA para contas privilegiadas",
    },
  },
  {
    match: /enable.*mfa.*account/i,
    problem: {
      es: "Habilitar MFA para cuentas",
      en: "Enable MFA for accounts",
      "pt-BR": "Habilitar MFA para contas",
    },
  },
  {
    match: /enable.*microsoft.*defender.*cloud.*subscription/i,
    problem: {
      es: "Habilitar Microsoft Defender for Cloud en las suscripciones",
      en: "Enable Microsoft Defender for Cloud on subscriptions",
      "pt-BR": "Habilitar Microsoft Defender for Cloud nas assinaturas",
    },
  },
  {
    match: /restrict.*network.*access.*storage.*account/i,
    problem: {
      es: "Restringir el acceso de red a cuentas de almacenamiento",
      en: "Restrict network access to storage accounts",
      "pt-BR": "Restringir o acesso de rede a contas de armazenamento",
    },
  },
  {
    match: /apply.*disk.*encryption.*virtual.*machine/i,
    problem: {
      es: "Aplicar cifrado de discos en máquinas virtuales",
      en: "Apply disk encryption on virtual machines",
      "pt-BR": "Aplicar criptografia de disco em máquinas virtuais",
    },
  },
  {
    match: /(encrypt|encryption).*(disk|data).*(virtual.*machine|vm)|virtual.*machine.*(encrypt|encryption)/i,
    problem: {
      es: "Aplicar cifrado en discos o datos de máquinas virtuales",
      en: "Apply encryption to virtual machine disks or data",
      "pt-BR": "Aplicar criptografia em discos ou dados de máquinas virtuais",
    },
  },
  {
    match: /enable.*soft.*delete.*protect.*data/i,
    problem: {
      es: "Habilitar eliminación temporal (soft delete) para proteger tus datos",
      en: "Enable soft delete to protect your data",
      "pt-BR": "Habilitar exclusão reversível (soft delete) para proteger seus dados",
    },
  },
  {
    match: /configure.*availability.*zone.*critical.*vm/i,
    problem: {
      es: "Configurar zonas de disponibilidad para VMs críticas",
      en: "Configure availability zones for critical VMs",
      "pt-BR": "Configurar zonas de disponibilidade para VMs críticas",
    },
  },
  {
    match: /(enable|turn on).*(defender|microsoft defender).*(cloud|subscription)|defender for cloud/i,
    problem: {
      es: "Habilitar Microsoft Defender for Cloud",
      en: "Enable Microsoft Defender for Cloud",
      "pt-BR": "Habilitar Microsoft Defender for Cloud",
    },
  },
  {
    match: /enable.*geo-redundant.*backup/i,
    problem: {
      es: "Habilitar copias de seguridad geo-redundantes",
      en: "Enable geo-redundant backups",
      "pt-BR": "Habilitar backups geo-redundantes",
    },
  },
  {
    match: /upgrade.*premium.*ssd.*improve.*performance/i,
    problem: {
      es: "Actualizar a discos Premium SSD para mejorar el rendimiento",
      en: "Upgrade to Premium SSD disks to improve performance",
      "pt-BR": "Atualizar para discos Premium SSD para melhorar o desempenho",
    },
  },
  {
    match: /increase.*sql.*database.*performance.*tier/i,
    problem: {
      es: "Aumentar el nivel de rendimiento de la base de datos SQL",
      en: "Increase the SQL database performance tier",
      "pt-BR": "Aumentar o nível de desempenho do banco de dados SQL",
    },
  },
  {
    match: /enable.*accelerated.*networking.*supported.*virtual.*machine/i,
    problem: {
      es: "Habilitar aceleración de red en máquinas virtuales compatibles",
      en: "Enable accelerated networking on supported virtual machines",
      "pt-BR": "Habilitar aceleração de rede em máquinas virtuais compatíveis",
    },
  },
  {
    match: /assign.*tag.*resource.*improve.*governance/i,
    problem: {
      es: "Asignar etiquetas a los recursos para mejorar la gobernanza",
      en: "Assign tags to resources to improve governance",
      "pt-BR": "Atribuir tags aos recursos para melhorar a governança",
    },
  },
  {
    match: /configure.*azure.*service.*health.*alert/i,
    problem: {
      es: "Configurar alertas de estado de servicio de Azure",
      en: "Configure Azure Service Health alerts",
      "pt-BR": "Configurar alertas de integridade de serviço do Azure",
    },
  },

  // ---------- COSTO ----------
  {
    match: /right.?size.*(shut\s?down|shutdown).*underutilized.*virtual.?machine/i,
    problem: {
      es: "Redimensionar o apagar máquinas virtuales subutilizadas",
      en: "Right-size or shutdown underutilized virtual machines",
      "pt-BR": "Redimensionar ou desligar máquinas virtuais subutilizadas",
    },
    solution: {
      es: "Analizamos el uso de tus máquinas virtuales y detectamos instancias con baja utilización. Redimensiónalas a un SKU menor o apágalas para reducir costos sin impactar el rendimiento.",
      en: "We analyzed your virtual machine usage and identified low-utilization instances. Resize them to a smaller SKU or shut them down to reduce costs without impacting performance.",
      "pt-BR": "Analisamos o uso de suas máquinas virtuais e identificamos instâncias com baixa utilização. Redimensione-as para um SKU menor ou desligue-as para reduzir custos sem impactar o desempenho.",
    },
  },
  {
    match: /optimize.*virtual.?machine.*(spend|cost).*(resizing|shutting)/i,
    problem: {
      es: "Optimizar el gasto en máquinas virtuales redimensionando o apagando instancias subutilizadas",
      en: "Optimize virtual machine spend by resizing or shutting down underutilized instances",
      "pt-BR": "Otimize o gasto em máquinas virtuais redimensionando ou desligando instâncias subutilizadas",
    },
  },
  {
    match: /buy.*reserved.*(virtual.?machine|vm).*instance/i,
    problem: {
      es: "Comprar instancias reservadas de máquinas virtuales para ahorrar frente al pago por uso",
      en: "Buy reserved virtual machine instances to save money over pay-as-you-go costs",
      "pt-BR": "Comprar instâncias reservadas de máquinas virtuais para economizar em relação ao pagamento por uso",
    },
    solution: {
      es: "Analizamos tu uso de máquinas virtuales en los últimos 30 días y calculamos compras de instancias reservadas que maximizarían tus ahorros.",
      en: "We analyzed your virtual machine usage over the last 30 days and calculated reserved instance purchases that would maximize your savings.",
      "pt-BR": "Analisamos seu uso de máquinas virtuais nos últimos 30 dias e calculamos compras de instâncias reservadas que maximizariam suas economias.",
    },
  },
  {
    match: /buy.*reserved.*capacity/i,
    problem: {
      es: "Comprar capacidad reservada para ahorrar frente a los costos de pago por uso",
      en: "Buy reserved capacity to save over your pay-as-you-go costs",
      "pt-BR": "Comprar capacidade reservada para economizar em relação aos custos de pagamento por uso",
    },
    solution: {
      es: "Analizamos tu consumo en los últimos 30 días y calculamos compras de reservas que maximizarían el ahorro.",
      en: "We analyzed your usage in the last 30 days and calculated reservation purchases that would maximize your savings.",
      "pt-BR": "Analisamos seu consumo nos últimos 30 dias e calculamos compras de reservas que maximizariam a economia.",
    },
  },
  {
    match: /(consider|use).*savings.?plan/i,
    problem: {
      es: "Considerar un Savings Plan para ahorrar sobre los costos de pago por uso",
      en: "Consider a Savings Plan to save over your pay-as-you-go costs",
      "pt-BR": "Considerar um Savings Plan para economizar sobre os custos de pagamento por uso",
    },
  },
  {
    match: /(repurpose|delete).*idle.*virtual.?network.?gateway/i,
    problem: {
      es: "Reutilizar o eliminar gateways de red virtual inactivos",
      en: "Repurpose or delete idle virtual network gateways",
      "pt-BR": "Reaproveitar ou excluir gateways de rede virtual ociosos",
    },
    solution: {
      es: "Analizamos la configuración de tu gateway de red virtual y detectamos un estado inactivo. Reutilízalo o elimínalo para evitar cargos innecesarios.",
      en: "We analyzed your virtual network gateway configuration and detected an idle state. Repurpose or delete it to avoid unnecessary charges.",
      "pt-BR": "Analisamos a configuração do seu gateway de rede virtual e detectamos um estado ocioso. Reaproveite-o ou exclua-o para evitar cobranças desnecessárias.",
    },
  },
  {
    match: /delete.*express.?route.*(not.?provisioned|provider)/i,
    problem: {
      es: "Eliminar circuitos ExpressRoute en estado 'Not Provisioned'",
      en: "Delete ExpressRoute circuits in the provider status of Not Provisioned",
      "pt-BR": "Excluir circuitos ExpressRoute no status do provedor 'Not Provisioned'",
    },
    solution: {
      es: "Elimina los circuitos ExpressRoute que ya no estén en uso para dejar de pagar por ellos.",
      en: "Delete ExpressRoute circuits that are no longer in use to stop paying for them.",
      "pt-BR": "Exclua os circuitos ExpressRoute que não estão mais em uso para parar de pagar por eles.",
    },
  },
  {
    match: /(delete|remove).*(unattached|unused).*(managed.?)?disk/i,
    problem: {
      es: "Eliminar discos administrados no adjuntos",
      en: "Delete unattached managed disks",
      "pt-BR": "Excluir discos gerenciados não anexados",
    },
    solution: {
      es: "Detectamos discos que no están asociados a ninguna máquina virtual. Elimínalos para dejar de incurrir en costos de almacenamiento.",
      en: "We detected disks that are not attached to any virtual machine. Delete them to stop incurring storage costs.",
      "pt-BR": "Detectamos discos que não estão anexados a nenhuma máquina virtual. Exclua-os para deixar de incorrer em custos de armazenamento.",
    },
  },
  {
    match: /(delete|remove).*unassociated.*public.?ip/i,
    problem: {
      es: "Eliminar direcciones IP públicas no asociadas",
      en: "Delete unassociated public IP addresses",
      "pt-BR": "Excluir endereços IP públicos não associados",
    },
    solution: {
      es: "Elimina las IPs públicas que no están asociadas a ningún recurso para evitar cargos mensuales.",
      en: "Delete public IPs that are not associated with any resource to avoid monthly charges.",
      "pt-BR": "Exclua os IPs públicos que não estão associados a nenhum recurso para evitar cobranças mensais.",
    },
  },
  {
    match: /right.?size.*underutilized.*sql.?database/i,
    problem: {
      es: "Redimensionar bases de datos SQL subutilizadas",
      en: "Right-size underutilized SQL Databases",
      "pt-BR": "Redimensionar bancos de dados SQL subutilizados",
    },
  },
  {
    match: /right.?size.*underutilized.*(mariadb|mysql|postgresql|postgres)/i,
    problem: {
      es: "Redimensionar servidores de base de datos subutilizados",
      en: "Right-size underutilized database servers",
      "pt-BR": "Redimensionar servidores de banco de dados subutilizados",
    },
  },
  {
    match: /(use|enable).*lifecycle.*(management)?.*(blob|storage)/i,
    problem: {
      es: "Usar gestión del ciclo de vida para optimizar costos de Blob Storage",
      en: "Use lifecycle management to optimize Blob storage costs",
      "pt-BR": "Use o gerenciamento de ciclo de vida para otimizar custos do Blob Storage",
    },
  },
  {
    match: /standard.*storage.*managed.?disks.*snapshot/i,
    problem: {
      es: "Usar Standard Storage para almacenar snapshots de Managed Disks",
      en: "Use Standard Storage to store Managed Disks snapshots",
      "pt-BR": "Use Standard Storage para armazenar snapshots de Managed Disks",
    },
  },
  {
    match: /(delete|remove).*idle.*virtual.?machine.?scale.?set/i,
    problem: {
      es: "Reutilizar o eliminar instancias inactivas de Virtual Machine Scale Sets",
      en: "Repurpose or delete idle virtual machine scale set instances",
      "pt-BR": "Reaproveitar ou excluir instâncias ociosas de Virtual Machine Scale Sets",
    },
  },
  {
    match: /app.?service.*(stamp.?fee)?.*reserved.?instance/i,
    problem: {
      es: "Considerar instancias reservadas de App Service para ahorrar sobre el costo bajo demanda",
      en: "Consider App Service reserved instance to save over your on-demand costs",
      "pt-BR": "Considerar instâncias reservadas de App Service para economizar sobre os custos sob demanda",
    },
  },
  {
    match: /(delete|cleanup).*orphaned.*(snapshot|backup)/i,
    problem: {
      es: "Eliminar snapshots o backups huérfanos",
      en: "Delete orphaned snapshots or backups",
      "pt-BR": "Excluir snapshots ou backups órfãos",
    },
  },

  // ---------- SEGURIDAD ----------
  {
    match: /enable.*multi.?factor.?authentication|enable.*mfa/i,
    problem: {
      es: "Habilitar autenticación multifactor (MFA) para cuentas privilegiadas",
      en: "Enable multi-factor authentication (MFA) for privileged accounts",
      "pt-BR": "Habilitar autenticação multifator (MFA) para contas privilegiadas",
    },
  },
  {
    match: /enable.*encryption.*(storage|disk|data.?at.?rest)/i,
    problem: {
      es: "Habilitar cifrado de datos en reposo",
      en: "Enable encryption for data at rest",
      "pt-BR": "Habilitar criptografia de dados em repouso",
    },
  },
  {
    match: /restrict.*(public|internet).*access/i,
    problem: {
      es: "Restringir el acceso público a recursos",
      en: "Restrict public access to resources",
      "pt-BR": "Restringir o acesso público aos recursos",
    },
  },

  // ---------- CONFIABILIDAD / HA ----------
  {
    match: /enable.*(soft.?delete|backup).*(blob|storage|vm|disk)/i,
    problem: {
      es: "Habilitar borrado lógico (soft delete) o backup para proteger tus datos",
      en: "Enable soft delete or backup to protect your data",
      "pt-BR": "Habilite a exclusão reversível (soft delete) ou backup para proteger seus dados",
    },
  },
  {
    match: /(configure|use).*availability.?(zone|set)/i,
    problem: {
      es: "Configurar Zonas de Disponibilidad o Availability Sets para mayor resiliencia",
      en: "Configure Availability Zones or Availability Sets for higher resilience",
      "pt-BR": "Configurar Zonas de Disponibilidade ou Availability Sets para maior resiliência",
    },
  },

  // ---------- RENDIMIENTO ----------
  {
    match: /upgrade.*(premium|ssd).*disk/i,
    problem: {
      es: "Actualizar a discos Premium SSD para mejorar el rendimiento",
      en: "Upgrade to Premium SSD disks to improve performance",
      "pt-BR": "Atualize para discos Premium SSD para melhorar o desempenho",
    },
  },
];

// Fallback de traducción para recomendaciones no cubiertas por ENTRIES.
// Se aplica por frases completas (más seguras que palabra suelta) y mantiene
// el texto original si no hay reemplazos.
const FALLBACK_GLOSSARY: GlossaryEntry[] = [
  { match: /right-?size/gi, replace: { es: "redimensionar", "pt-BR": "redimensionar" } },
  { match: /underutilized/gi, replace: { es: "subutilizadas", "pt-BR": "subutilizadas" } },
  { match: /virtual machines?/gi, replace: { es: "máquinas virtuales", "pt-BR": "máquinas virtuais" } },
  { match: /sql databases?/gi, replace: { es: "bases de datos SQL", "pt-BR": "bancos de dados SQL" } },
  { match: /reserved instances?/gi, replace: { es: "instancias reservadas", "pt-BR": "instâncias reservadas" } },
  { match: /savings plan/gi, replace: { es: "plan de ahorro", "pt-BR": "plano de economia" } },
  { match: /pay-?as-?you-?go/gi, replace: { es: "pago por uso", "pt-BR": "pagamento por uso" } },
  { match: /costs?/gi, replace: { es: "costos", "pt-BR": "custos" } },
  { match: /save money/gi, replace: { es: "ahorrar dinero", "pt-BR": "economizar dinheiro" } },
  { match: /delete/gi, replace: { es: "eliminar", "pt-BR": "excluir" } },
  { match: /remove/gi, replace: { es: "eliminar", "pt-BR": "remover" } },
  { match: /unattached/gi, replace: { es: "no adjuntos", "pt-BR": "não anexados" } },
  { match: /unassociated/gi, replace: { es: "no asociadas", "pt-BR": "não associados" } },
  { match: /public ip addresses?/gi, replace: { es: "direcciones IP públicas", "pt-BR": "endereços IP públicos" } },
  { match: /storage accounts?/gi, replace: { es: "cuentas de almacenamiento", "pt-BR": "contas de armazenamento" } },
  { match: /enable/gi, replace: { es: "habilitar", "pt-BR": "habilitar" } },
  { match: /configure/gi, replace: { es: "configurar", "pt-BR": "configurar" } },
];

function applyFallbackGlossary(text: string, locale: AdvisorLocale): string {
  if (locale === "en") return text;
  let out = text;
  for (const entry of FALLBACK_GLOSSARY) {
    out = out.replace(entry.match, entry.replace[locale]);
  }
  return out;
}

/**
 * Traduce un texto de Azure Advisor (problem o solution) al locale activo.
 * Si no hay coincidencia, devuelve el texto original.
 */
export function translateAdvisorText(
  text: string | undefined | null,
  locale: string,
  kind: "problem" | "solution" = "problem"
): string {
  if (!text) return "";
  const target = normalize(locale);
  for (const entry of ENTRIES) {
    if (!entry.match.test(text)) continue;
    // Preferimos el trío del `kind` pedido, pero si no existe (muchas entradas
    // solo definen `problem`) caemos al otro trío: siempre es mejor un texto
    // traducido del problema que la `solution` original en inglés.
    const primary = kind === "problem" ? entry.problem : entry.solution;
    const secondary = kind === "problem" ? entry.solution : entry.problem;
    if (primary && primary[target]) return primary[target];
    if (secondary && secondary[target]) return secondary[target];
  }
  return applyFallbackGlossary(text, target);
}

/** Nombres localizados para tipos de recursos zombie/audit. */
const ZOMBIE_TYPE_NAMES: Record<string, Trio> = {
  "Disk":             { es: "Disco Desconectado",          en: "Unattached Disk",              "pt-BR": "Disco Desconectado"            },
  "Public IP":        { es: "IP Pública sin Uso",           en: "Unused Public IP",             "pt-BR": "IP Pública sem Uso"            },
  "Snapshot":         { es: "Snapshot Obsoleto",            en: "Stale Snapshot",               "pt-BR": "Snapshot Obsoleto"             },
  "App Service Plan": { es: "App Service Plan Vacío",       en: "Empty App Service Plan",       "pt-BR": "App Service Plan Vazio"        },
  "SQL Elastic Pool": { es: "SQL Elastic Pool Vacío",       en: "Empty SQL Elastic Pool",       "pt-BR": "SQL Elastic Pool Vazio"        },
  "Load Balancer":    { es: "Load Balancer Inactivo",       en: "Idle Load Balancer",           "pt-BR": "Load Balancer Inativo"         },
  "Front Door WAF":   { es: "Front Door WAF sin Recursos",  en: "Front Door WAF No Resources",  "pt-BR": "Front Door WAF sem Recursos"   },
  "Traffic Manager":  { es: "Traffic Manager sin Endpoints","en": "Traffic Manager No Endpoints","pt-BR": "Traffic Manager sem Endpoints" },
  "App Gateway":      { es: "Application Gateway Inactivo", en: "Idle Application Gateway",     "pt-BR": "Application Gateway Inativo"   },
  "NAT Gateway":      { es: "NAT Gateway sin Uso",          en: "Idle NAT Gateway",             "pt-BR": "NAT Gateway sem Uso"           },
  "Private Endpoint": { es: "Private Endpoint Huérfano",    en: "Orphaned Private Endpoint",    "pt-BR": "Private Endpoint Órfão"        },
  "VNet Gateway":     { es: "VNet Gateway sin Conexiones",  en: "VNet Gateway No Connections",  "pt-BR": "VNet Gateway sem Conexões"     },
  "DDoS Plan":        { es: "Plan DDoS sin VNets",          en: "DDoS Plan No VNets",           "pt-BR": "Plano DDoS sem VNets"          },
  "Private DNS":      { es: "Zona DNS Privada sin Vínculos","en": "Private DNS No Links",        "pt-BR": "DNS Privado sem Vínculos"      },
  "Flexible Server":  { es: "Servidor Flexible Detenido",   en: "Stopped Flexible Server",      "pt-BR": "Servidor Flexível Parado"      },
  "Cosmos DB":        { es: "Cosmos DB Vacío",              en: "Empty Cosmos DB",              "pt-BR": "Cosmos DB Vazio"               },
  "Event Hub":        { es: "Event Hub Namespace Vacío",    en: "Empty Event Hub Namespace",    "pt-BR": "Event Hub Namespace Vazio"     },
  "Service Bus":      { es: "Service Bus Vacío",            en: "Empty Service Bus",            "pt-BR": "Service Bus Vazio"             },
  "API Management":   { es: "API Management Vacío",         en: "Empty API Management",         "pt-BR": "API Management Vazio"          },
  "ExpressRoute":     { es: "ExpressRoute sin Circuito",    en: "ExpressRoute No Circuit",      "pt-BR": "ExpressRoute sem Circuito"     },
  "WAF Policy":       { es: "WAF Policy sin Recursos",      en: "WAF Policy No Resources",      "pt-BR": "WAF Policy sem Recursos"       },
  "VM (Stopped)":     { es: "Máquina Virtual Detenida",     en: "Stopped Virtual Machine",      "pt-BR": "Máquina Virtual Parada"        },
  "App Service Env":  { es: "App Service Env Vacío",        en: "Empty App Service Environment","pt-BR": "App Service Env Vazio"         },
  "TTL Expired":      { es: "Recurso TTL Expirado",         en: "TTL Expired Resource",         "pt-BR": "Recurso TTL Expirado"          },
};

/**
 * Traduce el nombre de un tipo de recurso zombie/audit al locale activo.
 * Si no hay traducción disponible, devuelve el nombre original.
 */
export function translateZombieType(name: string, locale: string): string {
  const target = normalize(locale);
  return ZOMBIE_TYPE_NAMES[name]?.[target] ?? name;
}
