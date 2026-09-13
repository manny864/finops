import { hasAccess } from "./tierLogic";
import { ADDON_PRICE_USD } from "./pricing";
import { stripLocale } from "./stripLocale";

/**
 * Catálogo Centralizado de Add-ons y Capacidades a la Carta (MEJ-13).
 * Mapeo de productos, descripciones, categorías y referencias de precios (Paddle Billing y pases temporales).
 */

export type AddonCategory = "feature" | "quota";
export type AddonType = "recurring" | "pass";

export interface AddonProduct {
    key: string;
    name: string;
    description: string;
    category: AddonCategory;
    /** Ruta que habilita el modulo. Sin esto no se puede filtrar por tier ni gatear el acceso. */
    route?: string;
    /**
     * Price IDs y precios que dependen del tier del comprador. Se resuelven en
     * `resolveAddonForTier` antes de que el catalogo salga de la API, asi el
     * cliente recibe un producto normal y no tiene que saber de tiers.
     */
    pricesByTier?: Record<string, Partial<AddonProduct["prices"]>>;
    basePriceUSDByTier?: Record<string, number>;
    /**
     * Add-on que NO se cobra por el checkout del marketplace.
     *
     * El checkout abre una transaccion NUEVA, y `applyAddonCapacity` FIJA la
     * capacidad desde los items de la suscripcion. Un slot comprado asi vivria
     * en una segunda suscripcion, y la proxima actualizacion de la principal
     * pondria la capacidad en cero. Estos add-ons se muestran para que se
     * encuentren, pero se contratan en `fulfillmentHref`, que modifica la
     * suscripcion existente.
     */
    fulfilledBy?: "capacity";
    fulfillmentHref?: string;
    unit?: string;
    extraQuantity?: number;
    requiredTierFallback: "Business" | "Enterprise";
    prices: {
        monthly?: string;
        annual?: string;
        pass1m?: string;
        pass3m?: string;
        pass6m?: string;
        pass9m?: string;
        pass12m?: string;
    };
    basePriceUSD: {
        monthly: number;
        pass1m: number;
        pass3m: number;
        pass6m: number;
        pass9m: number;
        pass12m: number;
    };
    currency?: string;
}

export const ADDON_CATALOG: Record<string, AddonProduct> = {
    feature_simulator: {
        key: "feature_simulator",
        name: "Simulador de Compromisos RIs & Savings Plans",
        description: "Análisis financiero y simulación interactiva de reservas con curvas de retorno y mix óptimo.",
        category: "feature",
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_SIMULATOR_MONTHLY || "pri_01m2ata0r9xcs9nm3nn507qwy6",
            annual: process.env.PADDLE_PRICE_SIMULATOR_YEARLY || "pri_01m2axd4ghvawmscjctc1zzm4t",
            pass1m: process.env.PADDLE_PRICE_SIMULATOR_1M || "pri_01m2atbnp44dfe2ywwdfhz6ft9",
            pass3m: process.env.PADDLE_PRICE_SIMULATOR_3M || "pri_01m2atcvcvyqz7scfyx2bfkt5t",
            pass6m: process.env.PADDLE_PRICE_SIMULATOR_6M || "pri_01m2ate980cjw3mk8mxwv3c08p",
            pass9m: process.env.PADDLE_PRICE_SIMULATOR_9M || "pri_01m2ath34mttrpt0kv0r4htcpt",
            pass12m: process.env.PADDLE_PRICE_SIMULATOR_YEARLY || "pri_01m2axd4ghvawmscjctc1zzm4t",
        },
        basePriceUSD: {
            monthly: 49.0,
            pass1m: 49.0,
            pass3m: 129.0,
            pass6m: 239.0,
            pass9m: 329.0,
            pass12m: 419.0,
        },
    },
    quota_subscriptions: {
        key: "quota_subscriptions",
        name: "Suscripción Azure Adicional",
        description: "Habilita la conexión y monitoreo de 1 suscripción Azure adicional en el tenant.",
        category: "quota",
        unit: "subscription",
        extraQuantity: 1,
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_SUB_MONTHLY || "pri_01m2awxm14zn67wsn7cpsntb3x",
            annual: process.env.PADDLE_PRICE_SUB_YEARLY || "pri_01m2ax9tt31a7dz21a76vfep8v",
            pass1m: process.env.PADDLE_PRICE_SUB_1M || "pri_01m2awz02whzsrv3pzh465wsrp",
            pass3m: process.env.PADDLE_PRICE_SUB_3M || "pri_01m2awzj8fqxy7hzeqan27bhz4",
            pass6m: process.env.PADDLE_PRICE_SUB_6M || "pri_01m2ax0gb18yvyxf2v40hd3cq8",
            pass9m: process.env.PADDLE_PRICE_SUB_9M || "pri_01m2ax13wsey9cjqv1wbteg4zr",
            pass12m: process.env.PADDLE_PRICE_SUB_YEARLY || "pri_01m2ax9tt31a7dz21a76vfep8v",
        },
        basePriceUSD: {
            monthly: 40.0,
            pass1m: 40.0,
            pass3m: 106.0,
            pass6m: 194.0,
            pass9m: 270.0,
            pass12m: 341.0,
        },
    },
    quota_user_seats: {
        key: "quota_user_seats",
        name: "Asientos de Usuario Extra (+5)",
        description: "Permite invitar hasta 5 usuarios colaboradores adicionales a la plataforma.",
        category: "quota",
        unit: "seats",
        extraQuantity: 5,
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_USER_MONTHLY || "pri_01m2avayrd1gp8vadmspvfdphg",
            annual: process.env.PADDLE_PRICE_USER_YEARLY || "pri_01m2axg8tswehbf5rc7qxtykq8",
            pass1m: process.env.PADDLE_PRICE_USER_1M || "pri_01m2avcv38382jjb1bjecb8jnx",
            pass3m: process.env.PADDLE_PRICE_USER_3M || "pri_01m2avegfv7m7t9xj6m1tj60rq",
            pass6m: process.env.PADDLE_PRICE_USER_6M || "pri_01m2avfwq87xfqvsnz6n32awwd",
            pass9m: process.env.PADDLE_PRICE_USER_9M || "pri_01m2avhcbwdfsg4ebs7041sn7v",
            pass12m: process.env.PADDLE_PRICE_USER_YEARLY || "pri_01m2axg8tswehbf5rc7qxtykq8",
        },
        basePriceUSD: {
            monthly: 35.0,
            pass1m: 35.0,
            pass3m: 92.0,
            pass6m: 170.0,
            pass9m: 236.0,
            pass12m: 298.0,
        },
    },
    feature_zombies_deep: {
        key: "feature_zombies_deep",
        name: "Auditoría Avanzada de Zombies & Redes",
        description: "Detección profunda de IP públicas huérfanas, balanceadores sin backend y snapshots desconectados.",
        category: "feature",
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_ZOMBIES_MONTHLY || "pri_01m2atr0kgb2fpxn7hp7mvwcvx",
            annual: process.env.PADDLE_PRICE_ZOMBIES_YEARLY || "pri_01m2axjhzt9q4k4n18axch2yb6",
            pass1m: process.env.PADDLE_PRICE_ZOMBIES_1M || "pri_01m2atsy1tq86p69tg81qvft0b",
            pass3m: process.env.PADDLE_PRICE_ZOMBIES_3M || "pri_01m2av0g6q9dv9ryfhjkvt882n",
            pass6m: process.env.PADDLE_PRICE_ZOMBIES_6M || "pri_01m2av2yebwkft6vgkp4fqd3b0",
            pass9m: process.env.PADDLE_PRICE_ZOMBIES_9M || "pri_01m2av4sptvd9kpczkrtq49kak",
            pass12m: process.env.PADDLE_PRICE_ZOMBIES_YEARLY || "pri_01m2axjhzt9q4k4n18axch2yb6",
        },
        basePriceUSD: {
            monthly: 59.0,
            pass1m: 59.0,
            pass3m: 156.0,
            pass6m: 287.0,
            pass9m: 399.0,
            pass12m: 499.0,
        },
    },
    feature_pdf_reports: {
        key: "feature_pdf_reports",
        name: "Informes Ejecutivos en PDF",
        description: "Exportación y distribución de informes ejecutivos mensuales en PDF de alta resolución.",
        category: "feature",
        requiredTierFallback: "Enterprise",
        prices: {
            monthly: process.env.PADDLE_PRICE_REPORTS_MONTHLY || "pri_01m2awew9ejpk1crpb3dth5ya1",
            annual: process.env.PADDLE_PRICE_REPORTS_YEARLY || "pri_01m2ay04pbfgkc3hx662dnm6zp",
            pass1m: process.env.PADDLE_PRICE_REPORTS_1M || "pri_01m2awg6yd3xykn1m7ts6mkm31",
            pass3m: process.env.PADDLE_PRICE_REPORTS_3M || "pri_01m2awkcv9e14ea6b6xxdwq23z",
            pass6m: process.env.PADDLE_PRICE_REPORTS_6M || "pri_01m2awm4ajbye5a19pzpe5mcmv",
            pass9m: process.env.PADDLE_PRICE_REPORTS_9M || "pri_01m2awn2kgf1k8ger81z36m1bf",
            pass12m: process.env.PADDLE_PRICE_REPORTS_YEARLY || "pri_01m2ay04pbfgkc3hx662dnm6zp",
        },
        basePriceUSD: {
            monthly: 39.0,
            pass1m: 39.0,
            pass3m: 105.0,
            pass6m: 190.0,
            pass9m: 263.0,
            pass12m: 332.0,
        },
    },
    quota_tenant: {
        key: "quota_tenant",
        name: "Tenant Adicional",
        description: "Suma otro tenant de Azure a tu contrato, con tu misma cuenta y tus accesos actuales. Hereda los limites de tu plan: usuarios y suscripciones incluidas.",
        category: "quota",
        unit: "tenant",
        extraQuantity: 1,
        requiredTierFallback: "Business",
        // Se contrata en el panel de capacidad, no por el checkout. Ver el
        // comentario de `fulfilledBy`.
        fulfilledBy: "capacity",
        fulfillmentHref: "/admin/account?tab=billing",
        prices: {},
        pricesByTier: {
            Professional: { monthly: process.env.PADDLE_ADDON_TENANT_PRICE_ID_PROFESSIONAL || "" },
            Business: { monthly: process.env.PADDLE_ADDON_TENANT_PRICE_ID_BUSINESS || "" },
        },
        // El precio sale de ADDON_PRICE_USD y no de una copia: es ~30% del plan
        // base y ese criterio ya esta escrito y justificado en pricing.ts.
        basePriceUSDByTier: {
            Professional: ADDON_PRICE_USD.extraTenant.Professional ?? 0,
            Business: ADDON_PRICE_USD.extraTenant.Business ?? 0,
        },
        basePriceUSD: { monthly: 0, pass1m: 0, pass3m: 0, pass6m: 0, pass9m: 0, pass12m: 0 },
    },
    mod_resources: {
        key: "mod_resources",
        name: "Inventario de Recursos",
        description: "Inventario completo de recursos Azure del tenant con filtros, exportación y detalle por recurso.",
        category: "feature",
        route: "/overview/resources",
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_RESOURCES_MONTHLY || "pri_01m2bs9qc19ew9d59bgm195z3b",
            pass1m: process.env.PADDLE_PRICE_RESOURCES_1M || "pri_01m2bsawm281xyc0y203jv7ajb",
            pass3m: process.env.PADDLE_PRICE_RESOURCES_3M || "pri_01m2bsbqj8pgmmahbvcyf6a0yj",
            pass6m: process.env.PADDLE_PRICE_RESOURCES_6M || "pri_01m2bscnvc7vhhda9377xhd9pj",
            pass9m: process.env.PADDLE_PRICE_RESOURCES_9M || "pri_01m2bsdwnktb4evzq0ep9a0ds1",
            annual: process.env.PADDLE_PRICE_RESOURCES_YEARLY || "pri_01m2bsf8qt91w2v97d6n8a7fqr",
            pass12m: process.env.PADDLE_PRICE_RESOURCES_YEARLY || "pri_01m2bsf8qt91w2v97d6n8a7fqr",
        },
        basePriceUSD: {
            monthly: 79.0,
            pass1m: 79.0,
            pass3m: 209.0,
            pass6m: 384.0,
            pass9m: 533.0,
            pass12m: 673.0,
        },
    },
    mod_databases: {
        key: "mod_databases",
        name: "Bases de Datos",
        description: "Análisis de costo y eficiencia de SQL DB, Cosmos DB, MySQL y PostgreSQL, con rightsizing por motor.",
        category: "feature",
        route: "/intelligence/bases-de-datos",
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_DATABASES_MONTHLY || "pri_01m2bsrynwzd8c8c8mn5sqwtn8",
            pass1m: process.env.PADDLE_PRICE_DATABASES_1M || "pri_01m2bssrq9w85evb515q4d813k",
            pass3m: process.env.PADDLE_PRICE_DATABASES_3M || "pri_01m2bstc4q79pf2npfjm4c2f6h",
            pass6m: process.env.PADDLE_PRICE_DATABASES_6M || "pri_01m2bsv7s0j0yzynrnbjp1vz7c",
            pass9m: process.env.PADDLE_PRICE_DATABASES_9M || "pri_01m2bsw00vy6qmygpqbfcy8tjc",
            annual: process.env.PADDLE_PRICE_DATABASES_YEARLY || "pri_01m2bsz8q4m58grm2pyhkyq22m",
            pass12m: process.env.PADDLE_PRICE_DATABASES_YEARLY || "pri_01m2bsz8q4m58grm2pyhkyq22m",
        },
        basePriceUSD: {
            monthly: 129.0,
            pass1m: 129.0,
            pass3m: 341.0,
            pass6m: 627.0,
            pass9m: 871.0,
            pass12m: 1099.0,
        },
    },
    mod_compute: {
        key: "mod_compute",
        name: "Cómputo",
        description: "Eficiencia de VMs, VMSS, App Service, AKS y Container Apps, con rightsizing y detección de ociosos.",
        category: "feature",
        route: "/intelligence/computo",
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_COMPUTE_MONTHLY || "pri_01m2bt32v3vjv35zft7tvw5pt0",
            pass1m: process.env.PADDLE_PRICE_COMPUTE_1M || "pri_01m2bt3r4qb2xjxpdxry3qrc9w",
            pass3m: process.env.PADDLE_PRICE_COMPUTE_3M || "pri_01m2bt4a3j0a2mab22qn2j49rb",
            pass6m: process.env.PADDLE_PRICE_COMPUTE_6M || "pri_01m2bt4w2985p7jqwt5swn4zqf",
            pass9m: process.env.PADDLE_PRICE_COMPUTE_9M || "pri_01m2bt5kxyb85ft24hskmq0rey",
            annual: process.env.PADDLE_PRICE_COMPUTE_YEARLY || "pri_01m2bt6k7pqye0jd8qkze0wf3g",
            pass12m: process.env.PADDLE_PRICE_COMPUTE_YEARLY || "pri_01m2bt6k7pqye0jd8qkze0wf3g",
        },
        basePriceUSD: {
            monthly: 129.0,
            pass1m: 129.0,
            pass3m: 341.0,
            pass6m: 627.0,
            pass9m: 871.0,
            pass12m: 1099.0,
        },
    },
    mod_network: {
        key: "mod_network",
        name: "Redes",
        description: "Costo de tráfico, balanceadores, gateways, DDoS y conectividad híbrida.",
        category: "feature",
        route: "/intelligence/redes",
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_NETWORK_MONTHLY || "pri_01m2bv2n7frdyyp7n2g8nzjmtp",
            pass1m: process.env.PADDLE_PRICE_NETWORK_1M || "pri_01m2bv3b9a6zcgxt6x2qghnz4b",
            pass3m: process.env.PADDLE_PRICE_NETWORK_3M || "pri_01m2bv3wq4q36hznjc9c88pzy4",
            pass6m: process.env.PADDLE_PRICE_NETWORK_6M || "pri_01m2bv4qqvwcrw61kecw6tfbmk",
            pass9m: process.env.PADDLE_PRICE_NETWORK_9M || "pri_01m2bv597pj68nm58jcdec4k2j",
            annual: process.env.PADDLE_PRICE_NETWORK_YEARLY || "pri_01m2bv678sdvk41a8evcsa3kg6",
            pass12m: process.env.PADDLE_PRICE_NETWORK_YEARLY || "pri_01m2bv678sdvk41a8evcsa3kg6",
        },
        basePriceUSD: {
            monthly: 79.0,
            pass1m: 79.0,
            pass3m: 209.0,
            pass6m: 384.0,
            pass9m: 533.0,
            pass12m: 673.0,
        },
    },
    mod_ttl: {
        key: "mod_ttl",
        name: "TTL Expiration",
        description: "Vencimiento programado de recursos temporales, con avisos y remediación.",
        category: "feature",
        route: "/cleanup/ttl",
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_TTL_MONTHLY || "pri_01m2bvb95kc6pngesa2mesez4y",
            pass1m: process.env.PADDLE_PRICE_TTL_1M || "pri_01m2bvbwa60mhqcmcgtz7gbk93",
            pass3m: process.env.PADDLE_PRICE_TTL_3M || "pri_01m2bvw6v3ew0y6q3bzm6e5pfh",
            pass6m: process.env.PADDLE_PRICE_TTL_6M || "pri_01m2bvwsarqr00ec0v6pyeeana",
            pass9m: process.env.PADDLE_PRICE_TTL_9M || "pri_01m2bvxdbgj7cvxa7eev0bgc40",
            annual: process.env.PADDLE_PRICE_TTL_YEARLY || "pri_01m2bvy5m43521e81rhrem9hrp",
            pass12m: process.env.PADDLE_PRICE_TTL_YEARLY || "pri_01m2bvy5m43521e81rhrem9hrp",
        },
        basePriceUSD: {
            monthly: 59.0,
            pass1m: 59.0,
            pass3m: 159.0,
            pass6m: 287.0,
            pass9m: 399.0,
            pass12m: 499.0,
        },
    },
    mod_power: {
        key: "mod_power",
        name: "Power Schedules",
        description: "Encendido y apagado programado de recursos por calendario, con ahorro estimado.",
        category: "feature",
        route: "/governance/power",
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_POWER_MONTHLY || "pri_01m2bwcahr92szjnavz2nwke3q",
            pass1m: process.env.PADDLE_PRICE_POWER_1M || "pri_01m2bwd43xscz4zpaw312vaw6q",
            pass3m: process.env.PADDLE_PRICE_POWER_3M || "pri_01m2bwdtgsax02dg2e3rrhy20a",
            pass6m: process.env.PADDLE_PRICE_POWER_6M || "pri_01m2bwecx3ht9m1g5aywpcg7ef",
            pass9m: process.env.PADDLE_PRICE_POWER_9M || "pri_01m2bweyfgaw4k6gf7gry4rdn2",
            annual: process.env.PADDLE_PRICE_POWER_YEARLY || "pri_01m2bwfkha5cjw5t14mcnzazr2",
            pass12m: process.env.PADDLE_PRICE_POWER_YEARLY || "pri_01m2bwfkha5cjw5t14mcnzazr2",
        },
        basePriceUSD: {
            monthly: 59.0,
            pass1m: 59.0,
            pass3m: 159.0,
            pass6m: 287.0,
            pass9m: 399.0,
            pass12m: 499.0,
        },
    },
    mod_ha: {
        key: "mod_ha",
        name: "Alta Disponibilidad",
        description: "Recomendaciones de redundancia, zonas y recuperación por servicio.",
        category: "feature",
        route: "/governance/ha",
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_HA_MONTHLY || "pri_01m2bwm362k8rxb91gampmwaf6",
            pass1m: process.env.PADDLE_PRICE_HA_1M || "pri_01m2bwmv2eveqkzw69tk3qq139",
            pass3m: process.env.PADDLE_PRICE_HA_3M || "pri_01m2bwng91wyz665pjgfqabyfc",
            pass6m: process.env.PADDLE_PRICE_HA_6M || "pri_01m2bwnz7t00ya7qrd4xa3tty3",
            pass9m: process.env.PADDLE_PRICE_HA_9M || "pri_01m2bwpfracecxskfg76mejq5b",
            annual: process.env.PADDLE_PRICE_HA_YEARLY || "pri_01m2bwq90e8wz5exb814tz7gts",
            pass12m: process.env.PADDLE_PRICE_HA_YEARLY || "pri_01m2bwq90e8wz5exb814tz7gts",
        },
        basePriceUSD: {
            monthly: 59.0,
            pass1m: 59.0,
            pass3m: 159.0,
            pass6m: 287.0,
            pass9m: 399.0,
            pass12m: 499.0,
        },
    },
    mod_credentials: {
        key: "mod_credentials",
        name: "Credenciales Expiradas",
        description: "Secretos, certificados y service principals proximos a vencer, con aviso anticipado por servicio.",
        category: "feature",
        route: "/governance/credentials",
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_CREDENTIALS_MONTHLY || "pri_01m2byx24k9xmvw3rr2da368bq",
            pass1m: process.env.PADDLE_PRICE_CREDENTIALS_1M || "pri_01m2byxnc4s1xs2h5y9d5z5n7t",
            pass3m: process.env.PADDLE_PRICE_CREDENTIALS_3M || "pri_01m2byy4m9zd3gbc85kkdcw2m7",
            pass6m: process.env.PADDLE_PRICE_CREDENTIALS_6M || "pri_01m2byyp410an3fy151n7ver1x",
            pass9m: process.env.PADDLE_PRICE_CREDENTIALS_9M || "pri_01m2byz7ncmt3q2kjsjepc04hx",
            annual: process.env.PADDLE_PRICE_CREDENTIALS_YEARLY || "pri_01m2byzxt0rdhgfvcdc1wrhvwp",
            pass12m: process.env.PADDLE_PRICE_CREDENTIALS_YEARLY || "pri_01m2byzxt0rdhgfvcdc1wrhvwp",
        },
        basePriceUSD: {
            monthly: 79.0,
            pass1m: 79.0,
            pass3m: 209.0,
            pass6m: 384.0,
            pass9m: 533.0,
            pass12m: 673.0,
        },
    },
    mod_approvals: {
        key: "mod_approvals",
        name: "Aprobaciones",
        description: "Circuito de aprobación para acciones de remediación y cambios de capacidad.",
        category: "feature",
        route: "/governance/approvals",
        requiredTierFallback: "Business",
        prices: {
            monthly: process.env.PADDLE_PRICE_APPROVALS_MONTHLY || "pri_01m2bx0234yh13m7ghz440m42h",
            pass1m: process.env.PADDLE_PRICE_APPROVALS_1M || "pri_01m2bx0qck166h5yjfj0h958ta",
            pass3m: process.env.PADDLE_PRICE_APPROVALS_3M || "pri_01m2bx1648ra0rnf9yac70680z",
            pass6m: process.env.PADDLE_PRICE_APPROVALS_6M || "pri_01m2bx1nyh0n31txfw9xwb1z2c",
            pass9m: process.env.PADDLE_PRICE_APPROVALS_9M || "pri_01m2bx29bmc02tqcyazvqx0xvc",
            annual: process.env.PADDLE_PRICE_APPROVALS_YEARLY || "pri_01m2bx33k5v17bksxmav0xz1jt",
            pass12m: process.env.PADDLE_PRICE_APPROVALS_YEARLY || "pri_01m2bx33k5v17bksxmav0xz1jt",
        },
        basePriceUSD: {
            monthly: 39.0,
            pass1m: 39.0,
            pass3m: 103.0,
            pass6m: 189.0,
            pass9m: 263.0,
            pass12m: 329.0,
        },
    },
    mod_optimization: {
        key: "mod_optimization",
        name: "Optimización y Ahorro",
        description: "Hub de oportunidades de ahorro consolidadas con priorización por impacto.",
        category: "feature",
        route: "/intelligence/optimizacion-y-ahorro",
        requiredTierFallback: "Enterprise",
        prices: {
            monthly: process.env.PADDLE_PRICE_OPTIMIZATION_MONTHLY || "pri_01m2bx7tpnzny0y9h123v2p7vy",
            pass1m: process.env.PADDLE_PRICE_OPTIMIZATION_1M || "pri_01m2bx95557wfakrxeheej24b3",
            pass3m: process.env.PADDLE_PRICE_OPTIMIZATION_3M || "pri_01m2bx9n0rawatp232e8h68vd2",
            pass6m: process.env.PADDLE_PRICE_OPTIMIZATION_6M || "pri_01m2bxa8nagc14je6ry3st5yd2",
            pass9m: process.env.PADDLE_PRICE_OPTIMIZATION_9M || "pri_01m2bxas22d7d0cr22gnx3dqv7",
            annual: process.env.PADDLE_PRICE_OPTIMIZATION_YEARLY || "pri_01m2bxbgcws0ya9gcyazeqs9vt",
            pass12m: process.env.PADDLE_PRICE_OPTIMIZATION_YEARLY || "pri_01m2bxbgcws0ya9gcyazeqs9vt",
        },
        basePriceUSD: {
            monthly: 129.0,
            pass1m: 129.0,
            pass3m: 341.0,
            pass6m: 627.0,
            pass9m: 871.0,
            pass12m: 1099.0,
        },
    },
    mod_storage: {
        key: "mod_storage",
        name: "Almacenamiento",
        description: "Costo por cuenta, tier y redundancia, con detección de datos fríos y huérfanos.",
        category: "feature",
        route: "/intelligence/almacenamiento",
        requiredTierFallback: "Enterprise",
        prices: {
            monthly: process.env.PADDLE_PRICE_STORAGE_MONTHLY || "pri_01m2bxfcqzyprxmmgwv5wzwv1s",
            pass1m: process.env.PADDLE_PRICE_STORAGE_1M || "pri_01m2bxg5bc7q5w6z5tww1rkqxe",
            pass3m: process.env.PADDLE_PRICE_STORAGE_3M || "pri_01m2bxghchza6v4mj3qmxk127n",
            pass6m: process.env.PADDLE_PRICE_STORAGE_6M || "pri_01m2bxh0v8r1bxxq8nnmcm2j1n",
            pass9m: process.env.PADDLE_PRICE_STORAGE_9M || "pri_01m2bxhgy6avem3d7nagr05gc4",
            annual: process.env.PADDLE_PRICE_STORAGE_YEARLY || "pri_01m2bxj9tb0gz898mctgxa0ydn",
            pass12m: process.env.PADDLE_PRICE_STORAGE_YEARLY || "pri_01m2bxj9tb0gz898mctgxa0ydn",
        },
        basePriceUSD: {
            monthly: 129.0,
            pass1m: 129.0,
            pass3m: 341.0,
            pass6m: 627.0,
            pass9m: 871.0,
            pass12m: 1099.0,
        },
    },
    mod_licenses: {
        key: "mod_licenses",
        name: "Usuarios y Licencias",
        description: "Licenciamiento de Microsoft 365 y Entra ID, asignaciones sin uso y costo por usuario.",
        category: "feature",
        route: "/intelligence/licenses",
        requiredTierFallback: "Enterprise",
        prices: {
            monthly: process.env.PADDLE_PRICE_LICENSES_MONTHLY || "pri_01m2bxrgmhhwtzsgabq7aa9zm9",
            pass1m: process.env.PADDLE_PRICE_LICENSES_1M || "pri_01m2bxs6kk4z62k0jtxvg9jhsq",
            pass3m: process.env.PADDLE_PRICE_LICENSES_3M || "pri_01m2bxsxwzdk1hbkf88zh3hs8s",
            pass6m: process.env.PADDLE_PRICE_LICENSES_6M || "pri_01m2bxtbmhp4s3mtrv4bjgd4jd",
            pass9m: process.env.PADDLE_PRICE_LICENSES_9M || "pri_01m2bxtww2p5z42zg5x2g10ck8",
            annual: process.env.PADDLE_PRICE_LICENSES_YEARLY || "pri_01m2bxvkehrhkma08frpawan4v",
            pass12m: process.env.PADDLE_PRICE_LICENSES_YEARLY || "pri_01m2bxvkehrhkma08frpawan4v",
        },
        basePriceUSD: {
            monthly: 129.0,
            pass1m: 129.0,
            pass3m: 341.0,
            pass6m: 627.0,
            pass9m: 871.0,
            pass12m: 1099.0,
        },
    },
    mod_azure_ai: {
        key: "mod_azure_ai",
        name: "Azure AI",
        description: "Consumo y costo de Azure OpenAI, Cognitive Services y Azure AI Search, con PTU y tokens.",
        category: "feature",
        route: "/intelligence/azure-ai",
        requiredTierFallback: "Enterprise",
        prices: {
            monthly: process.env.PADDLE_PRICE_AZUREAI_MONTHLY || "pri_01m2bxx19dgj024w1s2d7n9qrz",
            pass1m: process.env.PADDLE_PRICE_AZUREAI_1M || "pri_01m2bxxhapwjkz3xq8aenzkq28",
            pass3m: process.env.PADDLE_PRICE_AZUREAI_3M || "pri_01m2bxy089dq31rhxgp5c8f5sf",
            pass6m: process.env.PADDLE_PRICE_AZUREAI_6M || "pri_01m2bxyfgvffd068f48zx3apcy",
            pass9m: process.env.PADDLE_PRICE_AZUREAI_9M || "pri_01m2bxyz9s729ymf9s5qhmsycx",
            annual: process.env.PADDLE_PRICE_AZUREAI_YEARLY || "pri_01m2bxzj81fp1c2b9tjpygmpn9",
            pass12m: process.env.PADDLE_PRICE_AZUREAI_YEARLY || "pri_01m2bxzj81fp1c2b9tjpygmpn9",
        },
        basePriceUSD: {
            monthly: 129.0,
            pass1m: 129.0,
            pass3m: 341.0,
            pass6m: 627.0,
            pass9m: 871.0,
            pass12m: 1099.0,
        },
    },
    mod_integration: {
        key: "mod_integration",
        name: "Azure Integration Services",
        description: "Costo de Logic Apps, Service Bus, Event Grid, API Management y Data Factory.",
        category: "feature",
        route: "/intelligence/integration-services",
        requiredTierFallback: "Enterprise",
        prices: {
            monthly: process.env.PADDLE_PRICE_INTEGRATION_MONTHLY || "pri_01m2bztxw50haynfejjndv0gm1",
            pass1m: process.env.PADDLE_PRICE_INTEGRATION_1M || "pri_01m2bzvc8asn68rnsstmzjarep",
            pass3m: process.env.PADDLE_PRICE_INTEGRATION_3M || "pri_01m2bzvvkjs6bp90bf8em367mz",
            pass6m: process.env.PADDLE_PRICE_INTEGRATION_6M || "pri_01m2bzxynj9yp00vfw3eekangr",
            pass9m: process.env.PADDLE_PRICE_INTEGRATION_9M || "pri_01m2bzygd0t9a7dhxz3dhr46b3",
            annual: process.env.PADDLE_PRICE_INTEGRATION_YEARLY || "pri_01m2bzz3k7y0jbskse3av6ce30",
            pass12m: process.env.PADDLE_PRICE_INTEGRATION_YEARLY || "pri_01m2bzz3k7y0jbskse3av6ce30",
        },
        basePriceUSD: {
            monthly: 129.0,
            pass1m: 129.0,
            pass3m: 341.0,
            pass6m: 627.0,
            pass9m: 871.0,
            pass12m: 1099.0,
        },
    },
    mod_monitoring: {
        key: "mod_monitoring",
        name: "Monitoreo",
        description: "Costo de Log Analytics, Application Insights y retención, con ingesta por tabla.",
        category: "feature",
        route: "/intelligence/monitoreo",
        requiredTierFallback: "Enterprise",
        prices: {
            monthly: process.env.PADDLE_PRICE_MONITORING_MONTHLY || "pri_01m2c5cxf2a1a7es6358bgb2se",
            pass1m: process.env.PADDLE_PRICE_MONITORING_1M || "pri_01m2c5dea2heebhshd1btk2r4x",
            pass3m: process.env.PADDLE_PRICE_MONITORING_3M || "pri_01m2c5dw3p5jjadkpkv7gh79ms",
            pass6m: process.env.PADDLE_PRICE_MONITORING_6M || "pri_01m2c5eatbahtfbebb2ds6vr52",
            pass9m: process.env.PADDLE_PRICE_MONITORING_9M || "pri_01m2c5esgsyhxwn6c93dzt97ar",
            annual: process.env.PADDLE_PRICE_MONITORING_YEARLY || "pri_01m2c5fd62vvjvwefkcp86xfvq",
            pass12m: process.env.PADDLE_PRICE_MONITORING_YEARLY || "pri_01m2c5fd62vvjvwefkcp86xfvq",
        },
        basePriceUSD: {
            monthly: 129.0,
            pass1m: 129.0,
            pass3m: 341.0,
            pass6m: 627.0,
            pass9m: 871.0,
            pass12m: 1099.0,
        },
    },
    mod_security: {
        key: "mod_security",
        name: "Seguridad",
        description: "Costo y cobertura de Defender for Cloud, Key Vault y postura de seguridad.",
        category: "feature",
        route: "/intelligence/seguridad",
        requiredTierFallback: "Enterprise",
        prices: {
            monthly: process.env.PADDLE_PRICE_SECURITY_MONTHLY || "pri_01m2c10x2htb10wbbsxjmas57z",
            pass1m: process.env.PADDLE_PRICE_SECURITY_1M || "pri_01m2c11ad4jnc9sf8d0h1k15p7",
            pass3m: process.env.PADDLE_PRICE_SECURITY_3M || "pri_01m2c11vk6nd5r5hfh3z2pp4z4",
            pass6m: process.env.PADDLE_PRICE_SECURITY_6M || "pri_01m2c12bq9dzb7t9f769h1me0a",
            pass9m: process.env.PADDLE_PRICE_SECURITY_9M || "pri_01m2c12wvj0053q1e1w5xn1vkc",
            annual: process.env.PADDLE_PRICE_SECURITY_YEARLY || "pri_01m2c13cv9g0srf9bv1v6dffbg",
            pass12m: process.env.PADDLE_PRICE_SECURITY_YEARLY || "pri_01m2c13cv9g0srf9bv1v6dffbg",
        },
        basePriceUSD: {
            monthly: 129.0,
            pass1m: 129.0,
            pass3m: 341.0,
            pass6m: 627.0,
            pass9m: 871.0,
            pass12m: 1099.0,
        },
    },
    mod_analytics: {
        key: "mod_analytics",
        name: "Analítica Avanzada",
        description: "Synapse, Databricks, Fabric y Data Explorer: costo por workspace y capacidad.",
        category: "feature",
        route: "/intelligence/analitica-avanzada",
        requiredTierFallback: "Enterprise",
        prices: {
            monthly: process.env.PADDLE_PRICE_ANALYTICS_MONTHLY || "pri_01m2c46kcmbs5ajb1es7nak7f2",
            pass1m: process.env.PADDLE_PRICE_ANALYTICS_1M || "pri_01m2c47903jppgfvbn0y123mv8",
            pass3m: process.env.PADDLE_PRICE_ANALYTICS_3M || "pri_01m2c47s5q0dzmehz024g44b8f",
            pass6m: process.env.PADDLE_PRICE_ANALYTICS_6M || "pri_01m2c48c0ks9q50cnypjje5f2e",
            pass9m: process.env.PADDLE_PRICE_ANALYTICS_9M || "pri_01m2c48xsqwgfn61c3jz4k02wy",
            annual: process.env.PADDLE_PRICE_ANALYTICS_YEARLY || "pri_01m2c49fzazznxxg7dkbw7v04t",
            pass12m: process.env.PADDLE_PRICE_ANALYTICS_YEARLY || "pri_01m2c49fzazznxxg7dkbw7v04t",
        },
        basePriceUSD: {
            monthly: 129.0,
            pass1m: 129.0,
            pass3m: 341.0,
            pass6m: 627.0,
            pass9m: 871.0,
            pass12m: 1099.0,
        },
    },
    mod_policies: {
        key: "mod_policies",
        name: "Policies y Autoblock",
        description: "Políticas de gobierno con bloqueo automático de recursos fuera de norma.",
        category: "feature",
        route: "/governance/policies",
        requiredTierFallback: "Enterprise",
        prices: {
            monthly: process.env.PADDLE_PRICE_POLICIES_MONTHLY || "pri_01m2c4csgna3mzvwe8qtg40sbf",
            pass1m: process.env.PADDLE_PRICE_POLICIES_1M || "pri_01m2c4d8995pv3hdj0g24bqj0m",
            pass3m: process.env.PADDLE_PRICE_POLICIES_3M || "pri_01m2c4dn7t3gja6rj0c3tagz3m",
            pass6m: process.env.PADDLE_PRICE_POLICIES_6M || "pri_01m2c4e7x8w38782p5cnmhy360",
            pass9m: process.env.PADDLE_PRICE_POLICIES_9M || "pri_01m2c4eq94xqrq79e5jke413j6",
            annual: process.env.PADDLE_PRICE_POLICIES_YEARLY || "pri_01m2c4fagvsdfj0mdgjadzj3m0",
            pass12m: process.env.PADDLE_PRICE_POLICIES_YEARLY || "pri_01m2c4fagvsdfj0mdgjadzj3m0",
        },
        basePriceUSD: {
            monthly: 129.0,
            pass1m: 129.0,
            pass3m: 341.0,
            pass6m: 627.0,
            pass9m: 871.0,
            pass12m: 1099.0,
        },
    },
    mod_gov_reporting: {
        key: "mod_gov_reporting",
        name: "Governance Reporting",
        description: "Reportes de cumplimiento, tagging y desvíos de gobierno, exportables.",
        category: "feature",
        route: "/governance/reporting",
        requiredTierFallback: "Enterprise",
        prices: {
            monthly: process.env.PADDLE_PRICE_GOVREPORTING_MONTHLY || "pri_01m2c4j2kpkxbeh3fxzytppved",
            pass1m: process.env.PADDLE_PRICE_GOVREPORTING_1M || "pri_01m2c4jmfdwtp77386xwsn4pp7",
            pass3m: process.env.PADDLE_PRICE_GOVREPORTING_3M || "pri_01m2c4k3sarmva9wkag3gbg182",
            pass6m: process.env.PADDLE_PRICE_GOVREPORTING_6M || "pri_01m2c4kjq9324r6zp05k9mfqdp",
            pass9m: process.env.PADDLE_PRICE_GOVREPORTING_9M || "pri_01m2c4m7z6x50f7ts4cmgkae04",
            annual: process.env.PADDLE_PRICE_GOVREPORTING_YEARLY || "pri_01m2c4mv658g1a40cm1kdqw8kd",
            pass12m: process.env.PADDLE_PRICE_GOVREPORTING_YEARLY || "pri_01m2c4mv658g1a40cm1kdqw8kd",
        },
        basePriceUSD: {
            monthly: 129.0,
            pass1m: 129.0,
            pass3m: 341.0,
            pass6m: 627.0,
            pass9m: 871.0,
            pass12m: 1099.0,
        },
    },
};

/**
 * Que add-ons ve un tier en el marketplace.
 *
 *  - FEATURE que el plan ya incluye: no se muestra. Ofrecerle "Azure AI" a
 *    quien ya lo tiene es ruido, y peor, sugiere que no lo tiene.
 *  - QUOTA en Enterprise: no se muestra. Sus limites son Infinity, asi que
 *    comprar capacidad no hace nada.
 *  - Sin price ID mensual: no se muestra en ningun tier. Un modulo cuyo
 *    producto todavia no existe en Paddle no puede tener boton de compra: el
 *    checkout saldria contra un price id vacio. Asi los modulos aparecen solos
 *    a medida que se cargan las variables, sin un deploy por modulo.
 */
export function isAddonVisibleForTier(item: AddonProduct, tier: string): boolean {
    if (!item.prices.monthly) return false;
    if (item.category === "quota") return tier !== "Enterprise";
    return !hasAccess(tier, item.requiredTierFallback);
}

/**
 * Aplica al add-on los valores que dependen del tier del comprador. Se llama
 * ANTES de filtrar por visibilidad: `isAddonVisibleForTier` exige un price ID
 * mensual, y para estos add-ons ese ID recien existe una vez resuelto.
 */
export function resolveAddonForTier(item: AddonProduct, tier: string): AddonProduct {
    if (!item.pricesByTier && !item.basePriceUSDByTier) return item;
    const precio = item.basePriceUSDByTier?.[tier];
    return {
        ...item,
        prices: { ...item.prices, ...(item.pricesByTier?.[tier] ?? {}) },
        basePriceUSD:
            precio === undefined
                ? item.basePriceUSD
                : { monthly: precio, pass1m: precio, pass3m: precio, pass6m: precio, pass9m: precio, pass12m: precio },
    };
}

/**
 * Si algun add-on activo habilita esta ruta.
 *
 * Tener el modulo es tener TODOS sus componentes, asi que la comparacion es por
 * PREFIJO: `mod_databases` (/intelligence/bases-de-datos) habilita tambien
 * /intelligence/bases-de-datos/cosmos-db y cualquier sub-ruta que se agregue
 * despues, sin tener que enumerarlas.
 *
 * El prefijo se compara por segmento completo: /governance/policies no habilita
 * /governance/policies-draft.
 */
export function addonUnlocksPath(activeAddonKeys: string[], path: string): boolean {
    const limpio = (stripLocale(path).split("?")[0].replace(/\/+$/, "") || "/");
    return activeAddonKeys.some((key) => {
        const route = ADDON_CATALOG[key]?.route;
        if (!route) return false;
        return limpio === route || limpio.startsWith(route + "/");
    });
}
