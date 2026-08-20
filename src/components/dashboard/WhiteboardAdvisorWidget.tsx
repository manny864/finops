"use client";

import React from "react";
import Link from "next/link";
import { useLocale, useTranslations } from "next-intl";
import { IconShieldCheck, IconArrowRight } from "@tabler/icons-react";
import type { WhiteboardAdvisorPillars } from "@/types/whiteboard.types";

const PILLAR_LABELS: Record<keyof WhiteboardAdvisorPillars, string> = {
  cost: "Costo",
  security: "Seguridad",
  reliability: "Confiabilidad",
  performance: "Rendimiento",
};

const PILLAR_COLORS: Record<keyof WhiteboardAdvisorPillars, string> = {
  cost: "#0078D4",
  security: "#EF4444",
  reliability: "#F59E0B",
  performance: "#10B981",
};

export default function WhiteboardAdvisorWidget({
  advisorPillars,
  securityActions,
}: {
  advisorPillars: WhiteboardAdvisorPillars;
  securityActions: string[];
}) {
  const t = useTranslations("WhiteBoard");
  const locale = useLocale();

  const total = Object.values(advisorPillars).reduce((a, b) => a + b, 0);

  return (
    <div className="space-y-4 h-full flex flex-col">
      {/* Pillar breakdown */}
      <div className="space-y-2">
        {(Object.keys(advisorPillars) as Array<keyof WhiteboardAdvisorPillars>).map(
          (pillar) => {
            const count = advisorPillars[pillar];
            const pct = total > 0 ? (count / total) * 100 : 0;
            return (
              <div key={pillar}>
                <div className="flex justify-between text-xs mb-0.5">
                  <span className="text-slate-600 dark:text-slate-400 capitalize">
                    {PILLAR_LABELS[pillar]}
                  </span>
                  <strong
                    className="text-[#1B2A41] dark:text-slate-200"
                    style={{ color: PILLAR_COLORS[pillar] }}
                  >
                    {count}
                  </strong>
                </div>
                <div className="h-1.5 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${pct}%`,
                      backgroundColor: PILLAR_COLORS[pillar],
                    }}
                  />
                </div>
              </div>
            );
          }
        )}
      </div>

      {/* Top 3 security actions */}
      {securityActions && securityActions.length > 0 && (
        <div className="border-t border-slate-100 dark:border-slate-800 pt-3">
          <p className="text-[11px] font-semibold text-slate-500 mb-2">
            {t("top_security_actions")}
          </p>
          <ul className="space-y-1.5">
            {securityActions.slice(0, 3).map((action, i) => (
              <li
                key={i}
                className="text-[11px] text-slate-600 dark:text-slate-400 flex items-start gap-1.5"
              >
                <IconShieldCheck
                  className="w-3.5 h-3.5 text-[#0078D4] shrink-0 mt-0.5"
                  stroke={1.5}
                />
                <span className="line-clamp-2">
                  {action.length > 80 ? action.slice(0, 80) + "…" : action}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <Link
        href={`/${locale}/governance/advisor`}
        className="inline-flex items-center gap-1 text-[11px] font-semibold text-[#0078D4] hover:text-[#0054A6] transition-colors mt-auto"
      >
        {t("go_to_advisor")}
        <IconArrowRight className="w-3 h-3" stroke={2} />
      </Link>
    </div>
  );
}