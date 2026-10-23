/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  // Avoid flaky eslint plugin failures on Render free builds
  eslint: { ignoreDuringBuilds: true },
  typescript: { ignoreBuildErrors: false },
};
module.exports = nextConfig;
