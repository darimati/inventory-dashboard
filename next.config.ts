import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: ["*.trycloudflare.com"],
  experimental: {
    optimizePackageImports: ['date-fns', 'xlsx'],
  },
  async redirects() {
    return [
      { source: '/sales', destination: '/commerce/sales', permanent: true },
      { source: '/products', destination: '/commerce/products', permanent: true },
      { source: '/inventory', destination: '/commerce/inventory', permanent: true },
      { source: '/settlements', destination: '/commerce/settlements', permanent: true },
      { source: '/settings', destination: '/commerce/settings', permanent: true },
    ];
  },
};

export default nextConfig;
