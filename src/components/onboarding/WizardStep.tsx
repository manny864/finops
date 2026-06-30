'use client';

import React from 'react';
import { CheckCircle2, Circle, AlertCircle, Loader2 } from 'lucide-react';

export type StepStatus = 'pending' | 'in_progress' | 'completed' | 'skipped';

interface WizardStepProps {
    stepNumber: number;
    title: string;
    description: string;
    status: StepStatus;
    children?: React.ReactNode;
    onStart?: () => void;
    onContinue?: () => void;
    onSkip?: () => void;
    actionLabel?: string;
    isActive?: boolean;
}

export default function WizardStep({
    stepNumber,
    title,
    description,
    status,
    children,
    onStart,
    onContinue,
    onSkip,
    actionLabel = 'Continue',
    isActive = false,
}: WizardStepProps) {
    const getStatusIcon = () => {
        switch (status) {
            case 'completed':
                return <CheckCircle2 className="w-6 h-6 text-green-500" />;
            case 'in_progress':
                return <Loader2 className="w-6 h-6 text-blue-500 animate-spin" />;
            case 'skipped':
                return <AlertCircle className="w-6 h-6 text-yellow-500" />;
            default:
                return <Circle className="w-6 h-6 text-gray-300" />;
        }
    };

    const getStatusBgColor = () => {
        if (isActive) return 'bg-blue-50 border-blue-200';
        return status === 'completed' ? 'bg-green-50 border-green-200' : 'bg-white border-gray-200';
    };

    const isActionable = status === 'pending' || status === 'in_progress';

    return (
        <div
            className={`border rounded-lg p-6 transition-all ${getStatusBgColor()} ${
                isActive ? 'ring-2 ring-blue-200' : ''
            }`}
        >
            <div className="flex items-start gap-4">
                <div className="flex-shrink-0 mt-1">
                    {getStatusIcon()}
                </div>

                <div className="flex-1">
                    <div className="flex items-center gap-3 mb-2">
                        <span className="text-sm font-semibold text-gray-500">Step {stepNumber}</span>
                        <h3 className="text-lg font-bold text-gray-900">{title}</h3>
                    </div>
                    <p className="text-sm text-gray-600 mb-4">{description}</p>

                    {isActive && children && (
                        <div className="mb-4 mt-4 p-4 bg-white rounded border border-blue-100">
                            {children}
                        </div>
                    )}

                    {isActionable && (
                        <div className="flex gap-3 mt-4">
                            <button
                                onClick={status === 'pending' ? onStart : onContinue}
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                            >
                                {status === 'pending' ? 'Start' : actionLabel}
                            </button>
                            {onSkip && (
                                <button
                                    onClick={onSkip}
                                    className="px-4 py-2 bg-gray-200 hover:bg-gray-300 text-gray-700 rounded-lg font-medium transition-colors"
                                >
                                    Skip for now
                                </button>
                            )}
                        </div>
                    )}

                    {status === 'completed' && (
                        <div className="flex gap-3 mt-4">
                            <span className="text-sm font-medium text-green-700">✓ Completed</span>
                        </div>
                    )}

                    {status === 'skipped' && (
                        <div className="flex gap-3 mt-4">
                            <span className="text-sm font-medium text-yellow-700">⊘ Skipped</span>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
