/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone",
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL || "/api/v1",
  },
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: (process.env.INTERNAL_API_URL || "http://127.0.0.1:8000/api") + "/:path*",
      },
    ];
  },
};

export default nextConfig;
