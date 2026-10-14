import { isAllowedAiLink } from "@/lib/aiLinkPolicy";

// AISEC-02: el Markdown del LLM puede traer imágenes que el navegador carga solo
// (exfiltración por query string) y enlaces de phishing. Se filtra antes de cachear,
// persistir o mandar a PDF/email. Fail-closed: se evalúa el destino, no el texto.
export function guardAiMarkdown(md: string): string {
  return (
    md
      // HTML crudo, comentarios y autolinks <scheme:...>
      .replace(/<!--[\s\S]*?-->/g, "")
      .replace(/<\/?[A-Za-z][^>]*>/g, "")
      // Imágenes -> enlaces (y el paso siguiente decide si el enlace sobrevive)
      .replace(/!\[/g, "[")
      // Destino inline: ](url "título")
      .replace(/\]\(\s*<?([^)\s>]*)>?[^)]*\)/g, (m, url: string) => (isAllowedAiLink(url) ? m : "]"))
      // Definiciones por referencia: [r]: url  (también en blockquotes / url en la línea siguiente)
      .replace(/^[ \t>]*\[[^\]\n]+\]:[ \t]*(?:\n[ \t>]*)?\S+.*$/gm, "")
      // URLs sueltas (autolink GFM) fuera de un destino permitido -> código, sin enlace
      .replace(/(?<![\w/(<`@.-])(?:https?:\/\/|www\.)[^\s<>()`]+/gi, (url: string) =>
        isAllowedAiLink(url.startsWith("www.") ? `https://${url}` : url) ? url : `\`${url}\``,
      )
  );
}
