"use client";

import MockBanner from '@/components/MockBanner';
import React, { useState, useRef, useCallback } from 'react';
import Papa from 'papaparse';
import { useMsal } from '@azure/msal-react';
import { useTenant } from '@/components/TenantProvider';
import { getFreshIdToken } from '@/lib/msalToken';
import { isMockTenant } from '@/lib/mockData';
import { UploadCloud, FileText, CheckCircle2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import ReactMarkdown from 'react-markdown';
import { useTranslations } from 'next-intl';

export default function CSVUploadPage() {
    const t = useTranslations('IntelligenceUpload');
    const { instance, accounts, inProgress } = useMsal();
    const { selectedTenant } = useTenant();
    const isMock = isMockTenant(selectedTenant?.id || '');

    const [isDragging, setIsDragging] = useState(false);
    const [file, setFile] = useState<File | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [assessmentResult, setAssessmentResult] = useState<string | null>(null);

    const buildAuthHeaders = useCallback(async (): Promise<Record<string, string>> => {
        if (isMock || accounts.length === 0) return {};
        const token = await getFreshIdToken(instance, accounts[0]);
        return token ? { Authorization: `Bearer ${token}` } : {};
    }, [isMock, accounts, instance]);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const droppedFiles = e.dataTransfer.files;
        if (droppedFiles.length > 0) {
            handleFileSelect(droppedFiles[0]);
        }
    };

    const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
        if (e.target.files && e.target.files.length > 0) {
            handleFileSelect(e.target.files[0]);
        }
    };

    const handleFileSelect = (selectedFile: File) => {
        if (!selectedFile.name.endsWith('.csv')) {
            toast.error(t('csvOnly'));
            return;
        }
        setFile(selectedFile);
        setAssessmentResult(null); // Reset previous results
    };

    const processFile = () => {
        if (!file) return;
        // Directiva 24: no despachar antes de que MSAL resuelva la sesion.
        // Analizar sin cuenta lista termina en un 401 que el usuario lee como
        // "el archivo esta mal".
        if (!isMock && (inProgress !== 'none' || accounts.length === 0)) {
            toast.error(t('sessionNotReady'));
            return;
        }

        setIsProcessing(true);
        toast.info(t('analyzingStructure'));

        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            complete: async (results) => {
                if (results.errors.length > 0) {
                    console.error("CSV Parse Errors:", results.errors);
                    toast.error(t('csvReadError'));
                    setIsProcessing(false);
                    return;
                }

                toast.success(t('parsedSuccess', { count: results.data.length }));

                try {
                    // El endpoint resuelve tenant y email desde el JWT
                    // (requireRequestIdentity). Sin este header devolvia 401
                    // en todos los casos: el fetch iba sin Authorization.
                    const authHeaders = await buildAuthHeaders();
                    const res = await fetch('/api/intelligence/upload', {
                        method: 'POST',
                        headers: {
                            'Content-Type': 'application/json',
                            ...authHeaders,
                        },
                        body: JSON.stringify({ data: results.data })
                    });

                    const json = await res.json();

                    if (res.ok && json.assessment) {
                        toast.success(t('analysisComplete'));
                        setAssessmentResult(json.assessment);
                    } else {
                        toast.error(json.error || t('processFailed'));
                    }
                } catch (error) {
                    console.error("Upload API Error:", error);
                    toast.error(t('networkError'));
                } finally {
                    setIsProcessing(false);
                }
            },
            error: (error) => {
                console.error("PapaParse Error:", error);
                toast.error(t('criticalParseError'));
                setIsProcessing(false);
            }
        });
    };

    const resetState = () => {
        setFile(null);
        setAssessmentResult(null);
        if (fileInputRef.current) fileInputRef.current.value = "";
    };

    return (
        <div className="p-6 max-w-5xl mx-auto animate-in fade-in duration-500">
            <MockBanner />
            <div className="mb-8">
                <h1 className="text-3xl font-extrabold text-gray-900 dark:text-white tracking-tight flex items-center">
                    <UploadCloud className="w-8 h-8 mr-3 text-[#0054A6] dark:text-[#00AEEF]" />
                    {t('title')}
                </h1>
                <p className="text-gray-500 dark:text-gray-400 mt-2">
                    {t('subtitle')}
                </p>
            </div>

            {!assessmentResult && (
                <div 
                    className={`relative border-2 border-dashed rounded-xl p-12 flex flex-col items-center justify-center transition-all bg-white dark:bg-slate-900 shadow-sm
                        ${isDragging ? 'border-[#0054A6] dark:border-[#00AEEF] bg-[#0054A6]/5 dark:bg-[#00AEEF]/10 scale-[1.01]' : 'border-gray-300 dark:border-slate-700 hover:border-gray-400 dark:hover:border-slate-600'}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    <input 
                        type="file" 
                        accept=".csv" 
                        className="hidden" 
                        ref={fileInputRef}
                        onChange={handleFileInput}
                    />
                    
                    {!file ? (
                        <>
                            <div className="w-16 h-16 bg-[#0054A6]/10 dark:bg-[#00AEEF]/10 rounded-full flex items-center justify-center mb-4">
                                <UploadCloud className="w-8 h-8 text-[#0054A6] dark:text-[#00AEEF]" />
                            </div>
                            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-2">{t('dropzoneTitle')}</h3>
                            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6 text-center max-w-md">
                                {t('dropzoneSubtitle')}
                            </p>
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className="px-6 py-2.5 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 rounded-lg shadow-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors"
                            >
                                {t('selectFileButton')}
                            </button>
                        </>
                    ) : (
                        <div className="flex flex-col items-center text-center">
                            <div className="w-16 h-16 bg-green-100 dark:bg-green-900/30 rounded-full flex items-center justify-center mb-4">
                                <FileText className="w-8 h-8 text-green-600 dark:text-green-400" />
                            </div>
                            <h3 className="text-xl font-bold text-gray-800 dark:text-gray-200 mb-2">{file.name}</h3>
                            <p className="text-gray-500 dark:text-gray-400 text-sm mb-6">
                                {t('fileSizeLabel', { size: (file.size / 1024 / 1024).toFixed(2) })}
                            </p>

                            <div className="flex gap-4">
                                <button
                                    onClick={resetState}
                                    disabled={isProcessing}
                                    className="px-6 py-2.5 bg-white dark:bg-slate-800 border border-gray-300 dark:border-slate-600 text-gray-700 dark:text-gray-300 rounded-lg shadow-sm font-semibold hover:bg-gray-50 dark:hover:bg-slate-700 transition-colors disabled:opacity-50"
                                >
                                    {t('cancelButton')}
                                </button>
                                <button
                                    onClick={processFile}
                                    disabled={isProcessing}
                                    className="flex items-center px-6 py-2.5 bg-[#0054A6] hover:bg-[#004080] text-white rounded-lg shadow-sm font-semibold transition-colors disabled:opacity-50"
                                >
                                    {isProcessing ? (
                                        <>
                                            <RefreshCw className="w-5 h-5 mr-2 animate-spin text-white" />
                                            {t('processingButton')}
                                        </>
                                    ) : (
                                        <>
                                            <CheckCircle2 className="w-5 h-5 mr-2 text-white" />
                                            {t('analyzeButton')}
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {assessmentResult && (
                <div className="mt-8 animate-in slide-in-from-bottom-4 duration-500">
                    <div className="flex items-center justify-between mb-4">
                        <h2 className="text-2xl font-bold text-gray-900 dark:text-white flex items-center">
                            <CheckCircle2 className="w-6 h-6 mr-2 text-green-500" />
                            {t('reportTitle')}
                        </h2>
                        <button
                            onClick={resetState}
                            className="text-sm font-medium text-[#0054A6] hover:text-[#004080] dark:text-[#00AEEF] dark:hover:text-[#66CFFF]"
                        >
                            {t('uploadAnotherButton')}
                        </button>
                    </div>
                    
                    <div className="bg-white dark:bg-slate-900 border border-gray-200 dark:border-slate-800 rounded-xl shadow-sm p-8 prose prose-blue dark:prose-invert max-w-none">
                        <ReactMarkdown>{assessmentResult}</ReactMarkdown>
                    </div>
                </div>
            )}
        </div>
    );
}
