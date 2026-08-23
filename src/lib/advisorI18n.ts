/**
 * Traductor de textos y columnas de Azure Advisor.
 *
 * Azure Advisor REST API recibe `Accept-Language`, pero en la práctica los
 * campos `shortDescription.problem` y `shortDescription.solution` suelen volver
 * en inglés para la mayoría de recomendaciones. Este helper aplica
 * pattern-matching y normalización sobre los textos y devuelve la versión
 * traducida al locale activo (es, en, pt-BR).
 *
 * Cobertura completa: Costo, Seguridad, Confiabilidad, Rendimiento y Excelencia Operativa.
 */

export type AdvisorLocale = "es" | "en" | "pt-BR";

type Trio = Record<AdvisorLocale, string>;

type Entry = {
  match: RegExp;
  problem?: Trio;
  solution?: Trio;
};

export function normalizeAdvisorLocale(locale: string | undefined): AdvisorLocale {
  const l = (locale || "es").toLowerCase();
  if (l.startsWith("pt")) return "pt-BR";
  if (l.startsWith("en")) return "en";
  return "es";
}

const ENTRIES: Entry[] = [
  // ==========================================
  // CATEGORÍAS BASE
  // ==========================================
  {
    match: /^security$/i,
    problem: { es: "Seguridad", en: "Security", "pt-BR": "Segurança" },
  },
  {
    match: /^cost$/i,
    problem: { es: "Costo", en: "Cost", "pt-BR": "Custo" },
  },
  {
    match: /^(high\s?availability|reliability)$/i,
    problem: { es: "Confiabilidad", en: "Reliability", "pt-BR": "Confiabilidade" },
  },
  {
    match: /^performance$/i,
    problem: { es: "Rendimiento", en: "Performance", "pt-BR": "Desempenho" },
  },
  {
    match: /^operational\s?excellence$/i,
    problem: { es: "Excelencia operativa", en: "Operational excellence", "pt-BR": "Excelência operacional" },
  },

  // ==========================================
  // 1. COSTO (COST OPTIMIZATION)
  // ==========================================
  {
    match: /(consider|buy|purchase).*m[áa]quinas\s+virtuales.*instancias\s+reservadas/i,
    problem: {
      es: "Compra de Instancias Reservadas en Máquinas Virtuales",
      en: "Buy virtual machine reserved instances to save over pay-as-you-go costs",
      "pt-BR": "Compra de Instâncias Reservadas em Máquinas Virtuais",
    },
    solution: {
      es: "Adquiere instancias reservadas de 1 o 3 años para tus máquinas virtuales y maximiza tus ahorros de cómputo.",
      en: "Purchase 1 or 3-year reserved instances for virtual machines to maximize compute savings.",
      "pt-BR": "Adquira instâncias reservadas de 1 ou 3 anos para suas máquinas virtuais e maximize as economias.",
    },
  },
  {
    match: /(consider|buy|purchase).*cache\s+for\s+redis.*(instancias\s+reservadas|reserved)/i,
    problem: {
      es: "Compra de Capacidad Reservada para Azure Cache for Redis",
      en: "Buy reserved capacity for Azure Cache for Redis",
      "pt-BR": "Compra de Capacidade Reservada para Azure Cache for Redis",
    },
    solution: {
      es: "Adquiere capacidad reservada en Azure Cache for Redis para reducir costos de memoria frente al pago por uso.",
      en: "Purchase reserved capacity on Azure Cache for Redis to lower memory costs compared to pay-as-you-go.",
      "pt-BR": "Adquira capacidade reservada no Azure Cache for Redis para reduzir custos.",
    },
  },
  {
    match: /(use|consider).*kubernetes.*cost(os)?.*analysis/i,
    problem: {
      es: "Análisis y Optimización de Costos en Azure Kubernetes Service (AKS)",
      en: "Cost Analysis and Optimization in Azure Kubernetes Service (AKS)",
      "pt-BR": "Análise e Otimização de Custos no Azure Kubernetes Service (AKS)",
    },
    solution: {
      es: "Habilita la vista de análisis de costos a nivel de espacio de nombres y pod para optimizar las cargas de trabajo en AKS.",
      en: "Enable namespace and pod-level cost analysis in AKS to optimize containerized workloads.",
      "pt-BR": "Habilite a análise de custos no AKS para otimizar cargas de trabalho em contêineres.",
    },
  },
  {
    match: /(cuentas\s+de\s+almacenamiento|storage\s+accounts?).*private\s+link/i,
    problem: {
      es: "Las cuentas de almacenamiento deben utilizar conexiones Private Link",
      en: "Storage accounts should use a private link connection",
      "pt-BR": "As contas de armazenamento devem utilizar conexões Private Link",
    },
    solution: {
      es: "Configura Private Endpoints en tus cuentas de almacenamiento para restringir el tráfico a la red virtual privada.",
      en: "Configure Private Endpoints on storage accounts to restrict traffic to the private virtual network.",
      "pt-BR": "Configure Private Endpoints em suas contas de armazenamento para restringir o tráfego.",
    },
  },
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
      "pt-BR": "Otimizar o gasto em máquinas virtuais redimensionando ou desligando instâncias subutilizadas",
    },
    solution: {
      es: "Ajusta el tamaño o apaga las instancias que presentan bajo consumo de CPU y memoria.",
      en: "Resize or shut down instances showing low CPU and memory consumption.",
      "pt-BR": "Ajuste o tamanho ou desligue as instâncias que apresentam baixo consumo de CPU e memória.",
    },
  },
  {
    match: /(buy|purchase).*(reserved.*(virtual.?machine|vm)|(virtual.?machine|vm).*reserved).*instance/i,
    problem: {
      es: "Comprar instancias reservadas de máquinas virtuales para ahorrar sobre el pago por uso",
      en: "Buy virtual machine reserved instances to save over pay-as-you-go costs",
      "pt-BR": "Comprar instâncias reservadas de máquinas virtuais para economizar sobre o pagamento por uso",
    },
    solution: {
      es: "Analizamos tu uso de máquinas virtuales en los últimos 30 días y calculamos compras de instancias reservadas que maximizarían tus ahorros.",
      en: "We analyzed your virtual machine usage over the last 30 days and calculated reserved instance purchases that would maximize your savings.",
      "pt-BR": "Analisamos seu uso de máquinas virtuais nos últimos 30 dias e calculamos compras de instâncias reservadas que maximizariam suas economias.",
    },
  },
  {
    match: /(buy|purchase).*reserved.*capacity/i,
    problem: {
      es: "Comprar capacidad reservada para ahorrar frente a los costos de pago por uso",
      en: "Buy reserved capacity to save over pay-as-you-go costs",
      "pt-BR": "Comprar capacidade reservada para economizar em relação aos custos de pagamento por uso",
    },
    solution: {
      es: "Analizamos tu consumo en los últimos 30 días y calculamos compras de reservas que maximizarían el ahorro.",
      en: "We analyzed your usage in the last 30 days and calculated reservation purchases that would maximize your savings.",
      "pt-BR": "Analisamos seu consumo nos últimos 30 dias e calculamos compras de reservas que maximizariam a economia.",
    },
  },
  {
    match: /(consider|use|buy).*savings.?plan/i,
    problem: {
      es: "Considerar un Plan de Ahorro (Savings Plan) para optimizar costos de cómputo",
      en: "Consider Azure Savings Plan for compute to save over pay-as-you-go costs",
      "pt-BR": "Considerar um Plano de Economia (Savings Plan) para otimizar custos de computação",
    },
    solution: {
      es: "Los planes de ahorro de Azure ofrecen tarifas con descuento en recursos de cómputo a cambio de un compromiso de gasto por hora durante 1 o 3 años.",
      en: "Azure savings plans offer discounted rates on compute resources in exchange for an hourly spend commitment over 1 or 3 years.",
      "pt-BR": "Os planos de economia do Azure oferecem tarifas com desconto em recursos de computação em troca de um compromisso de gasto por hora durante 1 ou 3 anos.",
    },
  },
  {
    match: /(delete|remove).*(unattached|unused).*(managed.?)?disk/i,
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
    match: /(delete|remove).*unassociated.*public.?ip/i,
    problem: {
      es: "Eliminar direcciones IP públicas no asociadas",
      en: "Delete unassociated public IP addresses",
      "pt-BR": "Excluir endereços IP públicos não associados",
    },
    solution: {
      es: "Elimina las IPs públicas que no están asociadas a ningún recurso o interfaz de red para evitar cargos mensuales.",
      en: "Delete public IPs that are not associated with any resource or network interface to avoid monthly charges.",
      "pt-BR": "Exclua os IPs públicos que não estão associados a nenhum recurso ou interface de rede para evitar cobranças mensais.",
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
    match: /right.?size.*underutilized.*sql.?(database|elastic.?pool)/i,
    problem: {
      es: "Redimensionar bases de datos SQL o grupos elásticos subutilizados",
      en: "Right-size underutilized SQL Databases or elastic pools",
      "pt-BR": "Redimensionar bancos de dados SQL ou pools elásticos subutilizados",
    },
    solution: {
      es: "Ajusta la capacidad de DTU o vCores de tu base de datos SQL para que coincida con la carga real de trabajo.",
      en: "Adjust the DTU or vCore capacity of your SQL database to match actual workload demand.",
      "pt-BR": "Ajuste a capacidade de DTU ou vCores do seu banco de dados SQL para corresponder à demanda real da carga de trabalho.",
    },
  },
  {
    match: /right.?size.*underutilized.*(mariadb|mysql|postgresql|postgres)/i,
    problem: {
      es: "Redimensionar servidores de base de datos de código abierto subutilizados",
      en: "Right-size underutilized open-source database servers",
      "pt-BR": "Redimensionar servidores de banco de dados open source subutilizados",
    },
    solution: {
      es: "Reduce el nivel de cómputo del servidor de base de datos para optimizar los costos.",
      en: "Scale down the compute tier of the database server to optimize costs.",
      "pt-BR": "Reduza o nível de computação do servidor de banco de dados para otimizar custos.",
    },
  },
  {
    match: /(use|enable).*lifecycle.*(management)?.*(blob|storage)/i,
    problem: {
      es: "Usar directivas de ciclo de vida para optimizar costos de Blob Storage",
      en: "Use lifecycle management policies to optimize Blob storage costs",
      "pt-BR": "Usar políticas de ciclo de vida para otimizar custos do Blob Storage",
    },
    solution: {
      es: "Mueve automáticamente los blobs a niveles más fríos (Cool o Archive) según su antigüedad de acceso.",
      en: "Automatically transition blobs to cooler access tiers (Cool or Archive) based on access age.",
      "pt-BR": "Mova automaticamente os blobs para camadas mais frias (Cool ou Archive) com base na idade de acesso.",
    },
  },
  {
    match: /standard.*storage.*managed.?disks.*snapshot/i,
    problem: {
      es: "Usar Standard Storage para almacenar instantáneas (snapshots) de Managed Disks",
      en: "Use Standard Storage to store Managed Disks snapshots",
      "pt-BR": "Usar Standard Storage para armazenar snapshots de Managed Disks",
    },
    solution: {
      es: "Almacenar snapshots en Standard HDD reduce el costo de almacenamiento manteniendo la capacidad de restauración.",
      en: "Storing snapshots on Standard HDD reduces storage costs while preserving restoration capability.",
      "pt-BR": "Armazenar snapshots em Standard HDD reduz o custo de armazenamento mantendo a capacidade de restauração.",
    },
  },
  {
    match: /(delete|remove).*idle.*virtual.?machine.?scale.?set/i,
    problem: {
      es: "Reutilizar o eliminar conjuntos de escalado de máquinas virtuales (VMSS) inactivos",
      en: "Repurpose or delete idle Virtual Machine Scale Sets (VMSS)",
      "pt-BR": "Reaproveitar ou excluir conjuntos de dimensionamento de máquinas virtuais (VMSS) ociosos",
    },
    solution: {
      es: "Elimina los conjuntos de escalado que tengan 0 instancias activas o que no procesen tráfico.",
      en: "Delete scale sets that have 0 active instances or are not processing traffic.",
      "pt-BR": "Exclua os conjuntos de dimensionamento que possuem 0 instâncias ativas ou não processam tráfego.",
    },
  },
  {
    match: /app.?service.*(stamp.?fee)?.*reserved.?instance/i,
    problem: {
      es: "Considerar instancias reservadas de App Service para ahorrar frente al pago por uso",
      en: "Consider App Service reserved instances to save over pay-as-you-go costs",
      "pt-BR": "Considerar instâncias reservadas do App Service para economizar sobre o pagamento por uso",
    },
    solution: {
      es: "Aplica reservas en tus planes de App Service dedicados para obtener descuentos significativos.",
      en: "Apply reservations on your dedicated App Service plans to secure significant discounts.",
      "pt-BR": "Aplique reservas em seus planos dedicados do App Service para obter descontos significativos.",
    },
  },
  {
    match: /(delete|cleanup).*orphaned.*(snapshot|backup)/i,
    problem: {
      es: "Eliminar instantáneas (snapshots) o copias de seguridad huérfanas",
      en: "Delete orphaned snapshots or backups",
      "pt-BR": "Excluir snapshots ou backups órfãos",
    },
    solution: {
      es: "Elimina las instantáneas de discos o backups cuyos recursos originales ya fueron destruidos.",
      en: "Delete disk snapshots or backups whose source resources have already been deleted.",
      "pt-BR": "Exclua os snapshots de disco ou backups cujos recursos de origem já foram excluídos.",
    },
  },
  {
    match: /upgrade.*(newer|latest).*generation.*vm/i,
    problem: {
      es: "Actualizar a la serie de máquinas virtuales de última generación",
      en: "Upgrade to newer generation Virtual Machine series",
      "pt-BR": "Atualizar para a série de máquinas virtuais de última geração",
    },
    solution: {
      es: "Las series más recientes de VMs (ej. v5) ofrecen mayor rendimiento por core a un menor costo.",
      en: "Newer VM series (e.g. v5) offer higher performance per core at a lower cost.",
      "pt-BR": "As séries mais recentes de VMs (ex: v5) oferecem maior desempenho por núcleo a um custo menor.",
    },
  },
  {
    match: /(delete|remove).*empty.*app.?service.?plan/i,
    problem: {
      es: "Eliminar planes de App Service vacíos",
      en: "Delete empty App Service Plans",
      "pt-BR": "Excluir planos do App Service vazios",
    },
    solution: {
      es: "Elimina los planes de App Service que no contienen ninguna aplicación web activa.",
      en: "Delete App Service plans that do not host any active web applications.",
      "pt-BR": "Exclua os planos do App Service que não hospedam nenhum aplicativo web ativo.",
    },
  },

  // ==========================================
  // 2. SEGURIDAD (SECURITY)
  // ==========================================
  {
    match: /enable.*mfa.*privileged.*account|enable.*multi.?factor.*privileged/i,
    problem: {
      es: "Habilitar MFA para cuentas con privilegios de administrador",
      en: "Enable MFA for privileged accounts",
      "pt-BR": "Habilitar MFA para contas privilegiadas",
    },
    solution: {
      es: "Configura la autenticación multifactor mediante Acceso Condicional para todas las cuentas con roles administrativos.",
      en: "Configure multi-factor authentication via Conditional Access for all accounts with administrative roles.",
      "pt-BR": "Configure a autenticação multifator por meio do Acesso Condicional para todas as contas com funções administrativas.",
    },
  },
  {
    match: /enable.*(mfa|multi.?factor).*account|multi.?factor.*authentication.*write.*permission/i,
    problem: {
      es: "Habilitar autenticación multifactor (MFA) para cuentas con permisos de escritura",
      en: "Enable multi-factor authentication (MFA) for accounts with write permissions",
      "pt-BR": "Habilitar autenticação multifator (MFA) para contas com permissões de gravação",
    },
    solution: {
      es: "Protege las cuentas con permisos de modificación en las suscripciones exigiendo MFA.",
      en: "Protect accounts with write permissions on subscriptions by requiring MFA.",
      "pt-BR": "Proteja as contas com permissões de gravação nas assinaturas exigindo MFA.",
    },
  },
  {
    match: /(enable|turn on).*(defender|microsoft defender).*(cloud|subscription|server|storage|sql|container)/i,
    problem: {
      es: "Habilitar Microsoft Defender for Cloud en las suscripciones",
      en: "Enable Microsoft Defender for Cloud on subscriptions",
      "pt-BR": "Habilitar Microsoft Defender for Cloud nas assinaturas",
    },
    solution: {
      es: "Activa los planes de Microsoft Defender for Cloud para proteger tus servidores, bases de datos y almacenamiento contra amenazas avanzadas.",
      en: "Turn on Microsoft Defender for Cloud plans to protect servers, databases, and storage against advanced threats.",
      "pt-BR": "Ative os planos do Microsoft Defender for Cloud para proteger servidores, bancos de dados e armazenamento contra ameaças avançadas.",
    },
  },
  {
    match: /restrict.*network.*access.*storage.*account|storage.*account.*restrict.*network/i,
    problem: {
      es: "Restringir el acceso de red público a cuentas de almacenamiento",
      en: "Restrict public network access to storage accounts",
      "pt-BR": "Restringir o acesso de rede público a contas de armazenamento",
    },
    solution: {
      es: "Configura reglas de firewall de red, endpoints de servicio o Private Endpoints para evitar el acceso público irrestricto.",
      en: "Configure network firewall rules, service endpoints, or Private Endpoints to prevent unrestricted public access.",
      "pt-BR": "Configure regras de firewall de rede, endpoints de serviço ou Private Endpoints para evitar o acesso público irrestrito.",
    },
  },
  {
    match: /(apply|enable).*disk.*encryption.*virtual.*machine|virtual.*machine.*(encrypt|encryption)/i,
    problem: {
      es: "Aplicar cifrado de discos en máquinas virtuales",
      en: "Apply disk encryption on virtual machines",
      "pt-BR": "Aplicar criptografia de disco em máquinas virtuais",
    },
    solution: {
      es: "Habilita Azure Disk Encryption con claves gestionadas en Azure Key Vault para proteger los datos en reposo.",
      en: "Enable Azure Disk Encryption with managed keys in Azure Key Vault to protect data at rest.",
      "pt-BR": "Habilite o Azure Disk Encryption com chaves gerenciadas no Azure Key Vault para proteger dados em repouso.",
    },
  },
  {
    match: /key.?vault.*(soft.?delete|purge.*protection)/i,
    problem: {
      es: "Habilitar eliminación temporal (soft delete) y protección contra purga en Key Vault",
      en: "Enable soft delete and purge protection on Key Vault",
      "pt-BR": "Habilitar exclusão reversível (soft delete) e proteção contra limpeza no Key Vault",
    },
    solution: {
      es: "Evita la pérdida accidental o maliciosa de secretos, claves y certificados protegiendo el Key Vault.",
      en: "Prevent accidental or malicious loss of secrets, keys, and certificates by protecting the Key Vault.",
      "pt-BR": "Evite a perda acidental ou maliciosa de segredos, chaves e certificados protegendo o Key Vault.",
    },
  },
  {
    match: /management.*port.*(close|closed).*virtual.*machine|close.*(rdp|ssh).*port/i,
    problem: {
      es: "Cerrar los puertos de administración (RDP/SSH) expuestos a Internet",
      en: "Management ports should be closed on virtual machines",
      "pt-BR": "Portas de gerenciamento devem ser fechadas em máquinas virtuais",
    },
    solution: {
      es: "Restringe el acceso directo por RDP (3389) y SSH (22) desde Internet utilizando Azure Bastion o VPN.",
      en: "Restrict direct RDP (3389) and SSH (22) access from the internet using Azure Bastion or VPN.",
      "pt-BR": "Restrinja o acesso direto por RDP (3389) e SSH (22) a partir da internet utilizando o Azure Bastion ou VPN.",
    },
  },
  {
    match: /subnet.*associated.*network.*security.*group|nsg.*subnet/i,
    problem: {
      es: "Asociar grupos de seguridad de red (NSG) a todas las subredes",
      en: "Subnets should be associated with a Network Security Group",
      "pt-BR": "Sub-redes devem ser associadas a um Grupo de Segurança de Rede (NSG)",
    },
    solution: {
      es: "Asigna un NSG a cada subred para controlar y filtrar el tráfico entrante y saliente.",
      en: "Assign an NSG to every subnet to control and filter incoming and outgoing traffic.",
      "pt-BR": "Atribua um NSG a cada sub-rede para controlar e filtrar o tráfego de entrada e saída.",
    },
  },
  {
    match: /vulnerability.*assessment.*(virtual.*machine|sql|database)/i,
    problem: {
      es: "Habilitar evaluación de vulnerabilidades en máquinas virtuales o bases de datos",
      en: "Enable vulnerability assessment on virtual machines or databases",
      "pt-BR": "Habilitar avaliação de vulnerabilidades em máquinas virtuais ou bancos de dados",
    },
    solution: {
      es: "Instala y configura el agente de análisis de vulnerabilidades para detectar fallas de seguridad a tiempo.",
      en: "Install and configure the vulnerability scanning agent to detect security flaws proactively.",
      "pt-BR": "Instale e configure o agente de verificação de vulnerabilidades para detectar falhas de segurança proativamente.",
    },
  },
  {
    match: /secure.*transfer.*storage.*account|storage.*https.*only|storage.*tls/i,
    problem: {
      es: "Requerir transferencia segura (HTTPS) y TLS moderno en cuentas de almacenamiento",
      en: "Storage accounts should require secure transfer and modern TLS",
      "pt-BR": "Contas de armazenamento devem exigir transferência segura e TLS moderno",
    },
    solution: {
      es: "Habilita 'Secure transfer required' y exige una versión mínima de TLS 1.2 en la configuración de la cuenta.",
      en: "Enable 'Secure transfer required' and enforce a minimum TLS version of 1.2 in account settings.",
      "pt-BR": "Habilite 'Transferência segura obrigatória' e exija uma versão mínima de TLS 1.2 nas configurações da conta.",
    },
  },

  // ==========================================
  // 3. CONFIABILIDAD (HIGH AVAILABILITY & RELIABILITY)
  // ==========================================
  {
    match: /enable.*(soft.?delete|backup).*(blob|storage|vm|disk|database)/i,
    problem: {
      es: "Habilitar eliminación temporal (soft delete) o copia de seguridad para proteger los datos",
      en: "Enable soft delete or backup to protect data",
      "pt-BR": "Habilitar exclusão reversível (soft delete) ou backup para proteger dados",
    },
    solution: {
      es: "Configura la retención de eliminación temporal y copias de seguridad automáticas para recuperar datos ante borrados accidentales.",
      en: "Configure soft delete retention and automated backups to recover data from accidental deletions.",
      "pt-BR": "Configure a retenção de exclusão reversível e backups automáticos para recuperar dados de exclusões acidentais.",
    },
  },
  {
    match: /(configure|use).*availability.?(zone|set)|availability.*zone.*critical.*vm/i,
    problem: {
      es: "Configurar Zonas de Disponibilidad para máquinas virtuales críticas",
      en: "Configure Availability Zones for critical virtual machines",
      "pt-BR": "Configurar Zonas de Disponibilidade para máquinas virtuais críticas",
    },
    solution: {
      es: "Distribuye las instancias de tus aplicaciones en múltiples Zonas de Disponibilidad para protegerlas contra fallas en centros de datos.",
      en: "Distribute application instances across multiple Availability Zones to protect against datacenter outages.",
      "pt-BR": "Distribua as instâncias de suas aplicações em várias Zonas de Disponibilidade para protegê-las contra falhas em data centers.",
    },
  },
  {
    match: /enable.*geo.?redundant.*backup|configure.*grs.*storage/i,
    problem: {
      es: "Habilitar copias de seguridad geo-redundantes (GRS)",
      en: "Enable geo-redundant backups (GRS)",
      "pt-BR": "Habilitar backups com redundância geográfica (GRS)",
    },
    solution: {
      es: "Configura almacenamiento con redundancia geográfica para garantizar la recuperación ante desastres en caso de una interrupción regional.",
      en: "Configure geo-redundant storage to guarantee disaster recovery in the event of a regional outage.",
      "pt-BR": "Configure armazenamento com redundância geográfica para garantir recuperação de desastres no caso de interrupção regional.",
    },
  },
  {
    match: /(health.?probe|load.?balancer.*probe)/i,
    problem: {
      es: "Configurar sondas de mantenimiento (health probes) en Load Balancers",
      en: "Configure health probes on Load Balancers",
      "pt-BR": "Configurar investigações de integridade (health probes) em Load Balancers",
    },
    solution: {
      es: "Asegura que el balanceador de carga redirija el tráfico únicamente a instancias de backend saludables.",
      en: "Ensure the load balancer routes traffic only to healthy backend instances.",
      "pt-BR": "Garanta que o balanceador de carga redirecione o tráfego apenas para instâncias de backend íntegras.",
    },
  },
  {
    match: /cross.?region.*(replication|replica)|site.?recovery/i,
    problem: {
      es: "Configurar replicación entre regiones para recuperación ante desastres",
      en: "Configure cross-region replication for disaster recovery",
      "pt-BR": "Configurar replicação entre regiões para recuperação de desastres",
    },
    solution: {
      es: "Configura réplicas en una región secundaria para mantener la continuidad del negocio ante contingencias.",
      en: "Set up replicas in a secondary region to maintain business continuity during contingencies.",
      "pt-BR": "Configure réplicas em uma região secundária para manter a continuidade do negócio em caso de contingências.",
    },
  },

  // ==========================================
  // 4. RENDIMIENTO (PERFORMANCE)
  // ==========================================
  {
    match: /upgrade.*(premium|ultra).*ssd.*(disk|improve.*performance)/i,
    problem: {
      es: "Actualizar a discos Premium SSD o Ultra Disk para mejorar el rendimiento",
      en: "Upgrade to Premium SSD or Ultra Disks to improve performance",
      "pt-BR": "Atualizar para discos Premium SSD ou Ultra Disk para melhorar o desempenho",
    },
    solution: {
      es: "Migra discos Standard HDD/SSD a Premium SSD en cargas de trabajo con altos requerimientos de IOPS y baja latencia.",
      en: "Migrate Standard HDD/SSD disks to Premium SSD on workloads requiring high IOPS and low latency.",
      "pt-BR": "Migre discos Standard HDD/SSD para Premium SSD em cargas de trabalho com alta demanda de IOPS e baixa latência.",
    },
  },
  {
    match: /increase.*sql.*database.*performance.*tier|scale.*sql.*dtu/i,
    problem: {
      es: "Aumentar el nivel de rendimiento de la base de datos SQL",
      en: "Increase the SQL database performance tier",
      "pt-BR": "Aumentar o nível de desempenho do banco de dados SQL",
    },
    solution: {
      es: "Aumenta la asignación de DTUs o vCores en bases de datos que operan cerca del 100% de utilización sostenida.",
      en: "Increase DTU or vCore allocation on databases operating near 100% sustained utilization.",
      "pt-BR": "Aumente a alocação de DTUs ou vCores em bancos de dados que operam próximos de 100% de utilização sustentada.",
    },
  },
  {
    match: /enable.*accelerated.*networking.*(virtual.*machine|vm)/i,
    problem: {
      es: "Habilitar aceleración de red en máquinas virtuales compatibles",
      en: "Enable accelerated networking on supported virtual machines",
      "pt-BR": "Habilitar aceleração de rede em máquinas virtuais compatíveis",
    },
    solution: {
      es: "Activa Accelerated Networking (SR-IOV) para reducir la latencia, jitter y uso de CPU en la tarjeta de red.",
      en: "Turn on Accelerated Networking (SR-IOV) to decrease latency, jitter, and CPU utilization on network interfaces.",
      "pt-BR": "Ative o Accelerated Networking (SR-IOV) para diminuir a latência, jitter e uso de CPU na interface de rede.",
    },
  },
  {
    match: /cosmos.*(index|indexing|partition|ru)/i,
    problem: {
      es: "Optimizar las directivas de indexación y particionamiento en Cosmos DB",
      en: "Optimize indexing policies and partition keys in Cosmos DB",
      "pt-BR": "Otimizar políticas de indexação e chaves de partição no Cosmos DB",
    },
    solution: {
      es: "Ajusta las rutas de indexación excluidas y revisa el consumo de Request Units (RU/s) en consultas complejas.",
      en: "Tune excluded indexing paths and review Request Unit (RU/s) consumption on complex queries.",
      "pt-BR": "Ajuste os caminhos de indexação excluídos e revise o consumo de Request Units (RU/s) em consultas complexas.",
    },
  },
  {
    match: /redis.*(cache|memory|hit.*ratio)/i,
    problem: {
      es: "Escalar la capacidad o ajustar la política de desalojo en Azure Cache for Redis",
      en: "Scale capacity or adjust eviction policy in Azure Cache for Redis",
      "pt-BR": "Escalar a capacidade ou ajustar a política de remoção no Azure Cache for Redis",
    },
    solution: {
      es: "Evita la pérdida de datos y ralentizaciones escalando el clúster de Redis o configurando una política maxmemory adecuada.",
      en: "Prevent data loss and slowdowns by scaling the Redis cluster or configuring an appropriate maxmemory policy.",
      "pt-BR": "Evite perda de dados e lentidão escalando o cluster do Redis ou configurando uma política maxmemory adequada.",
    },
  },

  // ==========================================
  // 5. EXCELENCIA OPERATIVA (OPERATIONAL EXCELLENCE)
  // ==========================================
  {
    match: /assign.*tag.*resource.*improve.*governance|tag.*resources/i,
    problem: {
      es: "Asignar etiquetas a los recursos para mejorar la gobernanza y asignación de costos",
      en: "Assign tags to resources to improve governance and cost allocation",
      "pt-BR": "Atribuir tags aos recursos para melhorar a governança e alocação de custos",
    },
    solution: {
      es: "Aplica la taxonomía de etiquetas requerida (Entorno, Centro de Costos, Propietario) para permitir el seguimiento detallado de costos.",
      en: "Apply the required tag taxonomy (Environment, CostCenter, Owner) to enable detailed cost tracking.",
      "pt-BR": "Aplique a taxonomia de tags exigida (Ambiente, Centro de Custo, Proprietário) para permitir o acompanhamento detalhado de custos.",
    },
  },
  {
    match: /configure.*azure.*service.*health.*alert|service.*health.*alert/i,
    problem: {
      es: "Configurar alertas de estado del servicio (Azure Service Health)",
      en: "Configure Azure Service Health alerts",
      "pt-BR": "Configurar alertas de integridade do serviço (Azure Service Health)",
    },
    solution: {
      es: "Crea reglas de alerta para recibir notificaciones inmediatas ante incidentes que afecten a los servicios de Azure en tus regiones.",
      en: "Create alert rules to receive prompt notifications when Azure service issues affect your regions.",
      "pt-BR": "Crie regras de alerta para receber notificações imediatas quando problemas nos serviços do Azure afetarem suas regiões.",
    },
  },
  {
    match: /diagnostic.*setting.*(activity.*log|log.*analytics)/i,
    problem: {
      es: "Configurar la exportación de registros de actividad a Log Analytics",
      en: "Configure activity logs diagnostic settings to Log Analytics",
      "pt-BR": "Configurar configurações de diagnóstico de logs de atividade para o Log Analytics",
    },
    solution: {
      es: "Centraliza y conserva los registros de auditoría y operaciones en un área de trabajo de Log Analytics para análisis y cumplimiento.",
      en: "Centralize and retain audit and operational logs in a Log Analytics workspace for analytics and compliance.",
      "pt-BR": "Centralize e retenha logs de auditoria e operacionais em um workspace do Log Analytics para análise e conformidade.",
    },
  },
  {
    match: /migrate.*classic.*(virtual.*machine|resource)|classic.*arm/i,
    problem: {
      es: "Migrar recursos clásicos (ASM) a Azure Resource Manager (ARM)",
      en: "Migrate classic (ASM) resources to Azure Resource Manager (ARM)",
      "pt-BR": "Migrar recursos clássicos (ASM) para o Azure Resource Manager (ARM)",
    },
    solution: {
      es: "Migra las VMs y redes clásicas a ARM para habilitar nuevas funcionalidades, mayor seguridad y soporte a largo plazo.",
      en: "Migrate classic VMs and VNets to ARM to enable newer features, enhanced security, and long-term support.",
      "pt-BR": "Migre VMs e redes clássicas para o ARM para habilitar novos recursos, maior segurança e suporte a longo prazo.",
    },
  },
  {
    match: /azure.*policy.*(enforce|compliance|governance)/i,
    problem: {
      es: "Implementar Azure Policy para asegurar el cumplimiento y la gobernanza",
      en: "Implement Azure Policy to ensure compliance and governance",
      "pt-BR": "Implementar o Azure Policy para garantir conformidade e governança",
    },
    solution: {
      es: "Aplica iniciativas de Azure Policy para auditar o bloquear configuraciones de recursos no conformes.",
      en: "Apply Azure Policy initiatives to audit or block non-compliant resource configurations.",
      "pt-BR": "Aplique iniciativas do Azure Policy para auditar ou bloquear configurações de recursos fora de conformidade.",
    },
  },
];

// Fallback de traducción por frases/palabras completas para textos no cubiertos por ENTRIES
const FALLBACK_GLOSSARY: GlossaryEntry[] = [
  { match: /\b(right-?size|resize)\b/gi, replace: { es: "redimensionar", "pt-BR": "redimensionar" } },
  { match: /\b(underutilized|idle)\b/gi, replace: { es: "subutilizado", "pt-BR": "subutilizado" } },
  { match: /\bvirtual machines?\b/gi, replace: { es: "máquinas virtuales", "pt-BR": "máquinas virtuais" } },
  { match: /\bsql databases?\b/gi, replace: { es: "bases de datos SQL", "pt-BR": "bancos de dados SQL" } },
  { match: /\breserved instances?\b/gi, replace: { es: "instancias reservadas", "pt-BR": "instâncias reservadas" } },
  { match: /\bsavings plans?\b/gi, replace: { es: "planes de ahorro", "pt-BR": "planos de economia" } },
  { match: /\bpay-?as-?you-?go\b/gi, replace: { es: "pago por uso", "pt-BR": "pagamento por uso" } },
  { match: /\bcosts?\b/gi, replace: { es: "costos", "pt-BR": "custos" } },
  { match: /\bsave money\b/gi, replace: { es: "ahorrar dinero", "pt-BR": "economizar dinheiro" } },
  { match: /\b(delete|remove)\b/gi, replace: { es: "eliminar", "pt-BR": "excluir" } },
  { match: /\bunattached\b/gi, replace: { es: "no conectado", "pt-BR": "não conectado" } },
  { match: /\bunassociated\b/gi, replace: { es: "no asociado", "pt-BR": "não associado" } },
  { match: /\bpublic ip addresses?\b/gi, replace: { es: "direcciones IP públicas", "pt-BR": "endereços IP públicos" } },
  { match: /\bstorage accounts?\b/gi, replace: { es: "cuentas de almacenamiento", "pt-BR": "contas de armazenamento" } },
  { match: /\benable\b/gi, replace: { es: "habilitar", "pt-BR": "habilitar" } },
  { match: /\bconfigure\b/gi, replace: { es: "configurar", "pt-BR": "configurar" } },
  { match: /\bupgrade\b/gi, replace: { es: "actualizar", "pt-BR": "atualizar" } },
  { match: /\brestrict\b/gi, replace: { es: "restringir", "pt-BR": "restringir" } },
  { match: /\bbackups?\b/gi, replace: { es: "copia de seguridad", "pt-BR": "backup" } },
  { match: /\bavailability zones?\b/gi, replace: { es: "zonas de disponibilidad", "pt-BR": "zonas de disponibilidade" } },
  { match: /\bmanaged disks?\b/gi, replace: { es: "discos administrados", "pt-BR": "discos gerenciados" } },
  { match: /\bapp service plans?\b/gi, replace: { es: "planes de App Service", "pt-BR": "planos de App Service" } },
  { match: /\bsnapshots?\b/gi, replace: { es: "instantáneas", "pt-BR": "snapshots" } },
  { match: /\bshould be\b/gi, replace: { es: "debería estar", "pt-BR": "deveria estar" } },
  { match: /\bconsider\b/gi, replace: { es: "considerar", "pt-BR": "considerar" } },
  { match: /\bimprove\b/gi, replace: { es: "mejorar", "pt-BR": "melhorar" } },
  { match: /\bincrease\b/gi, replace: { es: "aumentar", "pt-BR": "aumentar" } },
  { match: /\bto (avoid|prevent)\b/gi, replace: { es: "para evitar", "pt-BR": "para evitar" } },
  { match: /\bdata loss\b/gi, replace: { es: "pérdida de datos", "pt-BR": "perda de dados" } },
];

type GlossaryEntry = {
  match: RegExp;
  replace: Record<Exclude<AdvisorLocale, "en">, string>;
};

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
  const target = normalizeAdvisorLocale(locale);
  for (const entry of ENTRIES) {
    if (!entry.match.test(text)) continue;
    const primary = kind === "problem" ? entry.problem : entry.solution;
    const secondary = kind === "problem" ? entry.solution : entry.problem;
    if (primary && primary[target]) return primary[target];
    if (secondary && secondary[target]) return secondary[target];
  }
  return applyFallbackGlossary(text, target);
}

/**
 * Nombre formal de las 5 categorias del Well-Architected Framework tal como las
 * publica Advisor (`Cost`, `HighAvailability`, …). Azure las devuelve SIEMPRE en
 * ingles en el campo `category` sin importar el Accept-Language, asi que el
 * mapeo tiene que ser nuestro.
 */
const CATEGORY_NAMES: Record<string, Trio> = {
  cost: { es: "Costos", en: "Cost", "pt-BR": "Custos" },
  highavailability: { es: "Alta Disponibilidad", en: "High Availability", "pt-BR": "Alta Disponibilidade" },
  reliability: { es: "Alta Disponibilidad", en: "Reliability", "pt-BR": "Alta Disponibilidade" },
  security: { es: "Seguridad", en: "Security", "pt-BR": "Segurança" },
  performance: { es: "Rendimiento", en: "Performance", "pt-BR": "Desempenho" },
  operationalexcellence: { es: "Excelencia Operativa", en: "Operational Excellence", "pt-BR": "Excelência Operacional" },
};

export function translateAdvisorCategory(category: string | undefined | null, locale: string): string {
  if (!category) return "";
  const target = normalizeAdvisorLocale(locale);
  const key = String(category).toLowerCase().replace(/[\s_-]/g, "");
  const entry = CATEGORY_NAMES[key];
  return entry ? entry[target] : String(category);
}

const IMPACT_NAMES: Record<string, Trio> = {
  high: { es: "Alto", en: "High", "pt-BR": "Alto" },
  medium: { es: "Medio", en: "Medium", "pt-BR": "Médio" },
  low: { es: "Bajo", en: "Low", "pt-BR": "Baixo" },
};

export function translateAdvisorImpact(impact: string | undefined | null, locale: string): string {
  if (!impact) return "";
  const target = normalizeAdvisorLocale(locale);
  const entry = IMPACT_NAMES[String(impact).toLowerCase()];
  return entry ? entry[target] : String(impact);
}

/**
 * Extrae el nombre legible del recurso a partir de un Resource ID de ARM o nombre crudo.
 * Ejemplo:
 *   /subscriptions/.../resourceGroups/my-rg/providers/Microsoft.Compute/virtualMachines/my-vm-01
 *   -> { name: "my-vm-01", resourceGroup: "my-rg", type: "virtualMachines" }
 */
export function extractResourceDisplayName(raw?: string | null): {
  name: string;
  resourceGroup?: string;
  /** Ultimo segmento del tipo, legible: "virtualMachines", "Redis". */
  type?: string;
  /** Tipo completo ARM: "Microsoft.Compute/virtualMachines". */
  resourceType?: string;
  subscriptionId?: string;
  isArmId: boolean;
} {
  if (!raw || raw.trim() === "" || raw === "—") {
    return { name: "—", isArmId: false };
  }
  const clean = raw.trim();
  if (clean.includes("/") && (clean.startsWith("/subscriptions/") || clean.includes("/providers/"))) {
    const parts = clean.split("/").filter(Boolean);
    const name = parts[parts.length - 1] || clean;
    const rgIdx = parts.findIndex(p => p.toLowerCase() === "resourcegroups");
    const rg = rgIdx !== -1 && parts[rgIdx + 1] ? parts[rgIdx + 1] : undefined;
    const subIdx = parts.findIndex(p => p.toLowerCase() === "subscriptions");
    const subscriptionId = subIdx !== -1 && parts[subIdx + 1] ? parts[subIdx + 1] : undefined;
    const provIdx = parts.findIndex(p => p.toLowerCase() === "providers");
    const provider = provIdx !== -1 && parts[provIdx + 1] ? parts[provIdx + 1] : undefined;
    const type = provIdx !== -1 && parts[provIdx + 2] ? parts[provIdx + 2] : undefined;
    // Tipos anidados (…/servers/{s}/databases/{db}) conservan el ultimo par
    // proveedor/tipo, que es el que define el recurso realmente afectado.
    const nestedIdx = parts.length >= 4 && provIdx !== -1 ? parts.length - 2 : -1;
    const leafType = nestedIdx > provIdx + 2 ? parts[nestedIdx] : type;
    return {
      name,
      resourceGroup: rg,
      type: leafType,
      resourceType: provider && leafType ? `${provider}/${leafType}` : undefined,
      subscriptionId,
      isArmId: true,
    };
  }
  return { name: clean, isArmId: false };
}

/**
 * Formatea el plazo de término y el lookback en el idioma activo.
 * Ejemplo: P3Y / 30 -> " (3 años / 30 días)" en es, " (3 years / 30 days)" en en.
 */
export function formatAdvisorTermAndLookback(
  term?: string,
  lookback?: string | number,
  locale: string = "es"
): string {
  if (!term && !lookback) return "";
  const target = normalizeAdvisorLocale(locale);

  let termStr = "";
  if (term) {
    const m = term.match(/^P?(\d+)Y$/i);
    const years = m ? m[1] : term;
    if (target === "en") {
      termStr = years === "1" ? "1 year" : `${years} years`;
    } else if (target === "pt-BR") {
      termStr = years === "1" ? "1 ano" : `${years} anos`;
    } else {
      termStr = years === "1" ? "1 año" : `${years} años`;
    }
  }

  let lbStr = "";
  if (lookback) {
    const d = String(lookback).replace(/[^0-9]/g, "");
    if (target === "en") {
      lbStr = d === "1" ? "1 day" : `${d} days`;
    } else if (target === "pt-BR") {
      lbStr = d === "1" ? "1 dia" : `${d} dias`;
    } else {
      lbStr = d === "1" ? "1 día" : `${d} días`;
    }
  }

  if (termStr && lbStr) return ` (${termStr} / ${lbStr})`;
  if (termStr) return ` (${termStr})`;
  if (lbStr) return ` (${lbStr})`;
  return "";
}

/**
 * Diccionario para traducir encabezados de columnas dinámicas que provienen
 * de extendedProperties de Azure.
 */
const COLUMN_HEADERS: Record<string, Trio> = {
  "Target Sku":             { es: "SKU Recomendado",            en: "Recommended SKU",          "pt-BR": "SKU Recomendado"          },
  "Current Sku":            { es: "SKU Actual",                 en: "Current SKU",              "pt-BR": "SKU Atual"                },
  "Sku":                    { es: "SKU",                        en: "SKU",                      "pt-BR": "SKU"                      },
  "Term":                   { es: "Plazo",                      en: "Term",                     "pt-BR": "Prazo"                    },
  "Lookback Period":        { es: "Período de Análisis",        en: "Look-back Period",         "pt-BR": "Período de Análise"       },
  "Region":                 { es: "Región",                     en: "Region",                   "pt-BR": "Região"                   },
  "Location":               { es: "Ubicación",                  en: "Location",                 "pt-BR": "Localização"              },
  "Quantity":               { es: "Cantidad",                   en: "Quantity",                 "pt-BR": "Quantidade"               },
  "Scope":                  { es: "Ámbito",                     en: "Scope",                    "pt-BR": "Escopo"                   },
  "Resource Type":          { es: "Tipo de Recurso",            en: "Resource Type",            "pt-BR": "Tipo de Recurso"          },
  "Action":                 { es: "Acción",                     en: "Action",                   "pt-BR": "Ação"                     },
  "Current Tier":           { es: "Nivel Actual",               en: "Current Tier",             "pt-BR": "Nível Atual"              },
  "Target Tier":            { es: "Nivel Recomendado",          en: "Recommended Tier",         "pt-BR": "Nível Recomendado"        },
  "Current Size":           { es: "Tamaño Actual",              en: "Current Size",             "pt-BR": "Tamanho Atual"            },
  "Target Size":            { es: "Tamaño Recomendado",         en: "Recommended Size",         "pt-BR": "Tamanho Recomendado"      },
  "Recommended Size":       { es: "Tamaño Recomendado",         en: "Recommended Size",         "pt-BR": "Tamanho Recomendado"      },
  "Cpu Utilization":        { es: "Uso de CPU",                 en: "CPU Utilization",          "pt-BR": "Uso de CPU"               },
  "Memory Utilization":     { es: "Uso de Memoria",             en: "Memory Utilization",       "pt-BR": "Uso de Memória"           },
  "Max Cpu":                { es: "CPU Máximo",                 en: "Max CPU",                  "pt-BR": "CPU Máximo"               },
  "Avg Cpu":                { es: "CPU Promedio",               en: "Avg CPU",                  "pt-BR": "CPU Médio"                },
  "Min Cpu":                { es: "CPU Mínimo",                 en: "Min CPU",                  "pt-BR": "CPU Mínimo"               },
  "Virtual Machine":        { es: "Máquina Virtual",            en: "Virtual Machine",          "pt-BR": "Máquina Virtual"          },
  "Disk Size":              { es: "Tamaño de Disco",            en: "Disk Size",                "pt-BR": "Tamanho do Disco"         },
  "Storage Tier":           { es: "Nivel de Almacenamiento",    en: "Storage Tier",             "pt-BR": "Nível de Armazenamento"   },
  "Recommendation Rule":    { es: "Regla de Recomendación",     en: "Recommendation Rule",      "pt-BR": "Regra de Recomendação"    },
  "Savings Currency":       { es: "Moneda de Ahorro",           en: "Savings Currency",         "pt-BR": "Moeda de Economia"        },
  "Role":                   { es: "Rol",                        en: "Role",                     "pt-BR": "Função"                   },
  "Policy Name":            { es: "Nombre de Directiva",        en: "Policy Name",              "pt-BR": "Nome da Política"         },
  "Resource":               { es: "Recurso",                    en: "Resource",                 "pt-BR": "Recurso"                  },
  "Subscription":           { es: "Suscripción",                en: "Subscription",             "pt-BR": "Assinatura"               },
};

/**
 * Resuelve y formatea el SKU de forma inteligente:
 * Si Azure devuelve "Compute_Savings_Plan" u otro genérico pero hay un SKU de VM real
 * en los metadatos o en el texto de la recomendación (ej. Standard_D4s_v3), muestra el SKU real de la máquina.
 * Si es un Savings Plan genérico, lo formatea en el idioma activo.
 */
export function resolveRecommendedSku(
  ext: Record<string, any> = {},
  fallbackText?: string,
  locale: string = "es"
): string {
  // 1. Buscar en propiedades específicas de tamaño/SKU de VM
  const candidateKeys = [
    'targetSku', 'recommendedSku', 'targetSize', 'recommendedSize',
    'newSize', 'targetVmSize', 'recommendedVmSize', 'sku', 'currentSku', 'currentSize'
  ];

  let vmSkuFound = "";
  for (const k of candidateKeys) {
    const val = String(ext[k] || "").trim();
    if (!val) continue;
    // Si parece un SKU de VM real de Azure (ej. Standard_D4s_v3, B2s, Standard_E4s_v3, etc.)
    if (/^(Standard|Basic|Premium)_[A-Za-z0-9_]+/i.test(val)) {
      vmSkuFound = val;
      break;
    }
  }

  // 2. Si no se encontró en las keys, buscar en el texto de solución/recomendación
  if (!vmSkuFound && fallbackText) {
    // Si hay una transición "A → B", "A -> B", "A to B", el SKU sugerido es el destino B
    const transitionMatch = fallbackText.match(/(?:→|->|\bto\b|\ba\b|\bpara\b)\s*((?:Standard|Basic|Premium)_[A-Za-z0-9_]+)/i);
    if (transitionMatch && transitionMatch[1]) {
      vmSkuFound = transitionMatch[1];
    } else {
      const singleMatch = fallbackText.match(/((?:Standard|Basic|Premium)_[A-Za-z0-9_]+)/i);
      if (singleMatch && singleMatch[1]) {
        vmSkuFound = singleMatch[1];
      }
    }
  }

  if (vmSkuFound) {
    return vmSkuFound;
  }

  // 3. Si es un Savings Plan genérico sin SKU específico de VM
  const rawSku = String(ext.targetSku || ext.sku || ext.recommendedSku || "").trim();
  if (/compute.*saving|saving.*plan/i.test(rawSku)) {
    const target = normalizeAdvisorLocale(locale);
    if (target === "en") return "Compute Savings Plan";
    if (target === "pt-BR") return "Plano de Economia para Computação";
    return "Plan de Ahorro para Cómputo";
  }

  return rawSku;
}

/**
 * Traduce el nombre de una columna dinámica de tabla al locale activo.
 */
export function translateColumnHeader(headerKey: string, locale: string): string {
  const target = normalizeAdvisorLocale(locale);
  if (COLUMN_HEADERS[headerKey]?.[target]) {
    return COLUMN_HEADERS[headerKey][target];
  }

  // Fallback si la clave viene en minúsculas o con variaciones
  const normalizedKey = Object.keys(COLUMN_HEADERS).find(
    k => k.toLowerCase() === headerKey.toLowerCase()
  );
  if (normalizedKey && COLUMN_HEADERS[normalizedKey]?.[target]) {
    return COLUMN_HEADERS[normalizedKey][target];
  }

  if (target === "en") return headerKey;

  // Reemplazo inteligente de palabras comunes de encabezados
  let translated = headerKey;
  const wordMap: Record<string, Trio> = {
    "Current":      { es: "Actual",       en: "Current",      "pt-BR": "Atual"        },
    "Target":       { es: "Recomendado",  en: "Recommended",  "pt-BR": "Recomendado"  },
    "Recommended":  { es: "Recomendado",  en: "Recommended",  "pt-BR": "Recomendado"  },
    "Type":         { es: "Tipo",         en: "Type",         "pt-BR": "Tipo"         },
    "Size":         { es: "Tamaño",       en: "Size",         "pt-BR": "Tamanho"      },
    "Tier":         { es: "Nivel",        en: "Tier",         "pt-BR": "Nível"        },
    "Utilization":  { es: "Uso",          en: "Utilization",  "pt-BR": "Uso"          },
    "Amount":       { es: "Monto",        en: "Amount",       "pt-BR": "Valor"        },
    "Savings":      { es: "Ahorro",       en: "Savings",      "pt-BR": "Economia"     },
  };

  for (const [enWord, trio] of Object.entries(wordMap)) {
    const reg = new RegExp(`\\b${enWord}\\b`, "gi");
    translated = translated.replace(reg, trio[target]);
  }

  return translated;
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
  const target = normalizeAdvisorLocale(locale);
  return ZOMBIE_TYPE_NAMES[name]?.[target] ?? name;
}
