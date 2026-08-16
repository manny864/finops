"use client";
import React, { useState, useRef, useEffect, useCallback } from "react";
import { IconInfoCircle } from "@tabler/icons-react";

interface InfoTooltipProps {
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
    align = "center"
}: InfoTooltipProps) {
    const [open, setOpen] = useState(false);
    const [effectivePos, setEffectivePos] = useState(position);
    const [effectiveAlign, setEffectiveAlign] = useState(align);
    const buttonRef = useRef<HTMLButtonElement>(null);
    const containerRef = useRef<HTMLSpanElement>(null);

    const updatePositioning = useCallback(() => {
        if (!buttonRef.current || typeof window === "undefined") return;
        const rect = buttonRef.current.getBoundingClientRect();
        const screenWidth = window.innerWidth;
        const screenHeight = window.innerHeight;
        const tooltipEstimatedWidth = Math.min(300, screenWidth - 32);
        const tooltipEstimatedHeight = 100;

        let newPos = position;
        let newAlign = align;

        // Vertical collision check
        if (position === "top" && rect.top - tooltipEstimatedHeight < 16) {
            newPos = "bottom";
        } else if (position === "bottom" && rect.bottom + tooltipEstimatedHeight > screenHeight - 16) {
            newPos = "top";
        }

        // Horizontal collision check
        if (align === "center") {
            if (rect.left + rect.width / 2 + tooltipEstimatedWidth / 2 > screenWidth - 16) {
                newAlign = "right";
            } else if (rect.left + rect.width / 2 - tooltipEstimatedWidth / 2 < 16) {
                newAlign = "left";
            }
        } else if (align === "left") {
            if (rect.left + tooltipEstimatedWidth > screenWidth - 16) {
                newAlign = "right";
            }
        } else if (align === "right") {
            if (rect.right - tooltipEstimatedWidth < 16) {
                newAlign = "left";
            }
        }

        setEffectivePos(newPos);
        setEffectiveAlign(newAlign);
    }, [position, align]);

    useEffect(() => {
        if (open) {
            updatePositioning();
        }
    }, [open, updatePositioning]);

    // Close on click outside (especially for mobile tap)
    useEffect(() => {
        if (!open) return;
        const handleClickOutside = (e: MouseEvent | TouchEvent) => {
            if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
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

    const getPositionClasses = () => {
        if (effectivePos === "bottom") {
            if (effectiveAlign === "right") return "top-full right-0 mt-2";
            if (effectiveAlign === "left") return "top-full left-0 mt-2";
            return "top-full left-1/2 -translate-x-1/2 mt-2";
        }
        if (effectivePos === "top") {
            if (effectiveAlign === "right") return "bottom-full right-0 mb-2";
            if (effectiveAlign === "left") return "bottom-full left-0 mb-2";
            return "bottom-full left-1/2 -translate-x-1/2 mb-2";
        }
        if (effectivePos === "left") return "right-full top-1/2 -translate-y-1/2 mr-2";
        return "left-full top-1/2 -translate-y-1/2 ml-2";
    };

    const getArrowClasses = () => {
        if (effectivePos === "bottom") {
            if (effectiveAlign === "right") return "bottom-full right-3 -mb-1 border-4 border-transparent";
            if (effectiveAlign === "left") return "bottom-full left-3 -mb-1 border-4 border-transparent";
            return "bottom-full left-1/2 -translate-x-1/2 -mb-1 border-4 border-transparent";
        }
        if (effectivePos === "top") {
            if (effectiveAlign === "right") return "top-full right-3 -mt-1 border-4 border-transparent";
            if (effectiveAlign === "left") return "top-full left-3 -mt-1 border-4 border-transparent";
            return "top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent";
        }
        return "";
    };

    const getArrowStyle = (): React.CSSProperties => {
        if (effectivePos === "bottom") {
            return {
                borderBottomColor: "#1B2A41",
                borderTopColor: "transparent",
                borderLeftColor: "transparent",
                borderRightColor: "transparent",
            };
        }
        if (effectivePos === "top") {
            return {
                borderTopColor: "#1B2A41",
                borderBottomColor: "transparent",
                borderLeftColor: "transparent",
                borderRightColor: "transparent",
            };
        }
        return {};
    };

    return (
        <span ref={containerRef} className={`relative inline-flex items-center align-middle ${className}`}>
            <button
                ref={buttonRef}
                type="button"
                className="focus:outline-none cursor-help p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors inline-flex items-center"
                onMouseEnter={() => setOpen(true)}
                onMouseLeave={() => setOpen(false)}
                onFocus={() => setOpen(true)}
                onBlur={() => setOpen(false)}
                onClick={(e) => { e.stopPropagation(); setOpen(!open); }}
                aria-label={content}
            >
                <IconInfoCircle className={iconClassName} />
            </button>
            {open && (
                <span
                    role="tooltip"
                    style={{
                        backgroundColor: "#1B2A41",
                        color: "#FFFFFF",
                        opacity: 1,
                        zIndex: 99999,
                        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)"
                    }}
                    className={`block absolute pointer-events-none w-max min-w-[180px] max-w-[min(320px,calc(100vw-2rem))] p-3 text-white text-[11px] font-normal leading-relaxed rounded-xl border border-slate-600 text-left normal-case tracking-normal whitespace-normal break-words hyphens-auto max-h-[75vh] overflow-y-auto animate-in fade-in zoom-in-95 duration-100 ${getPositionClasses()}`}
                >
                    {content}
                    <span
                        style={getArrowStyle()}
                        className={`block absolute ${getArrowClasses()}`}
                    />
                </span>
            )}
        </span>
    );
}
