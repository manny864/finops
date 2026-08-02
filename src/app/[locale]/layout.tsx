import type { Metadata } from "next";
import { Montserrat, Open_Sans } from "next/font/google";
import "../globals.css";
import { Toaster } from 'sonner';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { ThemeProvider } from "@/components/ThemeProvider";
import ClientShell from "@/components/ClientShell";
import CommandPalette from "@/components/CommandPalette";
import GlobalCopilot from "@/components/GlobalCopilot";
import BrowserNotificationProvider from "@/components/BrowserNotificationProvider";
import { cookies } from 'next/headers';

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
});

const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-opensans",
});

// Developer Note: If the favicon does not update immediately, please forcefully clear your browser cache or do a hard refresh (Ctrl + F5), as browsers aggressively cache favicons.
export const metadata: Metadata = {
  title: "CSCloudSolutions FinOps",
  description: "Plataforma automatizada para optimización de costos en Azure y gobernanza cloud.",
  manifest: "/manifest.webmanifest",
  // iOS no usa el manifest para "Agregar a inicio": necesita estas metas para
  // abrir a pantalla completa con el ícono correcto.
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "FinOps",
  },
  icons: {
    // Explícito porque el `icons` de metadata pisa la convención de archivo
    // (src/app/icon.png) en vez de fusionarse con ella — sin esto, agregar
    // solo `apple` acá borra el favicon normal (bug real: pasó en d13fabd).
    icon: [{ url: "/icon.png", type: "image/png" }],
    apple: "/icons/apple-touch-icon.png",
  },
};

export default async function RootLayout({
  children,
  params,
}: Readonly<{
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}>) {
  const { locale } = await params;
  const messages = await getMessages();

  const cookieStore = await cookies();
  const demoCookie = cookieStore.get('finops_demo_session');
  let demoSession = null;
  if (demoCookie) {
    try {
      demoSession = JSON.parse(demoCookie.value);
    } catch(e) {}
  }

  return (
    <html lang={locale} suppressHydrationWarning className={`${montserrat.variable} ${openSans.variable}`}>
      <body className="font-sans antialiased text-gray-900 bg-gray-50">
        <NextIntlClientProvider messages={messages} locale={locale}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <Toaster richColors position="bottom-right" theme="system" />
            <ClientShell demoSession={demoSession}>
              <CommandPalette />
              {children}
              <GlobalCopilot />
              <BrowserNotificationProvider />
            </ClientShell>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
