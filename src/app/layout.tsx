import type { Metadata } from "next";
import { Montserrat, Open_Sans } from "next/font/google";
import "./globals.css";
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
    <html lang="es" className={`${montserrat.variable} ${openSans.variable}`}>
      <body className="font-sans antialiased text-gray-900 bg-gray-50">
        <ClientShell>
          <CommandPalette />
          {children}
        </ClientShell>
      </body>
    </html>
  );
}
