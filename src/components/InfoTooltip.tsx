"use client";
import React, { useState } from "react";
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

    if (!content) return null;

    const getPositionClasses = () => {
        if (position === "bottom") {
            if (align === "right") return "top-full right-0 mt-2";
            if (align === "left") return "top-full left-0 mt-2";
            return "top-full left-1/2 -translate-x-1/2 mt-2";
        }
        if (position === "top") {
            if (align === "right") return "bottom-full right-0 mb-2";
            if (align === "left") return "bottom-full left-0 mb-2";
            return "bottom-full left-1/2 -translate-x-1/2 mb-2";
        }
        if (position === "left") return "right-full top-1/2 -translate-y-1/2 mr-2";
        return "left-full top-1/2 -translate-y-1/2 ml-2";
    };

    const getArrowClasses = () => {
        if (position === "bottom") {
            if (align === "right") return "bottom-full right-3 -mb-1 border-4 border-transparent";
            if (align === "left") return "bottom-full left-3 -mb-1 border-4 border-transparent";
            return "bottom-full left-1/2 -translate-x-1/2 -mb-1 border-4 border-transparent";
        }
        if (position === "top") {
            if (align === "right") return "top-full right-3 -mt-1 border-4 border-transparent";
            if (align === "left") return "top-full left-3 -mt-1 border-4 border-transparent";
            return "top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent";
        }
        return "";
    };

    const getArrowStyle = (): React.CSSProperties => {
        if (position === "bottom") {
            return {
                borderBottomColor: "#1B2A41",
                borderTopColor: "transparent",
                borderLeftColor: "transparent",
                borderRightColor: "transparent",
            };
        }
        if (position === "top") {
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
        <span className={`relative inline-flex items-center align-middle ${className}`}>
            <button
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
                        zIndex: 9999,
                        boxShadow: "0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.5)"
                    }}
                    className={`block absolute pointer-events-none w-64 sm:w-72 p-3 text-white text-[11px] font-normal leading-relaxed rounded-xl border border-slate-600 text-left normal-case tracking-normal ${getPositionClasses()}`}
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
