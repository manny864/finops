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

/**
 * Versión streaming (Copilot): acumula hasta fin de párrafo ("\n\n") y filtra ese bloque.
 * Ni un enlace, ni su destino, ni una definición por referencia cruzan una línea en blanco,
 * así que el resultado es igual a filtrar el texto completo.
 */
export function guardAiMarkdownStream(): TransformStream<string, string> {
  let buf = "";
  return new TransformStream<string, string>({
    transform(chunk, controller) {
      buf += chunk;
      const cut = buf.lastIndexOf("\n\n");
      if (cut === -1) return;
      controller.enqueue(guardAiMarkdown(buf.slice(0, cut + 2)));
      buf = buf.slice(cut + 2);
    },
    flush(controller) {
      if (buf) controller.enqueue(guardAiMarkdown(buf));
    },
  });
}
