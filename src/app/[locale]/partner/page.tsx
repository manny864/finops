import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import PageClient from "./PageClient";

export async function generateMetadata(): Promise<Metadata> {
    const t = await getTranslations("PartnerPanel");
    return {
        title: t("metaTitle"),
        description: t("metaDescription"),
        // El enlace es la credencial: que no lo indexe nadie si alguien lo pega en
        // un lugar público.
        robots: { index: false, follow: false },
    };
}

export default function Page() {
    return <PageClient />;
}
