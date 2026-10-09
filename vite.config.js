import fs from 'node:fs'
import path from 'node:path'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Dev-only endpoint used by the ArUco Session Recorder (src/utils/session_recorder.js).
// POST /__recordings/save?file=<name> streams the request body into ./recordings/<name>.
// Production builds have no such endpoint, so the recorder falls back to browser downloads.
const ALLOWED_RECORDING_EXT = /\.(webm|mp4|jsonl|json)$/i;

function recordingsPlugin() {
  return {
    name: 'arguitar-recordings',
    configureServer(server) {
      const recordingsDir = path.resolve(server.config.root, 'recordings');
      server.middlewares.use('/__recordings/save', (req, res) => {
        if (req.method !== 'POST') {
          res.statusCode = 405;
          res.end('Method Not Allowed');
          return;
        }
        const url = new URL(req.url || '/', 'http://localhost');
        const requested = url.searchParams.get('file') || '';
        const safeName = path.basename(requested).replace(/[^\w.-]/g, '_');
        if (!safeName || !ALLOWED_RECORDING_EXT.test(safeName)) {
          res.statusCode = 400;
          res.end('Invalid file name');
          return;
        }
        fs.mkdirSync(recordingsDir, { recursive: true });
        const outPath = path.join(recordingsDir, safeName);
        const out = fs.createWriteStream(outPath);
        req.pipe(out);
        out.on('finish', () => {
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ ok: true, path: `recordings/${safeName}` }));
        });
        out.on('error', (err) => {
          res.statusCode = 500;
          res.end(String(err));
        });
      });
    }
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'configure-mime-types',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url && req.url.endsWith('.task')) {
            res.setHeader('Content-Type', 'application/octet-stream');
          }
          next();
        });
      }
    },
    recordingsPlugin()
  ],
  server: {
    watch: {
      // Large recording files should never trigger HMR / file-watcher churn
      ignored: ['**/recordings/**']
    }
  },
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision']
  }
})
