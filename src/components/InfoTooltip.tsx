"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { IconInfoCircle } from "@tabler/icons-react";

export interface InfoTooltipProps {
    content: string;
    className?: string;
    iconClassName?: string;
    position?: "top" | "bottom" | "left" | "right";
    align?: "center" | "left" | "right";
}

export default function InfoTooltip({
    content,
    className = "",
    iconClassName = "w-3.5 h-3.5 text-slate-400 hover:text-[#0054A6] dark:hover:text-blue-400 transition-colors",
    position = "top",
    align = "center",
}: InfoTooltipProps) {
    const [open, setOpen] = useState(false);
    const [mounted, setMounted] = useState(false);
    const [coords, setCoords] = useState<{
        top: number;
        left: number;
        arrowLeft?: number;
        effectivePos: "top" | "bottom" | "left" | "right";
    }>({
        top: 0,
        left: 0,
        arrowLeft: 20,
        effectivePos: position,
    });

    const buttonRef = useRef<HTMLButtonElement>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const timeoutRef = useRef<NodeJS.Timeout | null>(null);

    useEffect(() => {
        setMounted(true);
    }, []);

    const updatePosition = useCallback(() => {
        if (!buttonRef.current || typeof window === "undefined") return;
        const buttonRect = buttonRef.current.getBoundingClientRect();

        // If button is unrendered or hidden
        if (buttonRect.width === 0 && buttonRect.height === 0) return;

        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;

        const tooltipWidth = tooltipRef.current?.offsetWidth || Math.min(320, screenWidth - 32);
        const tooltipHeight = tooltipRef.current?.offsetHeight || 80;

        let effectivePos = position;
        let top = 0;
        let left = 0;

        // Vertical positioning
        if (position === "top") {
            top = buttonRect.top - tooltipHeight - 8;
            if (top < 12) {
                // Flip to bottom if not enough space on top
                effectivePos = "bottom";
                top = buttonRect.bottom + 8;
            }
        } else if (position === "bottom") {
            top = buttonRect.bottom + 8;
            if (top + tooltipHeight > screenHeight - 12) {
                // Flip to top if not enough space on bottom
                effectivePos = "top";
                top = buttonRect.top - tooltipHeight - 8;
            }
        } else if (position === "left") {
            left = buttonRect.left - tooltipWidth - 8;
            top = buttonRect.top + buttonRect.height / 2 - tooltipHeight / 2;
            if (left < 12) {
                effectivePos = "right";
                left = buttonRect.right + 8;
            }
        } else if (position === "right") {
            left = buttonRect.right + 8;
            top = buttonRect.top + buttonRect.height / 2 - tooltipHeight / 2;
            if (left + tooltipWidth > screenWidth - 12) {
                effectivePos = "left";
                left = buttonRect.left - tooltipWidth - 8;
            }
        }

        // Horizontal alignment for top/bottom
        if (effectivePos === "top" || effectivePos === "bottom") {
            if (align === "center") {
                left = buttonRect.left + buttonRect.width / 2 - tooltipWidth / 2;
            } else if (align === "left") {
                left = buttonRect.left;
            } else if (align === "right") {
                left = buttonRect.right - tooltipWidth;
            }

            // Clamp within viewport
            left = Math.max(12, Math.min(left, screenWidth - tooltipWidth - 12));
        }

        // Calculate arrow position pointing directly to button center
        const buttonCenter = buttonRect.left + buttonRect.width / 2;
        const arrowLeft = Math.max(14, Math.min(buttonCenter - left, tooltipWidth - 14));

        setCoords({
            top,
            left,
            arrowLeft,
            effectivePos,
        });
    }, [position, align]);

    useEffect(() => {
        if (!open) return;

        // Position immediately and again after element is measured in DOM
        updatePosition();
        const raf = requestAnimationFrame(() => {
            updatePosition();
        });

        const handleScroll = () => updatePosition();
        window.addEventListener("scroll", handleScroll, { capture: true, passive: true });
        window.addEventListener("resize", handleScroll, { passive: true });

        return () => {
            cancelAnimationFrame(raf);
            window.removeEventListener("scroll", handleScroll, true);
            window.removeEventListener("resize", handleScroll);
        };
    }, [open, updatePosition]);

    const handleMouseEnter = () => {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setOpen(true);
    };

    const handleMouseLeave = () => {
        timeoutRef.current = setTimeout(() => {
            setOpen(false);
        }, 120);
    };

    // Close on click outside
    useEffect(() => {
        if (!open) return;
        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            if (
                buttonRef.current &&
                !buttonRef.current.contains(e.target as Node) &&
                tooltipRef.current &&
                !tooltipRef.current.contains(e.target as Node)
            ) {
                setOpen(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        document.addEventListener("touchstart", handleClickOutside);
        return () => {
            document.removeEventListener("mousedown", handleClickOutside);
            document.removeEventListener("touchstart", handleClickOutside);
        };
    }, [open]);

    if (!content) return null;

    const arrowStyle = (): React.CSSProperties => {
        if (coords.effectivePos === "top") {
            return {
                top: "100%",
                left: `${coords.arrowLeft}px`,
                transform: "translateX(-50%)",
                borderTopColor: "#1B2A41",
                borderBottomColor: "transparent",
                borderLeftColor: "transparent",
                borderRightColor: "transparent",
                borderWidth: "5px",
                borderStyle: "solid",
            };
        }
        if (coords.effectivePos === "bottom") {
            return {
                bottom: "100%",
                left: `${coords.arrowLeft}px`,
                transform: "translateX(-50%)",
                borderBottomColor: "#1B2A41",
                borderTopColor: "transparent",
                borderLeftColor: "transparent",
                borderRightColor: "transparent",
                borderWidth: "5px",
                borderStyle: "solid",
            };
        }
        return {};
    };

    const tooltipElement = open && mounted ? (
        <div
            ref={tooltipRef}
            role="tooltip"
            onMouseEnter={handleMouseEnter}
            onMouseLeave={handleMouseLeave}
            style={{
                position: "fixed",
                top: `${coords.top}px`,
                left: `${coords.left}px`,
                backgroundColor: "#1B2A41",
                color: "#FFFFFF",
                zIndex: 999999,
                boxShadow: "0 20px 30px -10px rgba(0, 0, 0, 0.6), 0 10px 15px -5px rgba(0, 0, 0, 0.4)",
            }}
            className="w-max min-w-[180px] max-w-[min(340px,calc(100vw-2rem))] p-3 text-white text-[11px] font-normal leading-relaxed rounded-xl border border-slate-600 text-left normal-case tracking-normal whitespace-normal break-words hyphens-auto max-h-[75vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-100"
        >
            {content}
            <span style={arrowStyle()} className="block absolute pointer-events-none" />
        </div>
    ) : null;

    return (
        <span className={`relative inline-flex items-center align-middle ${className}`}>
            <button
                ref={buttonRef}
                type="button"
                className="focus:outline-none cursor-help p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors inline-flex items-center"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onFocus={handleMouseEnter}
                onBlur={handleMouseLeave}
                onClick={(e) => {
                    e.stopPropagation();
                    setOpen(!open);
                }}
                aria-label={content}
            >
                <IconInfoCircle className={iconClassName} />
            </button>
            {mounted && tooltipElement && createPortal(tooltipElement, document.body)}
        </span>
    );
}
