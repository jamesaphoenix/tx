import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    // Custom API proxy plugin using fetch
    {
      name: 'api-proxy',
      configureServer(server) {
        server.middlewares.use('/api', async (req, res, next) => {
          try {
            const url = `http://127.0.0.1:3456/api${req.url}`
            const response = await fetch(url, {
              method: req.method,
              headers: {
                'Content-Type': 'application/json',
                ...Object.fromEntries(
                  Object.entries(req.headers).filter(([k]) =>
                    !['host', 'connection'].includes(k.toLowerCase())
                  )
                ),
              },
              body: req.method !== 'GET' && req.method !== 'HEAD'
                ? await new Promise<string>((resolve) => {
                    let data = ''
                    req.on('data', chunk => data += chunk)
                    req.on('end', () => resolve(data))
                  })
                : undefined,
            })

            res.statusCode = response.status
            response.headers.forEach((value, key) => {
              if (!['content-encoding', 'transfer-encoding'].includes(key.toLowerCase())) {
                res.setHeader(key, value)
              }
            })
            res.end(await response.text())
          } catch (error) {
            console.error('Proxy error:', error)
            res.statusCode = 502
            res.end('Proxy error: ' + (error as Error).message)
          }
        })
      }
    }
  ],
})
