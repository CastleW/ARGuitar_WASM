import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

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
    }
  ],
  optimizeDeps: {
    exclude: ['@mediapipe/tasks-vision']
  }
})
