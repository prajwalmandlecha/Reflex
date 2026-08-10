/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  eslint: {
    ignoreDuringBuilds: true,
  },
  images: { unoptimized: true },
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    return [
      {
        source: '/api/v1/:path*',
        destination: `${backendUrl}/api/v1/:path*`,
      },
      // Proxy WebSocket upgrades to the backend so the live telemetry
      // streams (/ws/activity, /ws/metrics, /ws/alerts, /ws/fleet) work
      // through the same-origin frontend. Without this, the frontend has no
      // route for /ws/* and the sockets fail (UI falls back to "Polling").
      {
        source: '/ws/:path*',
        destination: `${backendUrl}/ws/:path*`,
      },
    ];
  },
};

module.exports = nextConfig;

