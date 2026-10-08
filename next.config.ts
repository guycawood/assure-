import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // PGlite (demo mode only) ships WebAssembly; load it from node_modules rather than bundling it.
  serverExternalPackages: ["@electric-sql/pglite"],
  // Lets demo mode find supabase/ regardless of the directory the server was started from.
  env: { ASSURE_ROOT: __dirname },
};

export default nextConfig;
