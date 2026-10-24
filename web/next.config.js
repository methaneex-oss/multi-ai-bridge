/** @type {import('next').NextConfig} */
const nextConfig = {
  // Netlify Next plugin handles output; standalone is for Docker/Render only
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: true },
};

module.exports = nextConfig;
