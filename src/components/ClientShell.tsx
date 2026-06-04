"use client";
import React, { useState } from 'react';
import AdminConsentButton from "./AdminConsentButton";

export default function ClientShell({ children }: { children: React.ReactNode }) {
  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden">
      {/* Sidebar */}
      <aside className={`${isSidebarOpen ? 'w-64' : 'w-20'} transition-all duration-300 bg-white border-r border-gray-200 flex flex-col`}>
        <div className="h-16 flex items-center justify-center border-b border-gray-200">
          <span className="font-bold text-[var(--color-primary)] text-xl truncate px-2">
            {isSidebarOpen ? 'CSCloud FinOps' : 'CS'}
          </span>
        </div>
        <nav className="flex-1 p-4 space-y-2">
          <a href="#" className="flex items-center gap-3 p-2 bg-blue-50 text-[var(--color-primary)] rounded-md font-medium">
            <span className="text-xl">📊</span>
            {isSidebarOpen && <span>Dashboard</span>}
          </a>
          <a href="#" className="flex items-center gap-3 p-2 hover:bg-gray-50 text-gray-700 rounded-md transition-colors">
            <span className="text-xl">⚡</span>
            {isSidebarOpen && <span>Quick Wins</span>}
          </a>
        </nav>
      </aside>

      {/* Main Content */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Navbar */}
        <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6">
          <button 
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="text-gray-500 hover:text-[var(--color-primary)] transition-colors"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          </button>
          
          <div className="flex items-center gap-4">
            <select className="border border-gray-300 rounded-md text-sm p-1.5 focus:outline-none focus:border-[var(--color-primary)] bg-white text-gray-700 cursor-pointer">
              <option>Tenant: Banco Ciudad</option>
              <option>Tenant: Asmepriv</option>
              <option>Tenant: Ctrl365</option>
            </select>
            <AdminConsentButton />
            <button className="bg-[var(--color-primary)] text-white px-4 py-2 rounded-md text-sm font-medium hover:bg-blue-800 transition-colors shadow-sm">
              Iniciar sesión con Microsoft
            </button>
          </div>
        </header>

        {/* Page Content */}
        <main className="flex-1 overflow-y-auto p-6">
          {children}
        </main>
      </div>
    </div>
  );
}
