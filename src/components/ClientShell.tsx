"use client";
import React, { useState, createContext } from 'react';
import AuthProvider, { AuthButton } from "./AuthProvider";
import { TenantProvider, useTenant } from './TenantProvider';
import { ViewModeProvider, useViewMode } from '../context/ViewModeContext';
import { LayoutTemplate, Code2, Bell } from 'lucide-react';
import AuthSync from './AuthSync';
import Sidebar from "./Sidebar";
import ActionCenterDrawer from './ActionCenterDrawer';
import { useActionLogStore } from '@/store/actionLogStore';

import { useMsal, useIsAuthenticated } from "@azure/msal-react";

export const TabContext = createContext({ activeTab: 'dashboard', setActiveTab: (t: string) => {} });

export default function ClientShell({ children }: { children: React.ReactNode }) {
  return <AuthProvider>
      <AuthSync />
      <TenantProvider>
        <ViewModeProvider>
        <ShellContent>{children}</ShellContent>
      </ViewModeProvider>
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
          <div className="min-h-screen bg-[#FFFFFF] flex flex-col justify-center py-12 sm:px-6 lg:px-8" style={{ fontFamily: 'var(--font-opensans), sans-serif' }}>
              <div className="sm:mx-auto sm:w-full sm:max-w-md text-center animate-in fade-in zoom-in duration-500">
                  <img 
                      src="/Logo_Nombre_CSCloudSolutions.avif" 
                      alt="CSCloudSolutions Logo" 
                      className="mx-auto h-24 w-auto object-contain drop-shadow-sm"
                  />
                  <h2 className="mt-8 text-center text-3xl font-extrabold text-[#0054A6] tracking-tight" style={{ fontFamily: 'var(--font-montserrat), sans-serif' }}>
                      Cloud FinOps Platform
                  </h2>
                  <p className="mt-3 text-center text-sm text-[#7F7F7F] max-w-sm mx-auto">
                      Plataforma avanzada de Gobernanza, Auditoría Omni-Scan y Optimización Financiera para sus entornos empresariales en Microsoft Azure.
                  </p>
              </div>

              <div className="mt-10 sm:mx-auto sm:w-full sm:max-w-md animate-in fade-in slide-in-from-bottom-8 duration-700 delay-100">
                  <div className="bg-white py-10 px-4 shadow-2xl shadow-blue-900/5 border border-gray-100 sm:rounded-2xl sm:px-10 relative overflow-hidden">
                      {/* Decorative top accent */}
                      <div className="absolute top-0 left-0 w-full h-1.5 bg-gradient-to-r from-[#0054A6] to-[#00AEEF]"></div>
                      
                      <div className="mb-8 text-center">
                          <div className="mx-auto flex items-center justify-center h-16 w-16 rounded-full bg-[#00AEEF]/10 mb-5">
                              <svg className="h-8 w-8 text-[#00AEEF]" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
                              </svg>
                          </div>
                          <h3 className="text-xl font-bold text-[#3C3C3C]" style={{ fontFamily: 'var(--font-montserrat), sans-serif' }}>
                              Acceso Corporativo
                          </h3>
                          <p className="text-sm text-[#7F7F7F] mt-2 leading-relaxed">
                              Por favor identifíquese mediante Microsoft Entra ID para acceder al inventario de su tenant.
                          </p>
                      </div>

                      <div>
                          <button
                              onClick={() => {
                                  instance.loginRedirect({ scopes: ["User.Read", "Directory.Read.All"] })
                                      .catch(e => console.error(e));
                              }}
                              className="w-full flex items-center justify-center py-3.5 px-4 border border-transparent rounded-lg shadow-md shadow-[#0054A6]/20 text-sm font-bold text-white bg-[#0054A6] hover:bg-[#004080] focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-[#0054A6] transition-all transform active:scale-[0.98]"
                              style={{ fontFamily: 'var(--font-montserrat), sans-serif' }}
                          >
                              <svg className="w-5 h-5 mr-3" fill="currentColor" viewBox="0 0 24 24"><path d="M11.4 24H0V12.6h11.4V24zM24 24H12.6V12.6H24V24zM11.4 11.4H0V0h11.4v11.4zm12.6 0H12.6V0H24v11.4z"/></svg>
                              Iniciar sesión con Microsoft
                          </button>
                      </div>
                  </div>
                  
                  <p className="text-center text-xs text-[#7F7F7F] mt-8 tracking-wide">
                      &copy; {new Date().getFullYear()} CSCloudSolutions. Todos los derechos reservados.
                  </p>
              </div>
          </div>
      );
  }

  return (
    <TabContext.Provider value={{ activeTab, setActiveTab }}>
    <div className="min-h-screen bg-gray-50 dark:bg-slate-950 flex text-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <Sidebar sidebarOpen={sidebarOpen} />

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white dark:bg-slate-900 border-b border-gray-200 dark:border-slate-800 flex items-center justify-between px-6 z-10 shadow-sm">
          <div className="flex items-center">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 mr-4 text-gray-400 hover:text-[#0054A6] transition-colors focus:outline-none">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </button>
            <h1 className="text-xl font-bold text-gray-800 dark:text-white hidden sm:block tracking-tight">Cloud FinOps</h1>
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
                
                <div className="hidden md:flex items-center border border-gray-200 dark:border-slate-700 rounded-lg px-2 py-1 bg-gray-50 dark:bg-slate-800 relative">
              {isAdmin ? (
                <div className="flex flex-col px-2">
                  <label htmlFor="tenant-select" className="text-[10px] text-[#00AEEF] font-bold uppercase tracking-wider mb-1">
                    Tenant (Admin Propietario)
                  </label>
                  <select
                    id="tenant-select"
                    value={selectedTenant.id}
                    onChange={(e) => {
                      const found = tenants.find(t => t.id === e.target.value);
                      if (found) setSelectedTenant(found);
                    }}
                    className="text-sm font-semibold text-gray-700 dark:text-gray-200 bg-transparent dark:bg-slate-800 border-none outline-none focus:ring-0 cursor-pointer p-0 m-0"
                  >
                    {tenants.map(t => (
                      <option key={t.id} value={t.id}>{t.name}</option>
                    ))}
                  </select>
                </div>
              ) : (
                <div className="flex flex-col px-2 cursor-not-allowed">
                  <span className="text-[10px] text-gray-500 font-bold uppercase tracking-wider">Mi Entorno (Cliente)</span>
                  <span className="text-sm font-semibold text-gray-700">{selectedTenant.name}</span>
                </div>
              )}
            </div>
            
            {/* View Toggle */}
            <div className="hidden sm:flex items-center bg-gray-100 dark:bg-slate-800 rounded-lg p-1 mr-4 border border-gray-200 dark:border-slate-700">
                <button
                    onClick={() => viewMode !== 'executive' && toggleViewMode()}
                    className={`flex items-center px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${viewMode === 'executive' ? 'bg-white shadow-sm text-indigo-700' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <LayoutTemplate className="w-4 h-4 mr-1.5" />
                    Ejecutivo
                </button>
                <button
                    onClick={() => viewMode !== 'engineer' && toggleViewMode()}
                    className={`flex items-center px-3 py-1.5 text-xs font-bold rounded-md transition-colors ${viewMode === 'engineer' ? 'bg-gray-800 shadow-sm text-green-400' : 'text-gray-500 hover:text-gray-700'}`}
                >
                    <Code2 className="w-4 h-4 mr-1.5" />
                    Ingeniero
                </button>
            </div>
            
            <AuthButton />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-gray-50/50 dark:bg-slate-950/50 p-6">
          {children}
        </main>
      </div>
    </div>
    </TabContext.Provider>
  );
}
