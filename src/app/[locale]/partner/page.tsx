import PageClient from "./PageClient";

export const metadata = {
    title: "Panel del Partner | CSCloudSolutions",
    description: "Tus referidos y comisiones del Programa de Partners de CSCloudSolutions.",
    // El enlace es la credencial: que no lo indexe nadie si alguien lo pega en
    // un lugar público.
    robots: { index: false, follow: false },
};

export default function Page() {
    return <PageClient />;
}
