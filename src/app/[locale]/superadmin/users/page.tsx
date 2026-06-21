"use client";
import React, { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { toast } from 'sonner';
import { useMsal } from '@azure/msal-react';
import { ShieldAlert, Shield, CheckCircle } from 'lucide-react';
import { useTenant } from '@/components/TenantProvider';

export default function SuperAdminUsersPage() {
    const t = useTranslations('SuperAdminUsers');
    const { instance, accounts } = useMsal();
    const { systemRole } = useTenant();
    const [users, setUsers] = useState<any[]>([]);
    const [loading, setLoading] = useState(true);
    const [promotingId, setPromotingId] = useState<number | null>(null);

    const fetchUsers = async () => {
        setLoading(true);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            const res = await fetch('/api/superadmin/users', {
                headers: { 'Authorization': `Bearer ${tokenResponse.idToken}` }
            });
            const data = await res.json();
            if (res.ok) {
                setUsers(data.users || []);
            }
        } catch(e) {}
        setLoading(false);
    };

    useEffect(() => {
        if (accounts.length > 0 && systemRole === 'SUPERADMIN') {
            fetchUsers();
        } else {
            setLoading(false);
        }
    }, [accounts, systemRole]);

    const handlePromote = async (userId: number) => {
        setPromotingId(userId);
        try {
            const tokenResponse = await instance.acquireTokenSilent({
                scopes: ["User.Read"],
                account: accounts[0]
            });
            const res = await fetch('/api/superadmin/users/promote', {
                method: 'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${tokenResponse.idToken}`
                },
                body: JSON.stringify({ targetUserId: userId })
            });
            const data = await res.json();
            if (res.ok) {
                toast.success(t('promoteSuccess'));
                fetchUsers();
            } else {
                toast.error(data.error || t('promoteError'));
            }
        } catch(e) {
            toast.error(t('promoteError'));
        }
        setPromotingId(null);
    };

    if (systemRole !== 'SUPERADMIN') {
        return <div className="p-6 text-center text-red-600 font-bold">{t('accessDenied')}</div>;
    }

    return (
        <div className="max-w-6xl mx-auto p-6">
            <div className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-bold text-gray-900 font-heading">{t('title')}</h1>
                    <p className="text-gray-500 mt-1">{t('subtitle')}</p>
                </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border border-gray-200 overflow-hidden">
                <table className="min-w-full divide-y divide-gray-200">
                    <thead className="bg-gray-50">
                        <tr>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('email')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('tenant')}</th>
                            <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{t('systemRole')}</th>
                            <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">{t('actions')}</th>
                        </tr>
                    </thead>
                    <tbody className="bg-white divide-y divide-gray-200">
                        {users.map((user) => {
                            const isInternal = user.email.toLowerCase().endsWith("@cscloudsolutions.com.ar");
                            const isSuperAdmin = user.system_role === 'SUPERADMIN';
                            return (
                                <tr key={user.id} className={isInternal ? 'bg-indigo-50/30' : ''}>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <div className="flex items-center">
                                            {isInternal && <Shield className="w-4 h-4 text-indigo-500 mr-2" />}
                                            <span className="text-sm font-medium text-gray-900">{user.email}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500 font-mono">
                                        {user.tenant_id.substring(0,8)}...
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap">
                                        <span className={`px-2 inline-flex text-xs leading-5 font-semibold rounded-full ${isSuperAdmin ? 'bg-red-100 text-red-800' : 'bg-gray-100 text-gray-800'}`}>
                                            {user.system_role || 'USER'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 whitespace-nowrap text-right text-sm font-medium">
                                        {isInternal && !isSuperAdmin ? (
                                            <button
                                                onClick={() => handlePromote(user.id)}
                                                disabled={promotingId === user.id}
                                                className="text-indigo-600 hover:text-indigo-900 bg-indigo-50 hover:bg-indigo-100 px-3 py-1 rounded transition-colors"
                                            >
                                                {promotingId === user.id ? '...' : t('promoteBtn')}
                                            </button>
                                        ) : isSuperAdmin ? (
                                            <span className="text-red-600 flex items-center justify-end">
                                                <ShieldAlert className="w-4 h-4 mr-1" /> God Mode
                                            </span>
                                        ) : (
                                            <span className="text-gray-400">N/A</span>
                                        )}
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
}
