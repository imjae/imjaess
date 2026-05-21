/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ["@openai/agents", "better-sqlite3"]
};

export default nextConfig;
