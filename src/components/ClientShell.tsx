"use client";
import React, { useState, createContext } from 'react';
import AuthProvider, { AuthButton } from "./AuthProvider";
import { TenantProvider, useTenant } from './TenantProvider';
import { SubscriptionProvider } from './SubscriptionProvider';
import ScopeSelector from './ScopeSelector';
import { ViewModeProvider, useViewMode } from '../context/ViewModeContext';
import { LayoutTemplate, Code2, Bell } from 'lucide-react';
import { useTranslations } from 'next-intl';
import AuthSync from './AuthSync';
import LanguageSwitcher from './LanguageSwitcher';
import Sidebar from "./Sidebar";
import ActionCenterDrawer from './ActionCenterDrawer';
import { useActionLogStore } from '@/store/actionLogStore';

import { useMsal, useIsAuthenticated } from "@azure/msal-react";

export const TabContext = createContext({ activeTab: 'dashboard', setActiveTab: (t: string) => {} });

export default function ClientShell({ children }: { children: React.ReactNode }) {
  return <AuthProvider>
      <AuthSync />
      <TenantProvider>
        <SubscriptionProvider>
          <ViewModeProvider>
          <ShellContent>{children}</ShellContent>
        </ViewModeProvider>
        </SubscriptionProvider>
      </TenantProvider>
    </AuthProvider>;
}

function ShellContent({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);
    const [drawerOpen, setDrawerOpen] = useState(false);
    const { actions } = useActionLogStore();
  const [activeTab, setActiveTab] = useState('dashboard');
  const { selectedTenant, setSelectedTenant, isAdmin, tenants } = useTenant();
  const { instance, accounts, inProgress } = useMsal();
  const isAuthenticated = useIsAuthenticated();
  const { viewMode, toggleViewMode } = useViewMode();
  const tc = useTranslations('Common');

  const navItems = [
      { id: 'dashboard', label: 'Dashboard', icon: 'M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z' },
      { id: 'audit', label: 'Auditoría Completa', icon: 'M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-3 7h3m-3 4h3m-6-4h.01M9 16h.01' },
      { id: 'tags', label: 'Gestión de Etiquetas', icon: 'M7 7h.01M7 3h5c.512 0 1.024.195 1.414.586l7 7a2 2 0 010 2.828l-7 7a2 2 0 01-2.828 0l-7-7A1.994 1.994 0 013 12V7a4 4 0 014-4z' },
      { id: 'advisor', label: 'Azure Advisor', icon: 'M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z' },
      { id: 'powerbi', label: 'Reportes Power BI', icon: 'M8 13v-1m4 1v-3m4 3V8M8 21l4-4 4 4M3 4h18M4 4h16v12a1 1 0 01-1 1H5a1 1 0 01-1-1V4z' },
      { id: 'config', label: 'Configuración', icon: 'M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z' },
  ];

  if (!isAuthenticated && inProgress !== "startup" && inProgress !== "handleRedirect") {
      return (
          <div className="min-h-screen bg-gradient-to-br from-nav-bg to-nav-bg2 flex flex-col justify-center py-12 sm:px-6 lg:px-8 relative font-sans">
              <div className="absolute top-4 right-4 z-50">
                  <LanguageSwitcher />
              </div>
              
              {/* Animated background elements */}
              <div className="absolute inset-0 overflow-hidden pointer-events-none">
                  <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-brand-deep/20 blur-[100px]"></div>
                  <div className="absolute bottom-[10%] right-[-5%] w-[30%] h-[30%] rounded-full bg-brand-bright/10 blur-[80px]"></div>
              </div>

              <div className="sm:mx-auto sm:w-full sm:max-w-md text-center animate-in fade-in zoom-in duration-500 relative z-10">
                  <div className="flex items-center justify-center mb-6">
                      <img src="/logo_29k.png" alt="Logo" className="w-[48px] h-[48px] object-contain" />
                  </div>
                  <h2 className="mt-2 text-center text-[28px] font-extrabold text-white tracking-tight font-heading">
                      CS<span className="text-brand-bright">Cloud</span>Solutions
                  </h2>
                  <p className="mt-2 text-center text-[13px] tracking-[2px] text-[#62809c] uppercase font-semibold">
                      FinOps Platform
                  </p>
              </div>

              <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-[440px] animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100 relative z-10">
                  <div className="bg-surface/5 backdrop-blur-xl py-10 px-6 sm:px-10 shadow-2xl shadow-black/50 border border-white/10 sm:rounded-[20px] relative overflow-hidden">
                      {/* Decorative top accent */}
                      <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-brand-deep to-brand-bright"></div>
                      
                      <div className="mb-8 text-center">
                          <h3 className="text-[18px] font-bold text-white font-heading">
                              {tc('corporate_access')}
                          </h3>
                          <p className="text-[13.5px] text-[#A9BBD0] mt-2 leading-relaxed">
                              {tc('corporate_access_desc')}
                          </p>
                      </div>

                      <div className="space-y-4">
                          <button
                              onClick={() => {
                                  instance.loginRedirect({ scopes: ["User.Read", "Directory.Read.All"] })
                                      .catch(e => console.error(e));
                              }}
                              className="w-full flex items-center justify-center py-[13px] px-4 border border-transparent rounded-[12px] shadow-[0_6px_16px_rgba(0,84,166,0.4)] text-[14px] font-bold text-white bg-gradient-to-br from-brand-deep to-[#1E88E5] hover:brightness-110 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-nav-bg focus:ring-brand-deep transition-all transform active:scale-[0.98] font-heading"
                          >
                              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24"><path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z"/></svg>
                              {tc('sign_in_microsoft')}
                          </button>

                          <div className="relative py-2">
                              <div className="absolute inset-0 flex items-center">
                                  <div className="w-full border-t border-white/10"></div>
                              </div>
                              <div className="relative flex justify-center text-sm">
                                  <span className="px-2 bg-transparent text-[#62809c] text-xs">{tc('explore_platform')}</span>
                              </div>
                          </div>

                          <a
                              href="/finops-demo.html"
                              target="_blank"
                              rel="noreferrer"
                              className="w-full flex items-center justify-center py-[13px] px-4 border border-white/10 rounded-[12px] shadow-sm text-[14px] font-bold text-white bg-white/5 hover:bg-white/10 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-offset-nav-bg focus:ring-brand-bright transition-all transform active:scale-[0.98] font-heading group"
                          >
                              <span className="text-xl mr-2 group-hover:-translate-y-1 transition-transform">🚀</span>
                              {tc('view_demo')}
                          </a>
                      </div>
                  </div>
                  
                  <p className="text-center text-[11px] text-[#566f8c] mt-8 tracking-wide">
                      &copy; {new Date().getFullYear()} CS Cloud Solutions. {tc('all_rights')}
                  </p>
              </div>
          </div>
      );
  }

  return (
    <TabContext.Provider value={{ activeTab, setActiveTab }}>
    <div className="flex h-screen bg-background text-foreground overflow-hidden relative">
      {/* Mobile Scrim */}
      {sidebarOpen && (
        <div 
          className="fixed inset-0 bg-black/50 z-40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar sidebarOpen={sidebarOpen} setSidebarOpen={setSidebarOpen} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-surface/85 backdrop-blur-md border-b border-line flex items-center justify-between px-6 z-30 shadow-sm sticky top-0">
          <div className="flex items-center">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 mr-4 text-gray-400 hover:text-[#0054A6] transition-colors focus:outline-none">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </button>
            <h1 className="text-xl font-bold text-ink hidden sm:block tracking-tight">Cloud FinOps</h1>
          </div>
          
          <div className="flex items-center space-x-6">
                <button 
                    onClick={() => setDrawerOpen(true)}
                    className="relative p-2 text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 transition-colors mr-2"
                >
                    <Bell className="w-5 h-5" />
                    {actions.length > 0 && (
                        <span className="absolute top-1.5 right-1.5 flex h-2 w-2">
                          <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75"></span>
                          <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500"></span>
                        </span>
                    )}
                </button>
                
            <div className="hidden sm:flex items-center space-x-4">
                <ScopeSelector />
            </div>
            
            {/* View Toggle */}
            <div className="hidden sm:flex items-center bg-surface-2 rounded-lg p-1 mr-4 border border-line">
                <button
                    onClick={() => viewMode !== 'executive' && toggleViewMode()}
                    className={`flex items-center px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${viewMode === 'executive' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <LayoutTemplate className="w-4 h-4 mr-1.5" />
                    {tc('executive')}
                </button>
                <button
                    onClick={() => viewMode !== 'engineer' && toggleViewMode()}
                    className={`flex items-center px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${viewMode === 'engineer' ? 'bg-gray-800 shadow-sm text-green-400' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Code2 className="w-4 h-4 mr-1.5" />
                    {tc('engineer')}
                </button>
            </div>
            
            <LanguageSwitcher />
            <AuthButton />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto p-6 relative">
          {children}
        </main>
      </div>
    </div>
    </TabContext.Provider>
  );
}
