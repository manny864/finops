import type {
  AdvisorModel,
  AdvisorRecommendation,
  AdvisorLifecycleRow,
  AdvisorCarbonRow,
} from './advisorModel';

// Mock rico de Azure Advisor para demos. Reproduce la experiencia del portal:
// scores por categoría, tablas por categoría con impacto/recursos/progreso, y
// para Cost el detalle con ciclo de vida (Active/Completed/Postponed/Dismissed).
// Todos los textos visibles se traducen según el locale activo.

const DAY = 86400000;
const iso = (daysAgo: number) => new Date(Date.now() - daysAgo * DAY).toISOString().slice(0, 10);
const isoFwd = (daysAhead: number) => new Date(Date.now() + daysAhead * DAY).toISOString().slice(0, 10);

type Lang = 'es' | 'en' | 'pt-BR';
const normLang = (locale?: string): Lang => {
  const l = (locale || 'es').toLowerCase();
  if (l.startsWith('en')) return 'en';
  if (l.startsWith('pt')) return 'pt-BR';
  return 'es';
};

// Diccionario de textos del mock (es / en / pt-BR).
const TR: Record<string, Record<Lang, string>> = {
  sub_prod: { es: 'Producción', en: 'Production', 'pt-BR': 'Produção' },
  sub_dev: { es: 'Desarrollo', en: 'Development', 'pt-BR': 'Desenvolvimento' },
  sub_data: { es: 'Datos & Analytics', en: 'Data & Analytics', 'pt-BR': 'Dados & Analytics' },

  term_3y: { es: '3 años', en: '3 years', 'pt-BR': '3 anos' },
  term_1y: { es: '1 año', en: '1 year', 'pt-BR': '1 ano' },
  lb_30: { es: '30 días', en: '30 days', 'pt-BR': '30 dias' },
  lb_60: { es: '60 días', en: '60 days', 'pt-BR': '60 dias' },

  // Cost recs
  ri_title: { es: 'Comprar reservas de máquinas virtuales para ahorrar sobre pago por uso', en: 'Buy virtual machine reserved instances to save over pay-as-you-go', 'pt-BR': 'Comprar instâncias reservadas de máquinas virtuais para economizar sobre o pagamento por uso' },
  ri_action: { es: 'Comprar reservas de VM (Standard_D4s_v3) a 3 años', en: 'Buy VM reservations (Standard_D4s_v3) for 3 years', 'pt-BR': 'Comprar reservas de VM (Standard_D4s_v3) por 3 anos' },
  ri_desc: { es: 'Según tu uso durante el término y período de retrospectiva seleccionados, recomendamos reservas para maximizar el ahorro. Las reservas se aplican automáticamente a las implementaciones coincidentes. El ahorro se estima por suscripción. Las opciones de alcance compartido están disponibles durante la compra.', en: 'Based on your usage over the selected term and look-back period, we recommend reservations to maximize savings. Reservations apply automatically to matching deployments. Savings are estimated per subscription. Shared scope options are available during purchase.', 'pt-BR': 'Com base no seu uso durante o termo e período de retrospectiva selecionados, recomendamos reservas para maximizar a economia. As reservas se aplicam automaticamente às implantações correspondentes. A economia é estimada por assinatura. Opções de escopo compartilhado estão disponíveis durante a compra.' },
  buy_reservation: { es: 'Comprar reserva', en: 'Buy reservation', 'pt-BR': 'Comprar reserva' },
  completion_ri: { es: 'Reserva comprada (alcance compartido)', en: 'Reservation purchased (shared scope)', 'pt-BR': 'Reserva comprada (escopo compartilhado)' },
  dismissal_temp: { es: 'Carga de trabajo temporal', en: 'Temporary workload', 'pt-BR': 'Carga de trabalho temporária' },

  vm_title: { es: 'Cambiar el tamaño o apagar máquinas virtuales infrautilizadas', en: 'Right-size or shut down underutilized virtual machines', 'pt-BR': 'Redimensionar ou desligar máquinas virtuais subutilizadas' },
  vm_action: { es: 'Redimensionar Standard_D8s_v3 → Standard_D4s_v3', en: 'Resize Standard_D8s_v3 → Standard_D4s_v3', 'pt-BR': 'Redimensionar Standard_D8s_v3 → Standard_D4s_v3' },
  vm_desc: { es: 'Según tu uso durante el término y período de retrospectiva seleccionados, recomendamos cambiar el tamaño de estas máquinas virtuales para reducir el costo y las emisiones sin afectar el rendimiento.', en: 'Based on your usage over the selected term and look-back period, we recommend resizing these virtual machines to reduce cost and emissions without affecting performance.', 'pt-BR': 'Com base no seu uso durante o termo e período de retrospectiva selecionados, recomendamos redimensionar essas máquinas virtuais para reduzir custo e emissões sem afetar o desempenho.' },
  vm_action_e4: { es: 'Cambiar tamaño a Standard_E4s_v3', en: 'Resize to Standard_E4s_v3', 'pt-BR': 'Redimensionar para Standard_E4s_v3' },
  rule_rightsize: { es: 'Right-size underutilized virtual machines', en: 'Right-size underutilized virtual machines', 'pt-BR': 'Right-size underutilized virtual machines' },
  addl_cpu: { es: 'CPU prom. 8% en 30 días · 4 vCPU ociosas', en: 'Avg CPU 8% over 30 days · 4 idle vCPUs', 'pt-BR': 'CPU méd. 8% em 30 dias · 4 vCPU ociosas' },
  resized_prefix: { es: 'Redimensionada el ', en: 'Resized on ', 'pt-BR': 'Redimensionada em ' },

  disk_title: { es: 'Eliminar discos administrados no conectados', en: 'Delete unattached managed disks', 'pt-BR': 'Excluir discos gerenciados não conectados' },
  disk_action: { es: 'Eliminar 5 discos no conectados', en: 'Delete 5 unattached disks', 'pt-BR': 'Excluir 5 discos não conectados' },
  disk_action_short: { es: 'Eliminar discos', en: 'Delete disks', 'pt-BR': 'Excluir discos' },
  disk_desc: { es: 'Estos discos administrados no están conectados a ninguna VM y siguen generando costo de almacenamiento.', en: 'These managed disks are not attached to any VM and keep incurring storage cost.', 'pt-BR': 'Esses discos gerenciados não estão conectados a nenhuma VM e continuam gerando custo de armazenamento.' },

  gw_title: { es: 'Reutilizar o eliminar gateways de red virtual ociosos', en: 'Repurpose or delete idle virtual network gateways', 'pt-BR': 'Reaproveitar ou excluir gateways de rede virtual ociosos' },
  gw_action: { es: 'Eliminar gateway VNet ocioso', en: 'Delete idle VNet gateway', 'pt-BR': 'Excluir gateway VNet ocioso' },
  gw_action_short: { es: 'Eliminar gateway', en: 'Delete gateway', 'pt-BR': 'Excluir gateway' },
  gw_desc: { es: 'Los gateways de red virtual sin tráfico siguen generando cargos por hora.', en: 'Virtual network gateways with no traffic keep incurring hourly charges.', 'pt-BR': 'Gateways de rede virtual sem tráfego continuam gerando cobranças por hora.' },

  // Security
  sec1_t: { es: 'Habilitar MFA para cuentas con privilegios', en: 'Enable MFA for privileged accounts', 'pt-BR': 'Habilitar MFA para contas privilegiadas' },
  sec1_a: { es: 'Configurar MFA vía Acceso Condicional para todos los roles de administrador', en: 'Configure MFA via Conditional Access for all admin roles', 'pt-BR': 'Configurar MFA via Acesso Condicional para todas as funções de administrador' },
  sec2_t: { es: 'Habilitar Microsoft Defender for Cloud en las suscripciones', en: 'Enable Microsoft Defender for Cloud on subscriptions', 'pt-BR': 'Habilitar Microsoft Defender for Cloud nas assinaturas' },
  sec2_a: { es: 'Activar los planes de Defender para servidores y almacenamiento', en: 'Turn on Defender plans for servers and storage', 'pt-BR': 'Ativar os planos do Defender para servidores e armazenamento' },
  sec3_t: { es: 'Restringir el acceso de red a cuentas de almacenamiento', en: 'Restrict network access to storage accounts', 'pt-BR': 'Restringir o acesso de rede a contas de armazenamento' },
  sec3_a: { es: 'Configurar reglas de firewall y endpoints privados', en: 'Configure firewall rules and private endpoints', 'pt-BR': 'Configurar regras de firewall e endpoints privados' },
  sec4_t: { es: 'Aplicar cifrado de discos en máquinas virtuales', en: 'Apply disk encryption on virtual machines', 'pt-BR': 'Aplicar criptografia de disco em máquinas virtuais' },
  sec4_a: { es: 'Habilitar Azure Disk Encryption', en: 'Enable Azure Disk Encryption', 'pt-BR': 'Habilitar Azure Disk Encryption' },

  // Reliability
  ha1_t: { es: 'Habilitar eliminación temporal (soft delete) para proteger tus datos', en: 'Enable soft delete to protect your data', 'pt-BR': 'Habilitar exclusão reversível (soft delete) para proteger seus dados' },
  ha1_a: { es: 'Habilitar soft delete de Blob con retención de 14 días', en: 'Enable Blob soft delete with 14-day retention', 'pt-BR': 'Habilitar soft delete de Blob com retenção de 14 dias' },
  ha1_c: { es: 'Sin costo adicional', en: 'No additional cost', 'pt-BR': 'Sem custo adicional' },
  ha2_t: { es: 'Configurar zonas de disponibilidad para VMs críticas', en: 'Configure availability zones for critical VMs', 'pt-BR': 'Configurar zonas de disponibilidade para VMs críticas' },
  ha2_a: { es: 'Distribuir las VMs en al menos 2 zonas de disponibilidad', en: 'Spread VMs across at least 2 availability zones', 'pt-BR': 'Distribuir as VMs em pelo menos 2 zonas de disponibilidade' },
  ha2_c: { es: 'Puede aumentar el costo de red entre zonas', en: 'May increase inter-zone network cost', 'pt-BR': 'Pode aumentar o custo de rede entre zonas' },
  ha3_t: { es: 'Habilitar copias de seguridad geo-redundantes', en: 'Enable geo-redundant backups', 'pt-BR': 'Habilitar backups geo-redundantes' },
  ha3_a: { es: 'Configurar GRS en las cuentas de almacenamiento críticas', en: 'Configure GRS on critical storage accounts', 'pt-BR': 'Configurar GRS nas contas de armazenamento críticas' },
  ha3_c: { es: '+15% sobre almacenamiento LRS', en: '+15% over LRS storage', 'pt-BR': '+15% sobre armazenamento LRS' },

  // Performance
  perf1_t: { es: 'Actualizar a discos Premium SSD para mejorar el rendimiento', en: 'Upgrade to Premium SSD disks to improve performance', 'pt-BR': 'Atualizar para discos Premium SSD para melhorar o desempenho' },
  perf1_a: { es: 'Migrar Standard HDD a Premium SSD en cargas con alto IOPS', en: 'Migrate Standard HDD to Premium SSD on high-IOPS workloads', 'pt-BR': 'Migrar Standard HDD para Premium SSD em cargas com alto IOPS' },
  perf2_t: { es: 'Aumentar el nivel de rendimiento de la base de datos SQL', en: 'Increase the SQL database performance tier', 'pt-BR': 'Aumentar o nível de desempenho do banco de dados SQL' },
  perf2_a: { es: 'Escalar a un tier vCore con más DTUs', en: 'Scale to a vCore tier with more DTUs', 'pt-BR': 'Escalar para um tier vCore com mais DTUs' },
  perf3_t: { es: 'Habilitar aceleración de red en máquinas virtuales compatibles', en: 'Enable accelerated networking on supported virtual machines', 'pt-BR': 'Habilitar aceleração de rede em máquinas virtuais compatíveis' },
  perf3_a: { es: 'Activar Accelerated Networking en las VMs elegibles', en: 'Turn on Accelerated Networking on eligible VMs', 'pt-BR': 'Ativar Accelerated Networking nas VMs elegíveis' },

  // Operational Excellence
  oe1_t: { es: 'Asignar etiquetas a los recursos para mejorar la gobernanza', en: 'Assign tags to resources to improve governance', 'pt-BR': 'Atribuir tags aos recursos para melhorar a governança' },
  oe1_a: { es: 'Aplicar la taxonomía de etiquetas requerida (CostCenter, Owner)', en: 'Apply the required tag taxonomy (CostCenter, Owner)', 'pt-BR': 'Aplicar a taxonomia de tags exigida (CostCenter, Owner)' },
  oe2_t: { es: 'Configurar alertas de estado de servicio de Azure', en: 'Configure Azure Service Health alerts', 'pt-BR': 'Configurar alertas de integridade de serviço do Azure' },
  oe2_a: { es: 'Crear reglas de alerta de Service Health por suscripción', en: 'Create Service Health alert rules per subscription', 'pt-BR': 'Criar regras de alerta de Service Health por assinatura' },
};

export function getAdvisorMock(multiplier = 1, locale?: string): AdvisorModel {
  const lang = normLang(locale);
  const tr = (k: string) => TR[k]?.[lang] ?? TR[k]?.es ?? k;
  const m = Math.max(1, multiplier);
  // Multiplicador acotado para CONTEOS de recursos: el multiplier de tier puede
  // ser muy alto (Enterprise ~50) e inflaría "600 recursos" en una sola
  // recomendación. El ahorro sí escala con el multiplier completo.
  const mm = Math.max(1, Math.round(1 + (m - 1) / 10));
  const round = (x: number) => Math.round(x);

  const SUBS = [
    { id: 'sub-prod-0001', name: tr('sub_prod') },
    { id: 'sub-dev-0002', name: tr('sub_dev') },
    { id: 'sub-data-0003', name: tr('sub_data') },
  ];

  const stdRow = (over: Partial<AdvisorLifecycleRow>): AdvisorLifecycleRow => ({
    subscription: tr('sub_prod'),
    recommendedQuantity: '3',
    recommendedAction: tr('buy_reservation'),
    potentialYearlySavings: 1240,
    term: tr('term_3y'),
    lookBackPeriod: tr('lb_30'),
    created: iso(21),
    ...over,
  });

  const carbonRow = (over: Partial<AdvisorCarbonRow>): AdvisorCarbonRow => ({
    virtualMachine: 'app-prod-vm-01',
    recommendedAction: tr('vm_action'),
    savingsRetail: 980,
    savingsDiscounted: 1240,
    carbonReduction: 210,
    subscription: tr('sub_prod'),
    recommendationRule: tr('rule_rightsize'),
    additionalDetails: tr('addl_cpu'),
    ...over,
  });

  // --- COST ---
  const cost: AdvisorRecommendation[] = [
    {
      id: 'mock-cost-ri', category: 'Cost', subscriptionId: 'sub-prod-0001',
      recommendation: tr('ri_title'), impact: 'High', activeResources: 12 * mm, completionProgress: 15,
      potentialSavings: round(14800 * m), recommendedAction: tr('ri_action'), lastRefreshed: iso(1),
      isCarbon: false, detailDescription: tr('ri_desc'), yearlySavingsDiscounted: round(14800 * m),
      lifecycle: {
        active: [
          stdRow({ subscription: tr('sub_prod'), recommendedQuantity: '6', potentialYearlySavings: round(8200 * m), lastUpdated: iso(1) }),
          stdRow({ subscription: tr('sub_data'), recommendedQuantity: '4', potentialYearlySavings: round(4300 * m), term: tr('term_1y'), lookBackPeriod: tr('lb_60'), lastUpdated: iso(2) }),
          stdRow({ subscription: tr('sub_dev'), recommendedQuantity: '2', potentialYearlySavings: round(2300 * m), lastUpdated: iso(1) }),
        ],
        completed: [stdRow({ subscription: tr('sub_prod'), recommendedQuantity: '5', potentialYearlySavings: round(6100 * m), completionDetails: tr('completion_ri'), completedOn: iso(12) })],
        postponed: [stdRow({ subscription: tr('sub_dev'), recommendedQuantity: '3', potentialYearlySavings: round(1900 * m), postponedUntil: isoFwd(20), postponedOn: iso(5) })],
        dismissed: [stdRow({ subscription: tr('sub_data'), recommendedQuantity: '2', potentialYearlySavings: round(1200 * m), dismissalReason: tr('dismissal_temp'), dismissedOn: iso(8) })],
      },
    },
    {
      id: 'mock-cost-vm', category: 'Cost', subscriptionId: 'sub-prod-0001',
      recommendation: tr('vm_title'), impact: 'High', activeResources: 8 * mm, completionProgress: 30,
      potentialSavings: round(9600 * m), potentialCarbon: round(640 * m), recommendedAction: tr('vm_action'), lastRefreshed: iso(1),
      isCarbon: true, detailDescription: tr('vm_desc'), yearlySavingsDiscounted: round(9600 * m), yearlyCarbon: round(640 * m),
      lifecycle: {
        active: [
          carbonRow({ virtualMachine: 'app-prod-vm-01', savingsRetail: round(3200 * m), savingsDiscounted: round(4100 * m), carbonReduction: round(280 * m) }),
          carbonRow({ virtualMachine: 'api-prod-vm-02', savingsRetail: round(2100 * m), savingsDiscounted: round(2700 * m), carbonReduction: round(180 * m), subscription: tr('sub_prod') }),
          carbonRow({ virtualMachine: 'batch-data-vm-07', savingsRetail: round(1900 * m), savingsDiscounted: round(2800 * m), carbonReduction: round(180 * m), subscription: tr('sub_data'), recommendedAction: tr('vm_action_e4') }),
        ],
        completed: [carbonRow({ virtualMachine: 'legacy-dev-vm-03', savingsRetail: round(900 * m), savingsDiscounted: round(1150 * m), carbonReduction: round(90 * m), subscription: tr('sub_dev'), additionalDetails: tr('resized_prefix') + iso(9) })],
        postponed: [carbonRow({ virtualMachine: 'ml-data-vm-11', savingsRetail: round(1400 * m), savingsDiscounted: round(1800 * m), carbonReduction: round(120 * m), subscription: tr('sub_data') })],
        dismissed: [],
      },
    },
    {
      id: 'mock-cost-disk', category: 'Cost', subscriptionId: 'sub-data-0003',
      recommendation: tr('disk_title'), impact: 'Medium', activeResources: 5 * mm, completionProgress: 0,
      potentialSavings: round(1320 * m), recommendedAction: tr('disk_action'), lastRefreshed: iso(2),
      isCarbon: false, detailDescription: tr('disk_desc'), yearlySavingsDiscounted: round(1320 * m),
      lifecycle: {
        active: [stdRow({ subscription: tr('sub_data'), recommendedQuantity: '5', recommendedAction: tr('disk_action_short'), potentialYearlySavings: round(1320 * m), term: '—', lookBackPeriod: '—', lastUpdated: iso(2) })],
        completed: [], postponed: [], dismissed: [],
      },
    },
    {
      id: 'mock-cost-gw', category: 'Cost', subscriptionId: 'sub-prod-0001',
      recommendation: tr('gw_title'), impact: 'Low', activeResources: 2 * mm, completionProgress: 50,
      potentialSavings: round(2280 * m), recommendedAction: tr('gw_action'), lastRefreshed: iso(3),
      isCarbon: false, detailDescription: tr('gw_desc'), yearlySavingsDiscounted: round(2280 * m),
      lifecycle: {
        active: [stdRow({ subscription: tr('sub_prod'), recommendedQuantity: '2', recommendedAction: tr('gw_action_short'), potentialYearlySavings: round(2280 * m), term: '—', lookBackPeriod: '—', lastUpdated: iso(3) })],
        completed: [], postponed: [], dismissed: [],
      },
    },
  ];

  const mkSimple = (
    category: AdvisorRecommendation['category'], id: string, subscriptionId: string,
    recommendation: string, recommendedAction: string, impact: AdvisorRecommendation['impact'],
    activeResources: number, completionProgress: number, extra: Partial<AdvisorRecommendation> = {}
  ): AdvisorRecommendation => ({
    id, category, subscriptionId, recommendation, recommendedAction, impact,
    activeResources: activeResources * mm, completionProgress, lastRefreshed: iso(1), ...extra,
  });

  const security: AdvisorRecommendation[] = [
    mkSimple('Security', 'mock-sec-1', 'sub-prod-0001', tr('sec1_t'), tr('sec1_a'), 'High', 3, 0),
    mkSimple('Security', 'mock-sec-2', 'sub-prod-0001', tr('sec2_t'), tr('sec2_a'), 'High', 6, 20),
    mkSimple('Security', 'mock-sec-3', 'sub-data-0003', tr('sec3_t'), tr('sec3_a'), 'Medium', 4, 40),
    mkSimple('Security', 'mock-sec-4', 'sub-dev-0002', tr('sec4_t'), tr('sec4_a'), 'Low', 2, 0),
  ];

  const reliability: AdvisorRecommendation[] = [
    mkSimple('HighAvailability', 'mock-ha-1', 'sub-prod-0001', tr('ha1_t'), tr('ha1_a'), 'Medium', 5, 25, { costImplication: tr('ha1_c') }),
    mkSimple('HighAvailability', 'mock-ha-2', 'sub-prod-0001', tr('ha2_t'), tr('ha2_a'), 'High', 4, 0, { costImplication: tr('ha2_c') }),
    mkSimple('HighAvailability', 'mock-ha-3', 'sub-data-0003', tr('ha3_t'), tr('ha3_a'), 'Medium', 3, 60, { costImplication: tr('ha3_c') }),
  ];

  const performance: AdvisorRecommendation[] = [
    mkSimple('Performance', 'mock-perf-1', 'sub-data-0003', tr('perf1_t'), tr('perf1_a'), 'Medium', 6, 15),
    mkSimple('Performance', 'mock-perf-2', 'sub-prod-0001', tr('perf2_t'), tr('perf2_a'), 'High', 3, 0),
    mkSimple('Performance', 'mock-perf-3', 'sub-prod-0001', tr('perf3_t'), tr('perf3_a'), 'Low', 4, 50),
  ];

  const opex: AdvisorRecommendation[] = [
    mkSimple('OperationalExcellence', 'mock-oe-1', 'sub-prod-0001', tr('oe1_t'), tr('oe1_a'), 'Medium', 22, 35),
    mkSimple('OperationalExcellence', 'mock-oe-2', 'sub-dev-0002', tr('oe2_t'), tr('oe2_a'), 'Low', 3, 0),
  ];

  // Scores por suscripción (0..100) + total Advisor ponderado por categoría.
  const scores: AdvisorModel['scores'] = {};
  const resourceTotals: NonNullable<AdvisorModel['resourceTotals']> = {};
  const bases: Record<string, [number, number, number, number, number]> = {
    'sub-prod-0001': [68, 72, 84, 79, 66],
    'sub-dev-0002': [81, 59, 77, 88, 74],
    'sub-data-0003': [63, 67, 71, 74, 61],
  };
  for (const s of SUBS) {
    const [cS, sS, hS, pS, oS] = bases[s.id] || [70, 65, 80, 76, 68];
    const advisor = Math.round(cS * 0.35 + sS * 0.25 + hS * 0.15 + pS * 0.15 + oS * 0.1);
    scores[s.id] = { Cost: cS, Security: sS, HighAvailability: hS, Performance: pS, OperationalExcellence: oS, Advisor: advisor };
    resourceTotals[s.id] = { Cost: 48 * mm, Security: 30 * mm, HighAvailability: 26 * mm, Performance: 34 * mm, OperationalExcellence: 60 * mm };
  }

  return {
    recommendations: { Cost: cost, Security: security, HighAvailability: reliability, Performance: performance, OperationalExcellence: opex },
    subscriptions: SUBS,
    scores,
    resourceTotals,
  };
}
