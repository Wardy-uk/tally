module.exports = {
  apps: [
    {
      name: 'tally',
      script: 'dist/server/index.js',
      cwd: __dirname,
      instances: 1,
      exec_mode: 'fork',
      node_args: ['--no-warnings'],
      env: {
        NODE_ENV: 'production',
        PORT: 3002,
      },
      max_memory_restart: '400M',
      error_file: 'logs/err.log',
      out_file: 'logs/out.log',
      merge_logs: true,
      time: true,
      autorestart: true,
      watch: false,
    },
  ],
};
