"use client";
import React, { useState } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useMsal } from '@azure/msal-react';
import { getFreshIdToken } from '@/lib/msalToken';

export default function SuperAdminTenantsPage() {
    const t = useTranslations('SuperAdminTenants');
    const { instance, accounts } = useMsal();
    const [loading, setLoading] = useState(false);
    const [formData, setFormData] = useState({
        tenantName: '',
        domain: '',
        adminEmail: ''
    });

    const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        setFormData({ ...formData, [e.target.name]: e.target.value });
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (accounts.length === 0) {
            toast.error(t('authError'));
            return;
        }

        setLoading(true);
        try {
            const tokenResponse = { idToken: await getFreshIdToken(instance, accounts[0]) };

            const res = await fetch('/api/superadmin/tenants/create', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenResponse.idToken}`
                },
                body: JSON.stringify(formData)
            });

            const data = await res.json();
            if (res.ok && data.success) {
                toast.success(t('successMessage'));
                setFormData({ tenantName: '', domain: '', adminEmail: '' });
            } else {
                toast.error(data.error || t('errorMessage'));
            }
        } catch {
            toast.error(t('errorMessage'));
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="max-w-4xl mx-auto p-6">
            <div className="mb-8">
                <h1 className="text-2xl font-bold text-gray-900 font-heading">{t('title')}</h1>
                <p className="text-gray-500 mt-1">{t('subtitle')}</p>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <div className="p-6 border-b border-gray-200 bg-gray-50">
                    <h2 className="text-lg font-semibold text-gray-800">{t('formTitle')}</h2>
                </div>
                <form onSubmit={handleSubmit} className="p-6 space-y-6">
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('companyName')}</label>
                        <input
                            type="text"
                            name="tenantName"
                            value={formData.tenantName}
                            onChange={handleChange}
                            required
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="Acme Corp"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('azureTenantId')}</label>
                        <input
                            type="text"
                            name="domain"
                            value={formData.domain}
                            onChange={handleChange}
                            required
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="e.g. 12345678-1234-1234-1234-123456789012"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">{t('adminEmail')}</label>
                        <input
                            type="email"
                            name="adminEmail"
                            value={formData.adminEmail}
                            onChange={handleChange}
                            required
                            className="w-full px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-blue-500 outline-none"
                            placeholder="admin@acme.com"
                        />
                    </div>
                    <div className="flex justify-end pt-4">
                        <button
                            type="submit"
                            disabled={loading}
                            className={`px-6 py-2 rounded-lg font-medium text-white ${loading ? 'bg-blue-400' : 'bg-blue-600 hover:bg-blue-700'} transition-colors`}
                        >
                            {loading ? t('loading') : t('submit')}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
}
