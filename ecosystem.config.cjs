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
