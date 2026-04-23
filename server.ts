import express from "express";
import { createServer as createViteServer } from "vite";
import { exec } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // API v1 - IDE Backend
  app.post("/api/v1/write", async (req, res) => {
    try {
      const { files } = req.body;
      for (const [filePath, content] of Object.entries(files)) {
        const fullPath = path.join(process.cwd(), filePath as string);
        const dir = path.dirname(fullPath);
        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true });
        }
        fs.writeFileSync(fullPath, content as string);
      }
      res.json({ status: "ok" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/v1/execute", async (req, res) => {
    const { command, workdir } = req.body;
    const cwd = path.join(process.cwd(), workdir || ".");
    
    // Power Terminal: Force bash for better path resolution and alias support
    const shellCommand = process.platform === 'win32' ? command : `/bin/bash -c ${JSON.stringify(command)}`;

    exec(shellCommand, { 
      cwd,
      env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin` }
    }, (error, stdout, stderr) => {
      res.json({
        stdout,
        stderr,
        exit_code: error ? (error.code || 1) : 0,
      });
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`AI Architect Server running on http://localhost:${PORT}`);
  });
}

startServer();
