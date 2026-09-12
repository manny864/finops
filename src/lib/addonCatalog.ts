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
            annual: process.env.PADDLE_PRICE_SUB_YEARLY || process.env.PADDLE_PRICE_SUB_YEARY || "pri_01m2ax9tt31a7dz21a76vfep8v",
            pass1m: process.env.PADDLE_PRICE_SUB_1M || "pri_01m2awz02whzsrv3pzh465wsrp",
            pass3m: process.env.PADDLE_PRICE_SUB_3M || "pri_01m2awzj8fqxy7hzeqan27bhz4",
            pass6m: process.env.PADDLE_PRICE_SUB_6M || "pri_01m2ax0gb18yvyxf2v40hd3cq8",
            pass9m: process.env.PADDLE_PRICE_SUB_9M || "pri_01m2ax13wsey9cjqv1wbteg4zr",
            pass12m: process.env.PADDLE_PRICE_SUB_YEARLY || process.env.PADDLE_PRICE_SUB_YEARY || "pri_01m2ax9tt31a7dz21a76vfep8v",
        },
        basePriceUSD: {
            monthly: 40.0,
            pass1m: 40.0,
            pass3m: 110.0,
            pass6m: 210.0,
            pass9m: 290.0,
            pass12m: 360.0,
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
            pass3m: 95.0,
            pass6m: 180.0,
            pass9m: 250.0,
            pass12m: 315.0,
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
            pass3m: 159.0,
            pass6m: 299.0,
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
            pass1m: process.env.PADDLE_PRICE_REPORTS_1M || "pri_01m2awew9ejpk1crpb3dth5ya1",
            pass3m: process.env.PADDLE_PRICE_REPORTS_3M || "pri_01m2awkcv9e14ea6b6xxdwq23z",
            pass6m: process.env.PADDLE_PRICE_REPORTS_6M || "pri_01m2awm4ajbye5a19pzpe5mcmv",
            pass9m: process.env.PADDLE_PRICE_REPORTS_9M || "pri_01m2awn2kgf1k8ger81z36m1bf",
            pass12m: process.env.PADDLE_PRICE_REPORTS_YEARLY || "pri_01m2ay04pbfgkc3hx662dnm6zp",
        },
        basePriceUSD: {
            monthly: 39.0,
            pass1m: 39.0,
            pass3m: 105.0,
            pass6m: 195.0,
            pass9m: 270.0,
            pass12m: 339.0,
        },
    },
};
