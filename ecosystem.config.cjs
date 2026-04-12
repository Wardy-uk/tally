module.exports = {
  apps: [
    {
      name: 'tally',
      script: 'node_modules/tsx/dist/cli.mjs',
      args: '--no-warnings src/server/index.ts',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      env: {
        NODE_ENV: 'production',
        PORT: 3003,
        // Tailscale Serve's /tally mount strips the prefix before forwarding,
        // so the Express app serves /api/* directly.
        API_PREFIX: '',
        // Where the OAuth callback should redirect after TrueLayer consent.
        FRONTEND_URL: 'https://tally.nickward.co.uk',
      },
      max_memory_restart: '500M',
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      time: true,
      autorestart: true,
      watch: false,
    },
  ],
};
