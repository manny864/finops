import type {
  MaturityAssessmentQuestion,
  MaturityStage,
} from "@/types/finopsMaturity.types";

export function calculateMaturityStage(score: number): MaturityStage {
  if (score < 40) return "CRAWL";
  if (score <= 75) return "WALK";
  return "RUN";
}

export const MATURITY_QUESTIONS: MaturityAssessmentQuestion[] = [
  {
    id: "q_vis",
    domainKey: "visibility",
    title: "1. Visibilidad e Información de Costos",
    description: "¿Cómo se asigna, reporta y distribuye el gasto en Azure a los equipos de negocio?",
    options: [
      {
        score: 25,
        label: "Gatear (Crawl)",
        description: "Revisión manual de la factura de Azure a fin de mes. Sin dashboards de autoservicio ni presupuestos automatizados.",
      },
      {
        score: 65,
        label: "Caminar (Walk)",
        description: "Presupuestos configurados por suscripción con alertas y exportación diaria de datos de costo a almacenamiento central.",
      },
      {
        score: 95,
        label: "Correr (Run)",
        description: "Showback/chargeback automatizado a centros de costo, telemetría de costo unitario por transacción de negocio en tiempo real.",
      },
    ],
  },
  {
    id: "q_rate",
    domainKey: "rateOpt",
    title: "2. Optimización de Tarifas (Rate)",
    description: "¿Qué estrategia se aplica para compromisos de cómputo y licenciamiento híbrido?",
    options: [
      {
        score: 30,
        label: "Gatear (Crawl)",
        description: "Cómputo 100% bajo demanda (Pay-As-You-Go). Sin análisis de reservas ni activación de Azure Hybrid Benefit.",
      },
      {
        score: 70,
        label: "Caminar (Walk)",
        description: "Cobertura de Reserved Instances (RIs) y Savings Plans superior al 60% en cargas estables y AHUB en VMs principales.",
      },
      {
        score: 95,
        label: "Correr (Run)",
        description: "Gestión algorítmica de compromisos (>85% cobertura), combinación con Azure Spot en pipelines y arbitraje continuo de tarifas.",
      },
    ],
  },
  {
    id: "q_usage",
    domainKey: "usageOpt",
    title: "3. Optimización de Uso (Usage)",
    description: "¿Cómo se gestiona el sobredimensionamiento y los recursos ociosos en la nube?",
    options: [
      {
        score: 25,
        label: "Gatear (Crawl)",
        description: "Se corrigen recursos sobredimensionados solo ante incidentes de presupuesto. VMs 24/7 sin auto-apagado.",
      },
      {
        score: 65,
        label: "Caminar (Walk)",
        description: "Revisión quincenal de recomendaciones de Azure Advisor y políticas de apagado programado en ambientes de desarrollo.",
      },
      {
        score: 90,
        label: "Correr (Run)",
        description: "Auto-scaling elástico en producción, arquitectura serverless orientada a eventos y eliminación automatizada de recursos zombi.",
      },
    ],
  },
  {
    id: "q_gov",
    domainKey: "governance",
    title: "4. Gobernanza y Asignación",
    description: "¿Cuál es el nivel de cumplimiento de etiquetas y políticas de cumplimiento en Azure?",
    options: [
      {
        score: 30,
        label: "Gatear (Crawl)",
        description: "Etiquetado opcional o inconsistente (<40% de recursos con Environment o CostCenter).",
      },
      {
        score: 70,
        label: "Caminar (Walk)",
        description: "Azure Policy exige tags obligatorias en nuevos recursos y cumplimiento >80% en recursos principales.",
      },
      {
        score: 95,
        label: "Correr (Run)",
        description: "Cumplimiento de tags >95% auditado por CI/CD, jerarquía estricta de Management Groups y remediación automática de recursos sin tag.",
      },
    ],
  },
  {
    id: "q_auto",
    domainKey: "automation",
    title: "5. Automatización FinOps",
    description: "¿Qué porcentaje de las acciones de remediación y gestión de ciclo de vida se ejecutan sin intervención manual?",
    options: [
      {
        score: 20,
        label: "Gatear (Crawl)",
        description: "Todas las acciones (apagar VMs, cambiar SKUs, eliminar discos huérfanos) se realizan manualmente desde Azure Portal.",
      },
      {
        score: 60,
        label: "Caminar (Walk)",
        description: "Scripts de PowerShell / Azure CLI y Runbooks programados para tareas comunes de mantenimiento.",
      },
      {
        score: 90,
        label: "Correr (Run)",
        description: "Pipelines de Infraestructura como Código (Terraform/Bicep) con validación de costo en PRs (Infracost) y auto-remediación.",
      },
    ],
  },
  {
    id: "q_culture",
    domainKey: "culture",
    title: "6. Cultura y Organización FinOps",
    description: "¿Existe un equipo multidisciplinario o práctica formal de responsabilidad sobre el costo de la nube?",
    options: [
      {
        score: 30,
        label: "Gatear (Crawl)",
        description: "El costo es responsabilidad exclusiva del departamento de finanzas o infraestructura tradicional.",
      },
      {
        score: 70,
        label: "Caminar (Walk)",
        description: "Ingeniería y Producto tienen visibilidad de su costo asignado y participan en revisiones mensuales de FinOps.",
      },
      {
        score: 95,
        label: "Correr (Run)",
        description: "KPIs de costo unitario integrados en los objetivos de los equipos de ingeniería, equipo de habilitación FinOps centralizado.",
      },
    ],
  },
];
