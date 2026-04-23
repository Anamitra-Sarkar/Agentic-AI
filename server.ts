import express from "express";
import { createServer as createViteServer } from "vite";
import { exec, spawn } from "child_process";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Database from "better-sqlite3";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Initialize Database
const db = new Database("architect.db");
db.pragma("foreign_keys = ON");

// Create Tables
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    last_modified INTEGER NOT NULL,
    model_config TEXT DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS files (
    id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    path TEXT NOT NULL,
    content TEXT,
    language TEXT,
    last_modified INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS terminal_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    command TEXT,
    output TEXT,
    timestamp INTEGER NOT NULL,
    FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
  );
`);

const getSessionDir = (sessionId: string) => {
  const dir = path.join("/tmp", `ai-architect-${sessionId}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

async function startServer() {
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));

  // --- RATE LIMITER ---
  const rateLimitMap = new Map<string, { count: number; lastReset: number }>();
  const RATE_LIMIT_WINDOW = 60000; // 1 minute
  const MAX_REQUESTS = 60;

  const rateLimiter = (req: any, res: any, next: any) => {
    const ip = req.ip || req.connection.remoteAddress || 'unknown';
    const now = Date.now();
    const limitData = rateLimitMap.get(ip) || { count: 0, lastReset: now };

    if (now - limitData.lastReset > RATE_LIMIT_WINDOW) {
      limitData.count = 1;
      limitData.lastReset = now;
    } else {
      limitData.count++;
    }

    rateLimitMap.set(ip, limitData);

    if (limitData.count > MAX_REQUESTS) {
      return res.status(429).json({ error: "Rate limit exceeded. Max 60 requests per minute." });
    }
    next();
  };

  // --- PROXY ENDPOINTS ---
  const proxyRequest = async (url: string, key: string | undefined, body: any, extraHeaders = {}) => {
    if (!key) throw new Error("API Key not configured on server.");
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${key}`,
        ...extraHeaders
      },
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const errorText = await res.text();
      const err = new Error(`Upstream API Error: ${res.status} ${res.statusText}`);
      (err as any).status = res.status;
      (err as any).body = errorText;
      throw err;
    }
    return await res.json();
  };

  app.post("/api/proxy/groq", rateLimiter, async (req, res) => {
    try {
      const data = await proxyRequest("https://api.groq.com/openai/v1/chat/completions", process.env.GROQ_API_KEY, req.body);
      res.json(data);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message, body: err.body });
    }
  });

  app.post("/api/proxy/openrouter", rateLimiter, async (req, res) => {
    try {
      const data = await proxyRequest("https://openrouter.ai/api/v1/chat/completions", process.env.OPENROUTER_API_KEY, req.body, {
        "HTTP-Referer": "https://ai-architect.demo",
        "X-Title": "AI Architect"
      });
      res.json(data);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message, body: err.body });
    }
  });

  app.post("/api/proxy/nvidia", rateLimiter, async (req, res) => {
    try {
      const data = await proxyRequest("https://integrate.api.nvidia.com/v1/chat/completions", process.env.NVIDIA_API_KEY, req.body);
      res.json(data);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message, body: err.body });
    }
  });

  // API v1 - IDE Backend
  app.post("/api/v1/write", async (req, res) => {
    try {
      const { files, sessionId } = req.body;
      const baseDir = sessionId ? getSessionDir(sessionId) : process.cwd();
      
      for (const [filePath, content] of Object.entries(files)) {
        const fullPath = path.join(baseDir, filePath as string);
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

  app.post("/api/terminal/execute", async (req, res) => {
    const { command, sessionId, timeout = 30000 } = req.body;
    const cwd = getSessionDir(sessionId);
    
    const child = spawn('/bin/bash', ['-c', command], { 
      cwd,
      env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin` }
    });

    let stdout = '';
    let stderr = '';
    
    const timer = setTimeout(() => {
      child.kill();
      res.status(408).json({ error: "Execution timed out" });
    }, timeout);

    child.stdout.on('data', (data) => stdout += data);
    child.stderr.on('data', (data) => stderr += data);

    child.on('close', (code) => {
      clearTimeout(timer);
      res.json({ stdout, stderr, exit_code: code });
    });
  });

  app.post("/api/terminal/execute-stream", (req, res) => {
    const { command, sessionId } = req.body;
    const cwd = getSessionDir(sessionId);

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive'
    });

    const child = spawn('/bin/bash', ['-c', command], { 
      cwd,
      env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin` }
    });

    const send = (data: any) => res.write(`data: ${JSON.stringify(data)}\n\n`);

    child.stdout.on('data', (data) => send({ type: 'stdout', content: data.toString() }));
    child.stderr.on('data', (data) => send({ type: 'stderr', content: data.toString() }));
    
    child.on('close', (code) => {
      send({ type: 'exit', code });
      res.end();
    });

    req.on('close', () => child.kill());
  });

  app.post("/api/terminal/verify", async (req, res) => {
    const { sessionId, filePath } = req.body;
    const cwd = getSessionDir(sessionId);
    const fullPath = path.join(cwd, filePath);
    const ext = path.extname(filePath);

    let verifyCmd = '';
    if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
      verifyCmd = `npx esbuild "${fullPath}" --bundle --dry-run`;
    } else if (ext === '.py') {
      verifyCmd = `python3 -m py_compile "${fullPath}"`;
    }

    if (!verifyCmd) return res.json({ success: true, errors: [] });

    exec(verifyCmd, { cwd }, (err, stdout, stderr) => {
      res.json({
        success: !err,
        errors: err ? [stderr || stdout] : []
      });
    });
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

  // --- PERSISTENCE API ---

  // 1. Create a new session
  app.post("/api/sessions", (req, res) => {
    const { name, modelConfig } = req.body;
    const id = uuidv4();
    const now = Date.now();
    const config = JSON.stringify(modelConfig || {});
    
    try {
      const stmt = db.prepare("INSERT INTO sessions (id, name, created_at, last_modified, model_config) VALUES (?, ?, ?, ?, ?)");
      stmt.run(id, name || "Untitled Project", now, now, config);
      res.json({ id, name, created_at: now, last_modified: now, model_config: modelConfig || {} });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. List all sessions
  app.get("/api/sessions", (req, res) => {
    try {
      const sessions = db.prepare("SELECT * FROM sessions ORDER BY last_modified DESC").all();
      res.json(sessions.map((s: any) => ({ ...s, model_config: JSON.parse(s.model_config) })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Get session with metadata
  app.get("/api/sessions/:id", (req, res) => {
    try {
      const session = db.prepare("SELECT * FROM sessions WHERE id = ?").get(req.params.id);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json({ ...session as object, model_config: JSON.parse((session as any).model_config) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Update session metadata
  app.put("/api/sessions/:id", (req, res) => {
    const { name, modelConfig } = req.body;
    const now = Date.now();
    try {
      const stmt = db.prepare("UPDATE sessions SET name = COALESCE(?, name), model_config = COALESCE(?, model_config), last_modified = ? WHERE id = ?");
      stmt.run(name, modelConfig ? JSON.stringify(modelConfig) : null, now, req.params.id);
      res.json({ status: "ok", last_modified: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Delete session
  app.delete("/api/sessions/:id", (req, res) => {
    try {
      db.prepare("DELETE FROM sessions WHERE id = ?").run(req.params.id);
      res.json({ status: "ok" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Save a file to a session
  app.post("/api/sessions/:id/files", (req, res) => {
    const { path: filePath, content, language } = req.body;
    const sessionId = req.params.id;
    const id = uuidv4();
    const now = Date.now();
    try {
      const stmt = db.prepare("INSERT INTO files (id, session_id, path, content, language, last_modified) VALUES (?, ?, ?, ?, ?, ?)");
      stmt.run(id, sessionId, filePath, content, language, now);
      
      // Update session last_modified
      db.prepare("UPDATE sessions SET last_modified = ? WHERE id = ?").run(now, sessionId);
      
      res.json({ id, path: filePath, content, language, last_modified: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. Get all files in a session
  app.get("/api/sessions/:id/files", (req, res) => {
    try {
      const files = db.prepare("SELECT * FROM files WHERE session_id = ?").all();
      res.json(files);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8. Update file content
  app.put("/api/sessions/:id/files/:fileId", (req, res) => {
    const { content } = req.body;
    const now = Date.now();
    try {
      db.prepare("UPDATE files SET content = ?, last_modified = ? WHERE id = ?").run(content, now, req.params.fileId);
      db.prepare("UPDATE sessions SET last_modified = ? WHERE id = ?").run(now, req.params.id);
      res.json({ status: "ok", last_modified: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 9. Append terminal history
  app.post("/api/sessions/:id/terminal-history", (req, res) => {
    const { command, output } = req.body;
    const now = Date.now();
    try {
      db.prepare("INSERT INTO terminal_history (session_id, command, output, timestamp) VALUES (?, ?, ?, ?)").run(req.params.id, command, output, now);
      res.json({ status: "ok", timestamp: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 10. Get terminal history
  app.get("/api/sessions/:id/terminal-history", (req, res) => {
    try {
      const history = db.prepare("SELECT * FROM terminal_history WHERE session_id = ? ORDER BY timestamp DESC LIMIT 100").all();
      res.json(history.reverse());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
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
