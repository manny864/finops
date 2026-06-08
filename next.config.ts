import createNextIntlPlugin from 'next-intl/plugin';
const withNextIntl = createNextIntlPlugin('./src/i18n.ts');

import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: 'standalone',
  distDir: process.env.PORT ? `.next-${process.env.PORT}` : '.next',
  /* config options here */
};

export default withNextIntl(nextConfig);
