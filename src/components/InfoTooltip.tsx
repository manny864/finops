"use client";
import React, { useState } from "react";
import { IconInfoCircle } from "@tabler/icons-react";

interface InfoTooltipProps {
    content: string;
    className?: string;
    iconClassName?: string;
    position?: "top" | "bottom" | "left" | "right";
}

export default function InfoTooltip({
    content,
    className = "",
    iconClassName = "w-3.5 h-3.5 text-slate-400 hover:text-[#0054A6] dark:hover:text-blue-400 transition-colors",
    position = "top"
}: InfoTooltipProps) {
    const [open, setOpen] = useState(false);

    return (
        <span className={`relative inline-flex items-center align-middle group ${className}`}>
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
                <div
                    role="tooltip"
                    className={`absolute z-50 pointer-events-none w-64 p-2.5 bg-[#1B2A41] dark:bg-slate-800 text-white text-[11px] font-normal leading-snug rounded-lg shadow-xl border border-slate-700/80 animate-in fade-in zoom-in-95 duration-150 text-left normal-case tracking-normal ${
                        position === "top"
                            ? "bottom-full left-1/2 -translate-x-1/2 mb-1.5"
                            : position === "bottom"
                            ? "top-full left-1/2 -translate-x-1/2 mt-1.5"
                            : position === "left"
                            ? "right-full top-1/2 -translate-y-1/2 mr-1.5"
                            : "left-full top-1/2 -translate-y-1/2 ml-1.5"
                    }`}
                >
                    {content}
                    {position === "top" && (
                        <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-1 border-4 border-transparent border-t-[#1B2A41] dark:border-t-slate-800" />
                    )}
                    {position === "bottom" && (
                        <div className="absolute bottom-full left-1/2 -translate-x-1/2 -mb-1 border-4 border-transparent border-b-[#1B2A41] dark:border-b-slate-800" />
                    )}
                </div>
            )}
        </span>
    );
}
