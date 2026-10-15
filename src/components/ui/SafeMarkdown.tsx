"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { isAllowedAiLink } from "@/lib/aiLinkPolicy";

// AISEC-02: render único para Markdown generado por IA. Sin imágenes, sin HTML crudo,
// y enlaces activos sólo a hosts permitidos (el resto se muestra como texto).
const guarded: Components = {
  img: () => null,
  a: ({ href, children }) =>
    href && isAllowedAiLink(href) ? (
      <a href={href} target="_blank" rel="noopener noreferrer nofollow">
        {children}
      </a>
    ) : (
      <span>{children}</span>
    ),
};

export function SafeMarkdown({ children, components }: { children: string; components?: Components }) {
  return (
    <ReactMarkdown
      remarkPlugins={[remarkGfm]}
      skipHtml
      disallowedElements={["img", "iframe", "script", "style", "form", "input", "object", "embed"]}
      unwrapDisallowed
      urlTransform={(u) => (isAllowedAiLink(u) ? u : "")}
      components={{ ...components, ...guarded }}
    >
      {children}
    </ReactMarkdown>
  );
}
