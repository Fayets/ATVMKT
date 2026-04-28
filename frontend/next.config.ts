import type { NextConfig } from 'next'

const backendInternal =
  (process.env.BACKEND_INTERNAL_URL || 'http://127.0.0.1:8000').replace(/\/$/, '')

const nextConfig: NextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  // Activa el MCP server en /_next/mcp (Next.js 16+)
  experimental: {
    mcpServer: true,
  },
  async rewrites() {
    return [
      {
        source: '/api-backend/:path*',
        destination: `${backendInternal}/:path*`,
      },
    ]
  },
}

export default nextConfig
