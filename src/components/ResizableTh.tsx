"use client";
import { useTranslations } from "next-intl";
import React, { useRef } from "react";

/**
 * Cabecera de tabla con ancho ajustable a mano (drag del borde derecho).
 *
 * Directiva de UI: toda tabla >15 filas debe paginar, ser responsive y dejar
 * al usuario controlar el ancho de columnas para que los textos no se
 * superpongan. Usar junto con `table-fixed` en el <table> y celdas con
 * `whitespace-normal break-words` para que el texto envuelva dentro del ancho.
 *
 * Debe vivir a nivel de módulo (no redefinirse inline en cada render): usa
 * useRef y un componente recreado por render perdería el ancho arrastrado.
 */
export default function ResizableTh({
    children,
    minWidth = 90,
    className = "",
    sticky = false,
    onClick,
}: {
    children: React.ReactNode;
    minWidth?: number;
    className?: string;
    sticky?: boolean;
    onClick?: (e: React.MouseEvent<HTMLTableCellElement>) => void;
}) {
  const t = useTranslations("Common");
    const thRef = useRef<HTMLTableCellElement>(null);
    const onMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const th = thRef.current;
        if (!th) return;
        const startX = e.clientX;
        const startWidth = th.getBoundingClientRect().width;
        const onMove = (ev: MouseEvent) => {
            th.style.width = `${Math.max(minWidth, startWidth + (ev.clientX - startX))}px`;
        };
        const onUp = () => {
            window.removeEventListener("mousemove", onMove);
            window.removeEventListener("mouseup", onUp);
        };
        window.addEventListener("mousemove", onMove);
        window.addEventListener("mouseup", onUp);
    };
    return (
        <th
            ref={thRef}
            style={{ minWidth }}
            onClick={onClick}
            className={`relative select-none ${sticky ? "sticky top-0 z-10" : ""} ${className}`}
        >
            {children}
            <span
                onMouseDown={onMouseDown}
                title={t("resize_hint")}
                className="absolute top-0 right-0 h-full w-2 cursor-col-resize hover:bg-brand-bright/50 active:bg-brand-bright"
            />
        </th>
    );
}
