import type { Metadata } from "next";
import { Montserrat, Open_Sans } from "next/font/google";
import "./globals.css";
import { Toaster } from 'sonner';
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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" suppressHydrationWarning className={`${montserrat.variable} ${openSans.variable}`}>
      <body className="font-sans antialiased text-gray-900 bg-gray-50">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Toaster richColors position="bottom-right" theme="system" />
          <ClientShell>
          <CommandPalette />
          {children}
        </ClientShell>
          </ThemeProvider>
      </body>
    </html>
  );
}
