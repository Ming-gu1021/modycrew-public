/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  distDir: process.env.MODYCREW_NEXT_DIST_DIR || ".next",
  images: { unoptimized: true },
  trailingSlash: true,
  reactStrictMode: true,
  typedRoutes: false,
  experimental: { cpus: 1 },
};
export default nextConfig;
