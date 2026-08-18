"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { useTenant } from "@/components/TenantProvider";
import { useProviderTranslations } from "@/lib/useProviderTranslations";

export default function RbacLockTooltip({ children }: { children: React.ReactNode }) {
    const { requiresRbacUpdate } = useTenant();
    const t = useProviderTranslations("Common");
    const [showTooltip, setShowTooltip] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [coords, setCoords] = useState<{ top: number; left: number }>({ top: 0, left: 0 });

    const triggerRef = useRef<HTMLDivElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    const updatePosition = useCallback(() => {
        if (!triggerRef.current || typeof window === "undefined") return;
        const rect = triggerRef.current.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) return;

        const screenWidth = window.innerWidth;
        const tooltipWidth = tooltipRef.current?.offsetWidth || 180;
        const tooltipHeight = tooltipRef.current?.offsetHeight || 36;

        let top = rect.top - tooltipHeight - 8;
        if (top < 12) {
            top = rect.bottom + 8;
        }

        let left = rect.left + rect.width / 2 - tooltipWidth / 2;
        left = Math.max(12, Math.min(left, screenWidth - tooltipWidth - 12));

        setCoords({ top, left });
    }, []);

    useEffect(() => {
        if (!showTooltip) return;
        updatePosition();

        const handleScroll = () => updatePosition();
        window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
        window.addEventListener("resize", handleScroll, { passive: true });

        return () => {
            window.removeEventListener("scroll", handleScroll, true);
            window.removeEventListener("resize", handleScroll);
        };
    }, [showTooltip, updatePosition]);

    if (!requiresRbacUpdate) {
        return <>{children}</>;
    }

    const tooltipElement = showTooltip && mounted ? (
        <div
            ref={tooltipRef}
            role="tooltip"
            style={{
                position: "fixed",
                top: `${coords.top}px`,
                left: `${coords.left}px`,
                zIndex: 999999,
                boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5)",
            }}
            className="pointer-events-none px-3 py-2 text-xs font-medium text-white bg-[#1B2A41] rounded-lg shadow-lg whitespace-nowrap border border-slate-700 animate-in fade-in zoom-in-95 duration-100"
        >
            {t("rbacUpdateRequired")}
        </div>
    ) : null;

    return (
        <div
            ref={triggerRef}
            className="relative inline-block"
            onMouseEnter={() => setShowTooltip(true)}
            onMouseLeave={() => setShowTooltip(false)}
            onClickCapture={(e) => {
                e.preventDefault();
                e.stopPropagation();
            }}
        >
            <div className="opacity-50 cursor-not-allowed pointer-events-none">
                {children}
            </div>
            {mounted && tooltipElement && createPortal(tooltipElement, document.body)}
        </div>
    );
}
