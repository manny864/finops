import React, { useState } from 'react';
import { useTranslations } from 'next-intl';

export default function EnterpriseLeadModal({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const t = useTranslations('pricing.enterpriseModal');
  const [formData, setFormData] = useState({
    fullName: '',
    email: '',
    company: '',
    spend: '<$5k',
    requirements: ''
  });
  const [loading, setLoading] = useState(false);
  const [success, setSuccess] = useState(false);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formData.email.match(/^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/)) {
        alert(t('invalidEmail'));
        return;
    }
    setLoading(true);
    try {
        const res = await fetch('/api/leads', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(formData)
        });
        if (res.ok) {
            setSuccess(true);
            setTimeout(() => {
                onClose();
                setSuccess(false);
                setFormData({ fullName: '', email: '', company: '', spend: '<$5k', requirements: '' });
            }, 3000);
        } else {
            alert(t('error'));
        }
    } catch {
        alert(t('error'));
    } finally {
        setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white dark:bg-slate-900 rounded-2xl shadow-xl w-full max-w-lg overflow-hidden relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-gray-500 hover:text-gray-700">&times;</button>
        <div className="p-8">
          {success ? (
             <div className="text-center py-8">
                <h3 className="text-2xl font-bold text-green-600 mb-2">{t('successTitle')}</h3>
                <p className="text-gray-600">{t('successMessage')}</p>
             </div>
          ) : (
            <>
              <h2 className="text-2xl font-bold text-gray-900 mb-6">{t('title')}</h2>
              <form onSubmit={handleSubmit} className="space-y-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('fullName')}</label>
                  <input required type="text" className="w-full text-gray-900 border-gray-300 rounded-lg p-2 border focus:ring-brand-deep focus:border-brand-deep" value={formData.fullName} onChange={e => setFormData({...formData, fullName: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('email')}</label>
                  <input required type="email" placeholder="name@company.com" className="w-full text-gray-900 border-gray-300 rounded-lg p-2 border focus:ring-brand-deep focus:border-brand-deep" value={formData.email} onChange={e => setFormData({...formData, email: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('company')}</label>
                  <input required type="text" className="w-full text-gray-900 border-gray-300 rounded-lg p-2 border focus:ring-brand-deep focus:border-brand-deep" value={formData.company} onChange={e => setFormData({...formData, company: e.target.value})} />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('spend')}</label>
                  <select className="w-full text-gray-900 border-gray-300 rounded-lg p-2 border focus:ring-brand-deep focus:border-brand-deep" value={formData.spend} onChange={e => setFormData({...formData, spend: e.target.value})}>
                    <option value="<$5k">&lt;$5k</option>
                    <option value="$5k-$20k">$5k-$20k</option>
                    <option value="$20k-$50k">$20k-$50k</option>
                    <option value=">$50k">&gt;$50k</option>
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">{t('requirements')}</label>
                  <textarea rows={3} className="w-full text-gray-900 border-gray-300 rounded-lg p-2 border focus:ring-brand-deep focus:border-brand-deep" value={formData.requirements} onChange={e => setFormData({...formData, requirements: e.target.value})}></textarea>
                </div>
                <button type="submit" disabled={loading} className="w-full bg-brand-deep text-white rounded-lg py-3 px-4 font-bold hover:bg-brand-bright transition-colors">
                  {loading ? t('submitting') : t('submit')}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
