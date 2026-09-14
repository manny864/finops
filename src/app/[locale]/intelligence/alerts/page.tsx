import { redirect } from "next/navigation";

// Movida a /governance/alerts: el módulo de alertas self-service pertenece a Gobernanza.
// Se conserva este redirect para no romper links, bookmarks o emails existentes.
export default async function LegacyIntelligenceAlertsPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  redirect(`/${locale}/governance/alerts`);
}
