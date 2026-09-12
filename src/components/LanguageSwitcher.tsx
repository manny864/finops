"use client";
import { useLocale } from "next-intl";
import { useRouter, usePathname } from "@/i18n/routing";
import { useSearchParams } from "next/navigation";
import { CSSProperties, useEffect, useRef, useState, useTransition } from "react";
import { ChevronDown, Check } from "lucide-react";
import { FlagIcon } from "@/components/ui/FlagIcon";

const LANGUAGES = [
  { code: "es", iso: "ES" },
  { code: "en", iso: "EN" },
  { code: "pt-BR", iso: "PT-BR" },
] as const;

export interface LanguageSwitcherProps {
  className?: string;
  variant?: "default" | "white";
  align?: "left" | "right";
  fullWidth?: boolean;
  // Compatibilidad con props previas
  selectClassName?: string;
  iconClassName?: string;
  selectStyle?: CSSProperties;
}

export default function LanguageSwitcher({
  className = "",
  variant,
  align = "right",
  fullWidth,
  selectClassName,
  selectStyle,
}: LanguageSwitcherProps = {}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const dropdownRef = useRef<HTMLDivElement>(null);

  const currentLocale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  // Detección de ancho completo
  const isFullWidth = fullWidth || className.includes("w-full");

  // Detección automática de modo blanco (pantalla de login o estilo forzado)
  const isWhite =
    variant === "white" ||
    selectStyle?.color === "#ffffff" ||
    selectStyle?.color === "#fff" ||
    selectClassName?.includes("white");

  // Encontrar el idioma activo o fallback a ES
  const activeLanguage =
    LANGUAGES.find((lang) => lang.code.toLowerCase() === currentLocale?.toLowerCase()) ||
    LANGUAGES[0];

  const handleSelectLanguage = (nextLocale: string) => {
    setIsOpen(false);
    if (nextLocale === currentLocale) return;

    startTransition(() => {
      const search = searchParams.toString();
      const query = search ? `?${search}` : "";
      router.replace(`${pathname}${query}` as any, { locale: nextLocale });
    });
  };

  // Cerrar al hacer clic fuera del dropdown
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("mousedown", handleClickOutside);
    }
    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [isOpen]);

  // Cerrar con tecla Escape
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen]);

  return (
    <div
      ref={dropdownRef}
      className={`relative ${isFullWidth ? "w-full" : "inline-block"} text-left select-none ${className}`}
    >
      {/* Botón Disparador */}
      <button
        type="button"
        onClick={() => setIsOpen((prev) => !prev)}
        disabled={isPending}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label="Seleccionar idioma"
        style={selectStyle}
        className={
          isWhite
            ? `${isFullWidth ? "w-full justify-between" : "justify-center"} flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-bold tracking-wider text-white bg-white/10 hover:bg-white/20 border border-white/25 backdrop-blur-md shadow-md transition-all focus:outline-none focus:ring-2 focus:ring-white/40 cursor-pointer`
            : isFullWidth
            ? "w-full flex items-center justify-between px-3 py-2 rounded-lg text-sm font-semibold tracking-wide text-gray-900 dark:text-gray-100 bg-white dark:bg-slate-800 border border-gray-200 dark:border-slate-700 shadow-xs hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500/30 cursor-pointer"
            : selectClassName ??
              "flex items-center gap-2 px-2.5 py-1.5 rounded-lg text-xs font-bold tracking-wide text-gray-700 dark:text-gray-200 hover:text-gray-900 dark:hover:text-white bg-gray-100/90 dark:bg-slate-800/90 hover:bg-gray-200/90 dark:hover:bg-slate-700/90 border border-gray-200 dark:border-slate-700 shadow-2xs transition-all focus:outline-none focus:ring-2 focus:ring-blue-500/30 cursor-pointer"
        }
      >
        <div className="flex items-center gap-2">
          <FlagIcon locale={activeLanguage.code} className="w-4.5 h-3" />
          <span
            className={`font-bold uppercase text-[11px] tracking-wider ${
              isWhite ? "text-white" : ""
            }`}
          >
            {activeLanguage.iso}
          </span>
        </div>
        <ChevronDown
          className={`w-3.5 h-3.5 transition-transform duration-200 ${
            isOpen ? "rotate-180" : ""
          } ${isWhite ? "text-white/80" : "text-gray-500 dark:text-gray-400"}`}
        />
      </button>

      {/* Menú Desplegable con Banderas SVG y Códigos ISO */}
      {isOpen && (
        <div
          role="listbox"
          className={`absolute ${
            isFullWidth
              ? "left-0 right-0 w-full"
              : align === "right"
              ? "right-0"
              : "left-0"
          } mt-1.5 z-50 min-w-[130px] rounded-xl p-1 shadow-2xl backdrop-blur-xl border transition-all animate-in fade-in zoom-in-95 duration-150 ${
            isWhite
              ? "bg-slate-900/95 border-white/20 text-white"
              : "bg-white/95 dark:bg-slate-900/95 border-gray-200 dark:border-slate-800 text-gray-800 dark:text-gray-100"
          }`}
        >
          {LANGUAGES.map((lang) => {
            const isSelected = lang.code.toLowerCase() === currentLocale?.toLowerCase();
            return (
              <button
                key={lang.code}
                role="option"
                aria-selected={isSelected}
                onClick={() => handleSelectLanguage(lang.code)}
                className={`flex items-center justify-between w-full px-3 py-2 rounded-lg text-xs font-bold tracking-wider transition-colors cursor-pointer ${
                  isSelected
                    ? isWhite
                      ? "bg-white/20 text-white"
                      : "bg-blue-50 dark:bg-blue-950/50 text-blue-600 dark:text-blue-400"
                    : isWhite
                    ? "text-white/90 hover:text-white hover:bg-white/15"
                    : "text-gray-700 dark:text-gray-300 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-slate-800"
                }`}
              >
                <div className="flex items-center gap-2">
                  <FlagIcon locale={lang.code} className="w-4.5 h-3" />
                  <span className={isWhite ? "text-white" : ""}>{lang.iso}</span>
                </div>
                {isSelected && (
                  <Check
                    className={`w-3.5 h-3.5 shrink-0 ${
                      isWhite ? "text-white" : "text-blue-600 dark:text-blue-400"
                    }`}
                  />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
