"use client";
import React, { useState } from 'react';
import AuthProvider, { AuthButton } from "./AuthProvider";

export default function ClientShell({ children }: { children: React.ReactNode }) {
  return <AuthProvider><ShellContent>{children}</ShellContent></AuthProvider>;
}

function ShellContent({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(true);

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-900 flex text-gray-900 dark:text-gray-100">
      {/* Sidebar */}
      <aside className={`${sidebarOpen ? 'w-64' : 'w-20'} bg-white dark:bg-gray-800 border-r border-gray-200 dark:border-gray-700 transition-all duration-300 flex flex-col`}>
        <div className="h-16 flex items-center justify-center border-b border-gray-200 dark:border-gray-700 px-4">
          <div className="flex items-center justify-center overflow-hidden w-full h-full">
             {sidebarOpen ? (
                <img src="/logo.png" alt="CSCloudSolutions FinOps" className="h-10 w-auto object-contain" />
             ) : (
                <div className="w-10 h-10 bg-[#0054A6] rounded-md flex items-center justify-center text-white font-bold text-xl shadow-sm">CS</div>
             )}
          </div>
        </div>
        <nav className="flex-1 py-6 px-3 space-y-2 overflow-y-auto">
          {/* Navigation Items */}
          <a href="#" className="flex items-center space-x-3 px-3 py-2.5 bg-blue-50 dark:bg-blue-900/20 text-[#0054A6] dark:text-[#00AEEF] rounded-lg font-semibold transition-colors">
            <svg className="w-5 h-5 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z"></path></svg>
            {sidebarOpen && <span>Dashboard Central</span>}
          </a>
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col min-w-0">
        <header className="h-16 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 flex items-center justify-between px-6 z-10 shadow-sm">
          <div className="flex items-center">
            <button onClick={() => setSidebarOpen(!sidebarOpen)} className="p-2 mr-4 text-gray-400 hover:text-[#0054A6] dark:hover:text-white transition-colors focus:outline-none">
              <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 12h16M4 18h16"></path></svg>
            </button>
            <h1 className="text-xl font-bold text-gray-800 dark:text-white hidden sm:block tracking-tight">Cloud FinOps</h1>
          </div>
          
          <div className="flex items-center space-x-6">
            {/* Tenant Selector (Admin CS Only) */}
            <div className="hidden md:flex items-center border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 bg-gray-50/50 dark:bg-gray-800 relative group cursor-not-allowed">
              <div className="flex flex-col">
                 <span className="text-[10px] text-[#00AEEF] font-bold uppercase tracking-wider">Tenant (Admin Propietario)</span>
                 <span className="text-sm font-semibold text-gray-700 dark:text-gray-300">CSCloudSolutions Global</span>
              </div>
              <svg className="w-4 h-4 ml-3 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 9l-7 7-7-7"></path></svg>
            </div>
            
            {/* Functional Login Button directly from AuthProvider */}
            <AuthButton />
          </div>
        </header>

        <main className="flex-1 overflow-y-auto bg-gray-50/50 dark:bg-gray-900 p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
