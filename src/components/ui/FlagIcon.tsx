import React from "react";

export type SupportedLocale = "es" | "en" | "pt-BR";

interface FlagIconProps {
  locale: SupportedLocale | string;
  className?: string;
}

/**
 * Banderas vectoriales SVG puras, independientes del sistema operativo y navegador.
 * Resuelven la limitación de Windows (donde Segoe UI Emoji no implementa banderas de países)
 * y de elementos nativos HTML que no admiten renderizado gráfico.
 */
export function FlagIcon({ locale, className = "w-5 h-3.5" }: FlagIconProps) {
  const normLocale = locale?.toLowerCase();

  // España (ES)
  if (normLocale === "es") {
    return (
      <span className={`inline-flex items-center justify-center shrink-0 overflow-hidden rounded-[3px] ring-1 ring-black/15 dark:ring-white/20 shadow-xs ${className}`}>
        <svg
          viewBox="0 0 750 500"
          className="w-full h-full object-cover"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Franjas oficiales 1:2:1 */}
          <rect width="750" height="500" fill="#c60b1e" />
          <rect width="750" height="250" y="125" fill="#ffc400" />
          {/* Escudo representativo simplificado */}
          <g transform="translate(190, 250)">
            <path
              d="M-28,-42 h56 v45 c0,25 -28,45 -28,45 c0,0 -28,-20 -28,-45 z"
              fill="#c60b1e"
              stroke="#ffc400"
              strokeWidth="4"
            />
            <path
              d="M-14,-28 h28 v28 c0,14 -14,22 -14,22 c0,0 -14,-8 -14,-22 z"
              fill="#ffc400"
            />
            {/* Corona superior */}
            <path
              d="M-24,-48 l10,7 l14,-11 l14,11 l10,-7 v8 h-48 z"
              fill="#ffc400"
            />
            <circle cx="-24" cy="-51" r="2.5" fill="#ffc400" />
            <circle cx="0" cy="-55" r="3" fill="#ffc400" />
            <circle cx="24" cy="-51" r="2.5" fill="#ffc400" />
            {/* Columnas */}
            <rect x="-44" y="-40" width="7" height="85" rx="3" fill="#ffffff" opacity="0.9" />
            <rect x="37" y="-40" width="7" height="85" rx="3" fill="#ffffff" opacity="0.9" />
          </g>
        </svg>
      </span>
    );
  }

  // Estados Unidos / Inglés (EN)
  if (normLocale === "en") {
    return (
      <span className={`inline-flex items-center justify-center shrink-0 overflow-hidden rounded-[3px] ring-1 ring-black/15 dark:ring-white/20 shadow-xs ${className}`}>
        <svg
          viewBox="0 0 741 390"
          className="w-full h-full object-cover"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* 13 franjas rojas y blancas */}
          <rect width="741" height="390" fill="#b22234" />
          <path
            d="M0,30h741M0,90h741M0,150h741M0,210h741M0,270h741M0,330h741"
            stroke="#ffffff"
            strokeWidth="30"
          />
          {/* Cantón azul */}
          <rect width="296" height="210" fill="#3c3b6e" />
          {/* Constelación de estrellas */}
          <g fill="#ffffff">
            {[
              [25, 20], [75, 20], [125, 20], [175, 20], [225, 20], [275, 20],
              [50, 42], [100, 42], [150, 42], [200, 42], [250, 42],
              [25, 64], [75, 64], [125, 64], [175, 64], [225, 64], [275, 64],
              [50, 86], [100, 86], [150, 86], [200, 86], [250, 86],
              [25, 108], [75, 108], [125, 108], [175, 108], [225, 108], [275, 108],
              [50, 130], [100, 130], [150, 130], [200, 130], [250, 130],
              [25, 152], [75, 152], [125, 152], [175, 152], [225, 152], [275, 152],
              [50, 174], [100, 174], [150, 174], [200, 174], [250, 174],
              [25, 196], [75, 196], [125, 196], [175, 196], [225, 196], [275, 196],
            ].map(([cx, cy], i) => (
              <circle key={i} cx={cx} cy={cy} r="6" />
            ))}
          </g>
        </svg>
      </span>
    );
  }

  // Brasil / Português (PT-BR)
  if (normLocale === "pt-br" || normLocale === "pt") {
    return (
      <span className={`inline-flex items-center justify-center shrink-0 overflow-hidden rounded-[3px] ring-1 ring-black/15 dark:ring-white/20 shadow-xs ${className}`}>
        <svg
          viewBox="0 0 720 504"
          className="w-full h-full object-cover"
          xmlns="http://www.w3.org/2000/svg"
          aria-hidden="true"
        >
          {/* Fondo verde */}
          <rect width="720" height="504" fill="#009b3a" />
          {/* Rombo amarillo */}
          <polygon points="360,44 676,252 360,460 44,252" fill="#fedf00" />
          {/* Círculo azul */}
          <circle cx="360" cy="252" r="126" fill="#002776" />
          {/* Franja celestial blanca curva */}
          <path
            d="M234,252 A126,126 0 0,1 486,252"
            fill="none"
            stroke="#ffffff"
            strokeWidth="18"
          />
          {/* Estrellas representativas */}
          <circle cx="360" cy="285" r="4.5" fill="#ffffff" />
          <circle cx="340" cy="300" r="3.5" fill="#ffffff" />
          <circle cx="375" cy="305" r="3" fill="#ffffff" />
          <circle cx="390" cy="290" r="3.5" fill="#ffffff" />
          <circle cx="360" cy="320" r="3" fill="#ffffff" />
        </svg>
      </span>
    );
  }

  // Fallback genérico neutral
  return (
    <span className={`inline-flex items-center justify-center bg-gray-200 dark:bg-gray-700 text-[10px] font-bold uppercase rounded-[3px] ${className}`}>
      {locale?.slice(0, 2)}
    </span>
  );
}
