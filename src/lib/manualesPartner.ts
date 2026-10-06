/**
 * El manual del partner, en los tres idiomas.
 *
 * Lo publica `scripts/generate-manual-pdfs.js` en `public/manual` (docs/ no
 * entra a la imagen: ver .dockerignore) y lo ofrece el panel del partner
 * (`/partner`). `__tests__/unit/manualDelPartner.test.ts` cuida que cada
 * archivo exista, para que un botón no apunte a un 404.
 *
 * Se sirven como archivos estáticos, sin el token del panel: el manual no lleva
 * datos de ningún cliente ni del partner, es el material comercial que se le
 * entrega. Si algún día deja de ser así, hay que pasarlo detrás de
 * `partnerPorToken` como `/api/partner/panel`.
 */
export const MANUALES_DEL_PARTNER = [
    { lang: "es", etiqueta: "Español", archivo: "MANUAL_PARTNER_ES" },
    { lang: "en", etiqueta: "English", archivo: "MANUAL_PARTNER_EN" },
    { lang: "pt-BR", etiqueta: "Português", archivo: "MANUAL_PARTNER_PT-BR" },
] as const;

export type ManualDelPartner = (typeof MANUALES_DEL_PARTNER)[number];

/** El manual del idioma activo; si el idioma no tiene uno, el español, que es el base. */
export function manualParaIdioma(locale: string): ManualDelPartner {
    return MANUALES_DEL_PARTNER.find((m) => m.lang === locale) ?? MANUALES_DEL_PARTNER[0];
}
