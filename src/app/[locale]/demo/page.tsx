"use client";

import { useState, Suspense } from "react";
import { useSearchParams } from "next/navigation";
import { setDemoSession } from "@/app/_actions/demoAuth";

function DemoForm() {
  const searchParams = useSearchParams();
  const tier = searchParams?.get("tier") || "essential";
  
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (username === "demo" && password === "demo") {
      setError("");
      setLoading(true);
      await setDemoSession(tier);
    } else {
      setError("Credenciales inválidas. Usa demo / demo");
    }
  };

  return (
    <div className="bg-surface/5 backdrop-blur-xl p-8 rounded-[20px] shadow-2xl border border-white/10 w-full max-w-md">
      <div className="flex justify-center mb-6">
        <div className="text-4xl">🚀</div>
      </div>
      <h1 className="text-2xl font-bold text-white mb-2 text-center font-heading">Interactive Demo Login</h1>
      <p className="text-sm text-center text-brand-bright mb-6 uppercase tracking-wider font-semibold">Tier: {tier}</p>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-[#A9BBD0] mb-1">Username</label>
          <input
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            className="w-full bg-white/5 text-white rounded-lg px-4 py-3 border border-white/10 focus:outline-none focus:border-brand-bright"
            placeholder="demo"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-[#A9BBD0] mb-1">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full bg-white/5 text-white rounded-lg px-4 py-3 border border-white/10 focus:outline-none focus:border-brand-bright"
            placeholder="demo"
          />
        </div>
        {error && <p className="text-red-400 text-sm font-medium">{error}</p>}
        <button
          type="submit"
          disabled={loading}
          className="w-full bg-gradient-to-br from-brand-deep to-[#1E88E5] hover:brightness-110 text-white font-bold py-3 px-4 rounded-lg transition-all mt-4 font-heading shadow-[0_6px_16px_rgba(0,84,166,0.4)] disabled:opacity-50"
        >
          {loading ? "Iniciando sesión..." : "Entrar al Demo"}
        </button>
      </form>
    </div>
  );
}

export default function DemoPage() {
  return (
    <div className="min-h-screen bg-gradient-to-br from-nav-bg to-nav-bg2 flex items-center justify-center font-sans relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
            <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] rounded-full bg-brand-deep/20 blur-[100px]"></div>
            <div className="absolute bottom-[10%] right-[-5%] w-[30%] h-[30%] rounded-full bg-brand-bright/10 blur-[80px]"></div>
        </div>
        <Suspense fallback={<div className="text-white">Cargando...</div>}>
            <DemoForm />
        </Suspense>
    </div>
  );
}
