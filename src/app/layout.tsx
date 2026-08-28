import React from "react";

/**
 * Layout raíz: pasa los children tal cual, a propósito.
 *
 * El <html>/<body> real lo aporta [locale]/layout.tsx, donde vive la metadata,
 * las fuentes y los providers. Este archivo existe sólo porque Next exige un
 * layout en la raíz para poder renderizar src/app/not-found.tsx — sin él, una
 * URL que no matchea ninguna ruta caía en el 404 gris de Next en inglés.
 *
 * Es el patrón que documenta next-intl para proyectos con el <html> dentro del
 * segmento de locale. No agrega markup ni cambia el árbol existente.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
    return children;
}
