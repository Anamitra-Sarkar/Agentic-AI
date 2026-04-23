import express from "express";
import { createServer as createViteServer } from "vite";
import { exec, spawn } from "child_process";
import * as cheerio from "cheerio";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { createClient } from "@libsql/client";
import { v4 as uuidv4 } from "uuid";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const db = createClient({
  url: process.env.TURSO_DATABASE_URL!,
  authToken: process.env.TURSO_AUTH_TOKEN!,
});

const getSessionDir = (sessionId: string) => {
  const dir = path.join("/tmp", `ai-architect-${sessionId}`);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
};

type DbRow = Record<string, any>;

declare global {
  namespace Express {
    interface Request {
      userId?: string;
    }
  }
}

const execute = async (sql: string, args: any[] = []) => db.execute({ sql, args });
const getRows = async <T extends DbRow = DbRow>(sql: string, args: any[] = []) =>
  ((await execute(sql, args)).rows as unknown as T[]);
const getRow = async <T extends DbRow = DbRow>(sql: string, args: any[] = []) =>
  (((await execute(sql, args)).rows[0] as unknown) as T | undefined);
const run = async (sql: string, args: any[] = []) => execute(sql, args);
const initSchema = async () => {
  await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
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

    CREATE TABLE IF NOT EXISTS checkpoints (
      session_id TEXT PRIMARY KEY,
      phase TEXT NOT NULL,
      files TEXT NOT NULL,
      chat_history TEXT NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
    );
  `);
};

// --- PREVIEW SYSTEM ---
const previewProcesses = new Map<string, { process: any; port: number }>();

async function startServer() {
  await initSchema();
  const app = express();
  const PORT = 3000;

  app.use(express.json({ limit: '50mb' }));
  app.use("/api/sessions", (req, _res, next) => {
    req.userId = req.header("X-User-Id") || undefined;
    next();
  });

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

  app.post("/api/proxy/tavily", rateLimiter, async (req, res) => {
    try {
      const { query } = req.body;
      const data = await proxyRequest("https://api.tavily.com/search", process.env.TAVILY_API_KEY, {
        api_key: process.env.TAVILY_API_KEY,
        query
      });
      res.json(data);
    } catch (err: any) {
      res.status(err.status || 500).json({ error: err.message, body: err.body });
    }
  });

  app.post("/api/scrape", async (req, res) => {
    try {
      const { url } = req.body;
      const response = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; AI-Architect-Bot/1.0)' }
      });
      const html = await response.text();
      const $ = cheerio.load(html);

      const title = $('title').text();
      const metaDescription = $('meta[name="description"]').attr('content') || '';
      const headings = $('h1, h2, h3').map((_, el) => $(el).text().trim()).get().slice(0, 20);
      const bodyText = $('body').text().replace(/\s+/g, ' ').trim().substring(0, 3000);
      
      const colors = [...new Set(html.match(/#[0-9a-fA-F]{3,6}|rgb\([^)]+\)/g) || [])].slice(0, 10);
      const fonts = [...new Set(html.match(/font-family:[^;]+;/g) || [])].map(f => f.replace('font-family:', '').replace(';', '').trim()).slice(0, 10);
      
      const sections = $('section, main, article, header, footer, nav').map((_, el) => ({
        tag: el.tagName,
        classes: $(el).attr('class'),
        text: $(el).children().first().text().replace(/\s+/g, ' ').trim().substring(0, 100)
      })).get().slice(0, 15);

      const imageUrls = $('img').map((_, el) => $(el).attr('src')).get().slice(0, 10);
      const links = $('a').map((_, el) => $(el).text().trim()).get().filter(Boolean).slice(0, 20);

      res.json({
        title,
        metaDescription,
        headings,
        bodyText,
        colors,
        fonts,
        sections,
        imageUrls,
        links
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
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
  app.post("/api/sessions", async (req, res) => {
    const { name, modelConfig, userId: bodyUserId } = req.body;
    const userId = req.userId || bodyUserId;
    if (!userId) return res.status(400).json({ error: "Missing user id" });
    const id = uuidv4();
    const now = Date.now();
    const config = JSON.stringify(modelConfig || {});
    
    try {
      await run("INSERT INTO sessions (id, user_id, name, created_at, last_modified, model_config) VALUES (?, ?, ?, ?, ?, ?)", [
        id,
        userId,
        name || "Untitled Project",
        now,
        now,
        config,
      ]);
      res.json({ id, name, created_at: now, last_modified: now, model_config: modelConfig || {} });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 2. List all sessions
  app.get("/api/sessions", async (req, res) => {
    try {
      const sessions = await getRows("SELECT * FROM sessions WHERE user_id = ? ORDER BY last_modified DESC", [req.userId || ""]);
      res.json(sessions.map((s: any) => ({ ...s, model_config: JSON.parse(s.model_config) })));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 3. Get session with metadata
  app.get("/api/sessions/:id", async (req, res) => {
    try {
      const session = await getRow("SELECT * FROM sessions WHERE id = ? AND user_id = ?", [req.params.id, req.userId || ""]);
      if (!session) return res.status(404).json({ error: "Session not found" });
      res.json({ ...session as object, model_config: JSON.parse((session as any).model_config) });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 4. Update session metadata
  app.put("/api/sessions/:id", async (req, res) => {
    const { name, modelConfig } = req.body;
    const now = Date.now();
    try {
      await run("UPDATE sessions SET name = COALESCE(?, name), model_config = COALESCE(?, model_config), last_modified = ? WHERE id = ? AND user_id = ?", [
        name,
        modelConfig ? JSON.stringify(modelConfig) : null,
        now,
        req.params.id,
        req.userId || "",
      ]);
      res.json({ status: "ok", last_modified: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 5. Delete session
  app.delete("/api/sessions/:id", async (req, res) => {
    try {
      await run("DELETE FROM sessions WHERE id = ? AND user_id = ?", [req.params.id, req.userId || ""]);
      res.json({ status: "ok" });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 6. Save a file to a session
  app.post("/api/sessions/:id/files", async (req, res) => {
    const { path: filePath, content, language } = req.body;
    const sessionId = req.params.id;
    const id = uuidv4();
    const now = Date.now();
    try {
      const session = await getRow("SELECT id FROM sessions WHERE id = ? AND user_id = ?", [sessionId, req.userId || ""]);
      if (!session) return res.status(404).json({ error: "Session not found" });
      await run("INSERT INTO files (id, session_id, path, content, language, last_modified) VALUES (?, ?, ?, ?, ?, ?)", [
        id,
        sessionId,
        filePath,
        content,
        language,
        now,
      ]);
      
      // Update session last_modified
      await run("UPDATE sessions SET last_modified = ? WHERE id = ? AND user_id = ?", [now, sessionId, req.userId || ""]);
      
      res.json({ id, path: filePath, content, language, last_modified: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 7. Get all files in a session
  app.get("/api/sessions/:id/files", async (req, res) => {
    try {
      const session = await getRow("SELECT id FROM sessions WHERE id = ? AND user_id = ?", [req.params.id, req.userId || ""]);
      if (!session) return res.status(404).json({ error: "Session not found" });
      const files = await getRows("SELECT * FROM files WHERE session_id = ?", [req.params.id]);
      res.json(files);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 8. Update file content
  app.put("/api/sessions/:id/files/:fileId", async (req, res) => {
    const { content } = req.body;
    const now = Date.now();
    try {
      const session = await getRow("SELECT id FROM sessions WHERE id = ? AND user_id = ?", [req.params.id, req.userId || ""]);
      if (!session) return res.status(404).json({ error: "Session not found" });
      await run("UPDATE files SET content = ?, last_modified = ? WHERE id = ? AND session_id = ?", [content, now, req.params.fileId, req.params.id]);
      await run("UPDATE sessions SET last_modified = ? WHERE id = ? AND user_id = ?", [now, req.params.id, req.userId || ""]);
      res.json({ status: "ok", last_modified: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 9. Append terminal history
  app.post("/api/sessions/:id/terminal-history", async (req, res) => {
    const { command, output } = req.body;
    const now = Date.now();
    try {
      const session = await getRow("SELECT id FROM sessions WHERE id = ? AND user_id = ?", [req.params.id, req.userId || ""]);
      if (!session) return res.status(404).json({ error: "Session not found" });
      await run("INSERT INTO terminal_history (session_id, command, output, timestamp) VALUES (?, ?, ?, ?)", [req.params.id, command, output, now]);
      res.json({ status: "ok", timestamp: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // 10. Get terminal history
  app.get("/api/sessions/:id/terminal-history", async (req, res) => {
    try {
      const session = await getRow("SELECT id FROM sessions WHERE id = ? AND user_id = ?", [req.params.id, req.userId || ""]);
      if (!session) return res.status(404).json({ error: "Session not found" });
      const history = await getRows("SELECT * FROM terminal_history WHERE session_id = ? ORDER BY timestamp DESC LIMIT 100", [req.params.id]);
      res.json(history.reverse());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/sessions/:id/checkpoint", async (req, res) => {
    try {
      const session = await getRow("SELECT id FROM sessions WHERE id = ? AND user_id = ?", [req.params.id, req.userId || ""]);
      if (!session) return res.status(404).json({ error: "Session not found" });
      const checkpoint = await getRow("SELECT * FROM checkpoints WHERE session_id = ?", [req.params.id]);
      if (!checkpoint) return res.status(404).json({ error: "Checkpoint not found" });
      res.json(checkpoint);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post("/api/sessions/:id/checkpoint", async (req, res) => {
    try {
      const { phase, files, chatHistory } = req.body;
      const session = await getRow("SELECT id FROM sessions WHERE id = ? AND user_id = ?", [req.params.id, req.userId || ""]);
      if (!session) return res.status(404).json({ error: "Session not found" });
      const now = Date.now();
      await run(
        "INSERT INTO checkpoints (session_id, phase, files, chat_history, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(session_id) DO UPDATE SET phase = excluded.phase, files = excluded.files, chat_history = excluded.chat_history, updated_at = excluded.updated_at",
        [req.params.id, phase, JSON.stringify(files), JSON.stringify(chatHistory), now]
      );
      res.json({ status: "ok", updated_at: now });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // --- PREVIEW API ---
  app.post("/api/sessions/:id/preview/start", async (req, res) => {
    const sessionId = req.params.id;
    if (previewProcesses.has(sessionId)) {
      return res.json({ port: previewProcesses.get(sessionId)!.port, url: `http://localhost:${previewProcesses.get(sessionId)!.port}` });
    }

    const port = Math.floor(Math.random() * 1001) + 4000; // 4000-5000
    const cwd = getSessionDir(sessionId);
    
    // Check if index.html exists, create a default one if not to avoid 'serve' error
    if (!fs.existsSync(path.join(cwd, 'index.html'))) {
      fs.writeFileSync(path.join(cwd, 'index.html'), '<html><body><h1>AI Architect Preview</h1><p>Generate some code to see it here.</p></body></html>');
    }

    const child = spawn('npx', ['serve', '-s', '.', '-l', port.toString()], { 
      cwd,
      env: { ...process.env, PATH: `${process.env.PATH}:/usr/local/bin:/usr/bin:/bin` }
    });

    previewProcesses.set(sessionId, { process: child, port });

    // Give it a moment to spin up
    setTimeout(() => {
      res.json({ port, url: `http://localhost:${port}` });
    }, 1500);

    child.on('exit', () => previewProcesses.delete(sessionId));
  });

  app.delete("/api/sessions/:id/preview/stop", (req, res) => {
    const sessionId = req.params.id;
    const processInfo = previewProcesses.get(sessionId);
    if (processInfo) {
      processInfo.process.kill();
      previewProcesses.delete(sessionId);
    }
    res.json({ status: 'ok' });
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
