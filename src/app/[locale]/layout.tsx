import type { Metadata } from "next";
import { Montserrat, Open_Sans } from "next/font/google";
import "../globals.css";
import { Toaster } from 'sonner';
import { NextIntlClientProvider } from 'next-intl';
import { getMessages } from 'next-intl/server';
import { ThemeProvider } from "@/components/ThemeProvider";
import ClientShell from "@/components/ClientShell";
import CommandPalette from "@/components/CommandPalette";

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
});

const openSans = Open_Sans({
  subsets: ["latin"],
  variable: "--font-opensans",
});

export const metadata: Metadata = {
  title: "CSCloudSolutions FinOps",
  description: "Plataforma automatizada para optimización de costos en Azure y gobernanza cloud.",
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

  return (
    <html lang={locale} suppressHydrationWarning className={`${montserrat.variable} ${openSans.variable}`}>
      <body className="font-sans antialiased text-gray-900 bg-gray-50">
        <NextIntlClientProvider messages={messages}>
          <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
            <Toaster richColors position="bottom-right" theme="system" />
            <ClientShell>
              <CommandPalette />
              {children}
            </ClientShell>
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
