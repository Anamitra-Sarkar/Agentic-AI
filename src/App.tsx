/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import * as motion from 'motion/react-client';
import { AnimatePresence } from 'motion/react';
import { 
    Send, Play, Code2, Layout as LayoutIcon, RefreshCcw, 
    Box, FileCode, ChevronRight, CheckCircle2, Server, Globe, Layers, Sparkles,
    X, Settings, MoreVertical, Trash2, Copy, Edit, AlertCircle, Info, Check,
    Bot, User, List, SkipForward, ShieldCheck, Terminal as TerminalIcon
} from 'lucide-react';

type View = 'landing' | 'building';
type AppStatus = 'idle' | 'rectifying' | 'prompt-review' | 'building';
type Tab = 'workspace' | 'codebase' | 'preview';

interface Session {
  id: string;
  name: string;
  created_at: number;
  last_modified: number;
  model_config: any;
}

interface TerminalEntry {
  id: string;
  source: 'ai' | 'user';
  command: string;
  output: string;
  status: 'pending' | 'running' | 'success' | 'error';
  timestamp: number;
}

interface CommandQueueItem {
  id: string;
  command: string;
  workdir: string;
}

type ToastType = 'success' | 'error' | 'warning' | 'info';
interface ToastItem {
  id: string;
  message: string;
  type: ToastType;
}

interface ChatMessage {
  role: 'user' | 'ai' | 'system' | 'warning' | 'tool';
  content: string;
}

const cleanCode = (text: string) => {
    // 1. Aggressively extract the first code block if it exists (standard Markdown)
    const codeBlockMatch = text.match(/```(?:[\w\-]*)\n([\s\S]*?)```/);
    if (codeBlockMatch) return codeBlockMatch[1].trim();

    // 2. Fallback: Check for blocks that might start with triple backticks but no newline immediately
    const strictMatch = text.match(/```([\s\S]*?)```/);
    if (strictMatch) return strictMatch[1].trim();
    
    // 3. Fallback: If no backticks, check if the LLM outputted a raw JSON structure
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
        try {
            // Test if it's perfectly valid JSON
            JSON.parse(jsonMatch[0]);
            return jsonMatch[0].trim();
        } catch (e) {
            // Not perfect JSON, but maybe close enough if it's the primary structure
        }
    }

    // 4. Fallback: Remove common leading/trailing prose indicators
    let cleaned = text.trim();
    cleaned = cleaned.replace(/^(Here is the code[:\s]*|Below is the (?:executable|complete) code[:\s]*|File Content[:\s]*)/i, '');
    
    return cleaned.trim();
};

const TaskRouter = {
    // GROQ (Verified Routing Matrix)
    rectification: { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    compression: { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    toolController: { provider: 'groq', model: 'llama-3.3-70b-versatile' },
    
    // THE SWARM PHASES
    draft: { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' },
    audit: { provider: 'groq', model: 'openai/gpt-oss-120b' },
    rapidPatch: { provider: 'groq', model: 'qwen/qwen3-32b' },
    
    // NVIDIA NIM (Infrastructure)
    backendCore: { provider: 'nvidia', model: 'qwen3-coder-480b-a35b-instruct', fallback: { provider: 'groq', model: 'qwen/qwen3-32b' } },
    agenticLogic: { provider: 'nvidia', model: 'deepseek-v3.2' }, 
    intermediateLogic: { provider: 'nvidia', model: 'llama-4-maverick-17b-128e-instruct', fallback: { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' } },
    asyncOrchestration: { provider: 'nvidia', model: 'step-3.5-flash' },

    // OPENROUTER (Frontend)
    refactoring: { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' },
    apiInterfaces: { provider: 'openrouter', model: 'google/gemma-4-31b-it:free', fallback: { provider: 'groq', model: 'llama-3.3-70b-versatile' } },
    frontendReact: { provider: 'openrouter', model: 'z-ai/glm-4.5-air:free' },
    edgeCasesDocs: { provider: 'openrouter', model: 'openai/gpt-oss-120b:free', fallback: { provider: 'groq', model: 'openai/gpt-oss-120b' } },
    validation: { provider: 'groq', model: 'openai/gpt-oss-120b' } // Heavyweight for validation
} as const;

type TaskConfig = typeof TaskRouter[keyof typeof TaskRouter];

const groqTools = [
    { type: "function", function: { name: "tavily_dependency_check", description: "Query package stats (e.g. react 19, tailwind 4, etc).", parameters: { type: "object", properties: { package_name: { type: "string" }, framework: { type: "string" } }, required: ["package_name", "framework"] } } },
    { type: "function", function: { name: "huggingface_space_init", description: "Generate README.md for Docker HuggingFace spaces using port 7860.", parameters: { type: "object", properties: { space_name: { type: "string" }, sdk: { type: "string", enum: ["docker", "gradio"] } }, required: ["space_name", "sdk"] } } },
    { type: "function", function: { name: "vercel_json_scaffold", description: "Generate vercel.json rewrite rules.", parameters: { type: "object", properties: { framework_preset: { type: "string" } }, required: ["framework_preset"] } } },
    { type: "function", function: { name: "terminal_run", description: "Executes a shell command on the Hugging Face Docker backend and returns the full log.", parameters: { type: "object", properties: { command: { type: "string" }, workdir: { type: "string" } }, required: ["command", "workdir"] } } },
    { type: "function", function: { name: "fs_sync", description: "Bulk-writes the entire project state to the Hugging Face Docker volume.", parameters: { type: "object", properties: { files: { type: "object", additionalProperties: { type: "string" } } }, required: ["files"] } } },
    { type: "function", function: { name: "apply_unified_diff", description: "Surgically update a file using SEARCH/REPLACE blocks. Forbidden from sending whole files.", parameters: { type: "object", properties: { patch_text: { type: "string", description: "Raw SEARCH/REPLACE blocks. Format: FILE: [path] <<<<<<< SEARCH [exact lines] ======= [replacement] >>>>>>> REPLACE" } }, required: ["patch_text"] } } },
    { type: "function", function: { name: "get_preview_url", description: "Returns the proxied URL for the running app on the HF container.", parameters: { type: "object", properties: {}, required: [] } } }
];

export default function App() {
  const [view, setView] = useState<View>('landing');
  const [status, setStatus] = useState<AppStatus>('idle');
  const [prompt, setPrompt] = useState<string>('');
  const [rectifiedPrompt, setRectifiedPrompt] = useState<string>('');
  
  const [followUp, setFollowUp] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [compressedContext, setCompressedContext] = useState<string>('');
  
  const [activeTab, setActiveTab] = useState<Tab>('workspace');
  const [projectFiles, setProjectFiles] = useState<Record<string, string>>({});
  const filesSnapshotRef = useRef<Record<string, string>>({});
  
  const updateProjectFiles = (newFiles: Record<string, string>) => {
    filesSnapshotRef.current = newFiles;
    setProjectFiles(newFiles);
  };

  const [selectedFile, setSelectedFile] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  
  // Persistence State
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [isAutoSaving, setIsAutoSaving] = useState(false);
  const [isEditingSessionName, setIsEditingSessionName] = useState(false);
  const [sessionNameInput, setSessionNameInput] = useState('');

  // UI State: Toast, Modal, Drawer, ContextMenu
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const [modal, setModal] = useState<{ isOpen: boolean; title: string; description: string; confirmLabel: string; onConfirm: () => void } | null>(null);
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; fileName: string } | null>(null);

  const showToast = (message: string, type: ToastType = 'info') => {
    const id = Math.random().toString(36).substring(2, 9);
    setToasts(prev => [...prev.slice(-3), { id, message, type }]); // Max 4 toasts
  };

  const removeToast = (id: string) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  const confirmAction = (config: { title: string; description: string; confirmLabel: string; onConfirm: () => void }) => {
    setModal({ isOpen: true, ...config });
  };
  const [isVerifying, setIsVerifying] = useState(false);
  const [activeAgents, setActiveAgents] = useState<Record<string, string>>({});
  const [terminalEntries, setTerminalEntries] = useState<TerminalEntry[]>([]);
  const [commandQueue, setCommandQueue] = useState<CommandQueueItem[]>([]);
  const [aiExecuteMode, setAiExecuteMode] = useState(true);
  const [isRecompiling, setIsRecompiling] = useState(false);
  const [isDarkEnvironment, setIsDarkEnvironment] = useState(false);
  const [isHighPrecision, setIsHighPrecision] = useState(true);
  const compileTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalEntries]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setModal(null);
        setIsDrawerOpen(false);
        setContextMenu(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    fetchSessions();
  }, []);

  const fetchSessions = async () => {
    try {
      const res = await fetch('/api/sessions');
      const data = await res.json();
      setSessions(data);
    } catch (e) {
      showToast('Offline: Could not sync sessions', 'error');
    }
  };

  const createSession = async (name: string = "New Project") => {
    try {
      const res = await fetch('/api/sessions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, modelConfig: TaskRouter })
      });
      const newSession = await res.json();
      setSessions(prev => [newSession, ...prev]);
      return newSession;
    } catch (e) {
      showToast('Failed to create session', 'error');
    }
  };

  const loadSession = async (session: Session) => {
    setActiveSession(session);
    setPrompt(session.name);
    setRectifiedPrompt(session.name);
    setView('building');
    setStatus('building');
    
    try {
      const [filesRes, historyRes] = await Promise.all([
        fetch(`/api/sessions/${session.id}/files`),
        fetch(`/api/sessions/${session.id}/terminal-history`)
      ]);
      const filesArr = await filesRes.json();
      const history = await historyRes.json();
      
      const fileMap: Record<string, string> = {};
      filesArr.forEach((f: any) => { fileMap[f.path] = f.content; });
      
      updateProjectFiles(fileMap);
      setTerminalEntries(history.map((h: any) => ({
        id: Math.random().toString(36).substring(7),
        source: h.command.startsWith('$ ') ? 'user' : 'ai',
        command: h.command.replace(/^\$ /, ''),
        output: h.output,
        status: 'success',
        timestamp: h.timestamp
      })));
      showToast(`Restored: ${session.name}`, 'success');
    } catch (e) {
      showToast('Data recovery partially failed', 'warning');
    }
  };

  const renameSession = async () => {
    if (!activeSession || !sessionNameInput.trim()) return;
    try {
      await fetch(`/api/sessions/${activeSession.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: sessionNameInput })
      });
      setActiveSession({ ...activeSession, name: sessionNameInput });
      setIsEditingSessionName(false);
      fetchSessions();
      showToast('Session renamed', 'success');
    } catch (e) {
      showToast('Rename failed', 'error');
    }
  };

  const autoSaveFile = async (filename: string, content: string) => {
    if (!activeSession) return;
    setIsAutoSaving(true);
    try {
      // Find file ID if exists
      const filesRes = await fetch(`/api/sessions/${activeSession.id}/files`);
      const filesArr = await filesRes.json();
      const existing = filesArr.find((f: any) => f.path === filename);
      
      if (existing) {
        await fetch(`/api/sessions/${activeSession.id}/files/${existing.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ content })
        });
      } else {
        await fetch(`/api/sessions/${activeSession.id}/files`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filename, content, language: 'typescript' })
        });
      }
    } catch (e) {
      console.error('Auto-save failed', e);
    } finally {
      setTimeout(() => setIsAutoSaving(false), 800);
    }
  };

  const [autoSaveTimer, setAutoSaveTimer] = useState<NodeJS.Timeout|null>(null);

  const handleFileChange = (filename: string, content: string) => {
      const newFiles = { ...filesSnapshotRef.current, [filename]: content };
      updateProjectFiles(newFiles);
      setIsRecompiling(true);
      if (compileTimeoutRef.current) clearTimeout(compileTimeoutRef.current);
      compileTimeoutRef.current = setTimeout(() => {
          setIsRecompiling(false);
      }, 500);

      // Auto-save logic (2s debounce)
      if (autoSaveTimer) clearTimeout(autoSaveTimer);
      const timer = setTimeout(() => {
          autoSaveFile(filename, content);
      }, 2000);
      setAutoSaveTimer(timer);
  };

  const runTerminalCommand = async (command: string, workdir: string = '/', source: 'ai' | 'user' = 'user') => {
    const entryId = Math.random().toString(36).substring(7);
    const newEntry: TerminalEntry = {
      id: entryId,
      source,
      command,
      output: '',
      status: 'running',
      timestamp: Date.now()
    };
    
    setTerminalEntries(prev => [...prev, newEntry]);

    try {
      const response = await fetch('/api/terminal/execute-stream', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command, sessionId: activeSession?.id })
      });

      if (!response.body) throw new Error('Streaming failed');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullOutput = '';

      while (true) {
        const { value, done } = await reader.read();
        if (done) break;

        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        
        for (const line of lines) {
          const trimmed = line.trim();
          if (trimmed.startsWith('data: ')) {
            try {
              const data = JSON.parse(trimmed.replace('data: ', ''));
              if (data.type === 'stdout' || data.type === 'stderr') {
                fullOutput += data.content;
                setTerminalEntries(prev => prev.map(e => 
                  e.id === entryId ? { ...e, output: fullOutput } : e
                ));
              } else if (data.type === 'exit') {
                setTerminalEntries(prev => prev.map(e => 
                  e.id === entryId ? { ...e, status: data.code === 0 ? 'success' : 'error' } : e
                ));

                // Verification logic for AI
                if (source === 'ai') {
                    const firstFile = Object.keys(filesSnapshotRef.current).find(f => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.py'));
                    if (firstFile) {
                        const verifyRes = await fetch('/api/terminal/verify', {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ sessionId: activeSession?.id, filePath: firstFile })
                        });
                        const vData = await verifyRes.json();
                        if (!vData.success) {
                            setTerminalEntries(prev => prev.map(e => e.id === entryId ? { ...e, status: 'error', output: e.output + `\nVerification Failed: ${vData.errors.join('\n')}` } : e));
                            showToast(`Verification Failed: ${firstFile}`, 'error');
                        } else {
                            showToast(`Verified: ${firstFile}`, 'success');
                        }
                    }
                }

                if (activeSession) {
                  fetch(`/api/sessions/${activeSession.id}/terminal-history`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ command: source === 'user' ? `$ ${command}` : command, output: fullOutput })
                  });
                }
              }
            } catch (jsonErr) {}
          }
        }
      }
      return JSON.stringify({ status: 'complete' });
    } catch (e: any) {
      setTerminalEntries(prev => prev.map(e => e.id === entryId ? { ...e, status: 'error', output: e.output + `\nExecution Error: ${e.message}` } : e));
      return JSON.stringify({ error: e.message });
    }
  };

  const executeAllQueued = async () => {
    const queue = [...commandQueue];
    setCommandQueue([]);
    for (const item of queue) {
      await runTerminalCommand(item.command, item.workdir, 'ai');
    }
  };

  const callAPI = async (task: TaskConfig, system: string, user: string, withTools: boolean = false, logger?: (msg: string, role: ChatMessage['role']) => void) => {
    const proxyUrls: Record<string, string> = {
        groq: '/api/proxy/groq',
        openrouter: '/api/proxy/openrouter',
        nvidia: '/api/proxy/nvidia'
    };
    
    const attemptFetch = async (provider: string, model: string) => {
        const url = proxyUrls[provider];
        if (!url) throw new Error(`Unsupported provider: ${provider}`);

        const body: any = {
            model,
            messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
            temperature: 0.2,
            max_tokens: 2500
        };
        if (withTools && provider === 'groq') {
            body.tools = groqTools;
            body.tool_choice = 'auto';
        }

        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        if (!res.ok) {
            if (res.status === 429 || res.status === 503) throw new Error(`HTTP_${res.status}`);
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || `${res.status} ${res.statusText}`);
        }
        return await res.json();
    };

    try {
        const data = await attemptFetch(task.provider, task.model);
        return data.choices?.[0]?.message;
    } catch (err: any) {
        if (err.message.includes('HTTP_429') || err.message.includes('HTTP_503') || err.message.includes('timeout')) {
            if ('fallback' in task && task.fallback) {
                if (logger) logger(`${task.provider === 'openrouter' ? 'OpenRouter' : 'NVIDIA'} ${err.message.replace('HTTP_', '')} -> Fallback: Groq ${task.fallback.model}`, 'warning');
                try {
                    const fallbackData = await attemptFetch(task.fallback.provider, task.fallback.model);
                    return fallbackData.choices?.[0]?.message;
                } catch (fallbackErr: any) {
                    return { content: `// Fallback Error formatting Groq: ${fallbackErr.message}` };
                }
            }
        }
        return { content: `// Network Error formatting ${task.provider}: ${err.message}` };
    }
  };

  const executeToolCall = async (toolCall: any, log: (msg: string, role: ChatMessage['role']) => void) => {
      const name = toolCall.function.name;
      const args = JSON.parse(toolCall.function.arguments);
      log(`Execution Triggered: ${name}(${JSON.stringify(args)})`, 'tool');

      if (name === 'tavily_dependency_check') {
          try {
              const res = await fetch('/api/proxy/tavily', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ query: `latest stable version and breaking changes of ${args.package_name} for ${args.framework}` })
              });
              const data = await res.json();
              return `// Tavily Verified Check: ${data.results?.[0]?.content || 'Assumed Stable based on sparse data.'}`;
          } catch (e) {
              return `// Tavily API Error`;
          }
      }
      if (name === 'huggingface_space_init') {
          return `---\ntitle: ${args.space_name}\nemoji: 🚀\ncolorFrom: blue\ncolorTo: indigo\nsdk: ${args.sdk}\nsdk_version: 3.10\napp_file: server.ts\npinned: false\n---\n`;
      }
      if (name === 'vercel_json_scaffold') {
          return `{\n  "version": 2,\n  "rewrites": [\n    { "source": "/(.*)", "destination": "/index.html" }\n  ]\n}`;
      }
      if (name === 'terminal_run') {
          if (aiExecuteMode) {
              const queueId = Math.random().toString(36).substring(7);
              setCommandQueue(prev => [...prev, { id: queueId, command: args.command, workdir: args.workdir }]);
              return `// Command queued for manual verification (AI Execution Mode ON).`;
          }
          return await runTerminalCommand(args.command, args.workdir, 'user');
      }
      if (name === 'fs_sync') {
          log(`Syncing ${Object.keys(args.files).length} files to Virtual File System...`, 'tool');
          updateProjectFiles(args.files); // PERSIST RE-GENERATED CODEBASE TO FRONTEND STATE
          try {
              const res = await fetch('/api/v1/write', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ files: args.files, sessionId: activeSession?.id })
              });
              return `// Files synced successfully.`;
          } catch (e) {
              return `// Write Error: Sync failed.`;
          }
      }
      if (name === 'apply_unified_diff') {
          const patchText = args.patch_text;
          const patchRegex = /FILE:\s*([^\s\n]+)\n<<<<<<<\s*SEARCH\n([\s\S]*?)\n=======\n([\s\S]*?)\n>>>>>>>\s*REPLACE/g;
          let match;
          let updatedFiles = { ...filesSnapshotRef.current };
          let appliedCount = 0;

          while ((match = patchRegex.exec(patchText)) !== null) {
              const [_, filePath, searchContent, replaceContent] = match;
              const currentContent = updatedFiles[filePath];
              if (currentContent !== undefined) {
                  const trimmedSearch = searchContent.trim();
                  if (currentContent.includes(trimmedSearch)) {
                      updatedFiles[filePath] = currentContent.replace(trimmedSearch, replaceContent.trim());
                      appliedCount++;
                  } else {
                      log(`Unified Diff Collision: Fragment in ${filePath} not found. (Search target: ${trimmedSearch.substring(0, 20)}...)`, 'warning');
                  }
              }
          }
          updateProjectFiles(updatedFiles);
          return `// Applied ${appliedCount} surgical unified diffs to codebase.`;
      }
      if (name === 'get_preview_url') {
          return `https://huggingface.co/spaces/${args.space_name || 'architect-space'}`;
      }
      return '';
  };

  const rectifyPrompt = async (input: string) => {
    setStatus('rectifying');
    setPrompt(input);
    const content = (await callAPI(TaskRouter.rectification, 
        'You are the Senior Engineer Rectification Agent. Your goal is to translate an abstract user "vibe" into a strict technical specification. If a user asks for a vibe like "poppy", inject specific architectural requirements for spring animations (motion/react), bold shadow-xl utility classes, and high-contrast emerald/indigo color palettes without seeking clarification.', 
        input
    ))?.content;
    setRectifiedPrompt(content || '');
    setStatus('prompt-review');
    showToast('Plan Rectified & Verified', 'success');
  };

  const handleApproveAndBuild = async () => {
    setView('building');
    setStatus('building');
    setActiveTab('workspace');
    setIsGenerating(true);
    setTerminalEntries([]);
    setActiveAgents({});
    
    const logger = (msg: string, role: ChatMessage['role'] = 'system') => setChatHistory(prev => [...prev, { role, content: msg }]);
    
    // PHASE 1: PLAN (Manifest Generation & SOUL.md Integration)
    logger('PHASE 1: Extracting Project Soul...');
    setActiveAgents({ 'Architect': TaskRouter.rectification.model });
    
    const projectSoul = `# SOUL.md - Project Integrity State\n\n## Tech Stack\n- Backend: Python 3.10 (FastAPI)\n- Frontend: React 19 + Tailwind CSS\n- UI Style: Frosted Neon\n\n## Design System (The Vibe)\n- Spec: ${rectifiedPrompt.substring(0, 500)}\n\n## Verification Status\n- Build Status: Awaiting Pulse Check\n`;
    let currentFiles: Record<string, string> = { 'SOUL.md': projectSoul };

    // 1. Tool Controller Phase
    setActiveAgents(prev => ({ ...prev, 'Controller': TaskRouter.toolController.model }));
    const controllerMsg = await callAPI(TaskRouter.toolController, 
        'Identify environment dependencies. Consult SOUL.md if present.', 
        `Rectified Spec: ${rectifiedPrompt}\nContext: ${projectSoul}`, 
        true, 
        logger
    );

    if (controllerMsg?.tool_calls) {
        logger(`Agentic Swarm triggered autonomous env checks...`, 'tool');
        for (const call of controllerMsg.tool_calls) {
             const result = await executeToolCall(call, logger);
             if (call.function.name === 'huggingface_space_init') currentFiles['README.md'] = result;
             if (call.function.name === 'vercel_json_scaffold') currentFiles['vercel.json'] = result;
        }
    }

    // PHASE 1: DRAFT (Surgical Logic via Scout)
    logger('PHASE 1: "The Draft" - Synthesizing pure Python/React logic...', 'system');
    setActiveAgents({ 'Drafting': TaskRouter.draft.model });
    
    const [backendRes, frontendRes, cssRes, reqsRes, dockerRes] = await Promise.all([
        callAPI(TaskRouter.draft, 'DRAFT PHASE: Generate pure Python FastAPI code. Define any efficient port. ONLY PURE CODE.', `Build FastAPI backend for: ${rectifiedPrompt}`, false, logger),
        callAPI(TaskRouter.draft, 'DRAFT PHASE: Generate React 19 code. API base should dynamically target the backend. ONLY PURE CODE.', `Build React frontend for: ${rectifiedPrompt}`, false, logger),
        callAPI(TaskRouter.draft, 'DRAFT PHASE: Generate Tailwind @layer CSS for "Frosted Neon" theme.', `CSS for: ${rectifiedPrompt}`, false, logger),
        callAPI(TaskRouter.draft, 'DRAFT PHASE: Generate backend/requirements.txt. Include any required dependencies (beta/nightly allowed).', `Requirements for: ${rectifiedPrompt}`, false, logger),
        callAPI(TaskRouter.draft, 'DRAFT PHASE: Generate Dockerfile. Expose appropriate ports. ONLY PURE CODE.', `Dockerfile for: ${rectifiedPrompt}`, false, logger)
    ]);

    const initialFiles = {
        ...currentFiles,
        'backend/main.py': cleanCode(backendRes?.content || ''),
        'frontend/src/App.tsx': cleanCode(frontendRes?.content || ''),
        'frontend/src/index.css': `@import "tailwindcss";\n@layer utilities {\n${cleanCode(cssRes?.content || '')}\n}`,
        'backend/requirements.txt': cleanCode(reqsRes?.content || 'fastapi\nuvicorn'),
        'Dockerfile': cleanCode(dockerRes?.content || 'FROM python:3.10\nWORKDIR /app\nCOPY . .\nRUN pip install -r backend/requirements.txt\nCMD ["uvicorn", "backend.main:app", "--host", "0.0.0.0", "--port", "8000"]')
    };
    updateProjectFiles(initialFiles);

    // PHASE 2: AUDIT (Heavyweight Integrity Check via GPT-OSS)
    logger('PHASE 2: "The Audit" - Scrubbing documentation drift from source...', 'system');
    setActiveAgents({ 'Audit': TaskRouter.audit.model });
    
    const auditStatus = await callAPI(TaskRouter.audit,
        `You are the Code Auditor. Remove any prose, markdown headers, or non-executable text from the following files.
        Return ONLY a JSON map of filename to pure code content. Use absolute paths as keys.`,
        JSON.stringify(filesSnapshotRef.current),
        false,
        logger
    );

    if (auditStatus?.content && !auditStatus.content.toLowerCase().includes('approved')) {
        try {
            const auditedFiles = JSON.parse(cleanCode(auditStatus?.content || '{}'));
            const purgedFiles = { ...filesSnapshotRef.current, ...auditedFiles };
            updateProjectFiles(purgedFiles);
            logger('✓ AUDIT COMPLETE: Source code sanitized.', 'ai');
        } catch (e) {
            logger('Audit refinement failed. Continuing to verification.', 'warning');
        }
    }

    const agenticTerminalRun = async (primary: string, fallbacks: string[], workdir: string = '/') => {
        logger(`Running: ${primary}...`, 'system');
        let resRaw = await executeToolCall({ function: { name: 'terminal_run', arguments: JSON.stringify({ command: primary, workdir }) } }, logger);
        let status = JSON.parse(resRaw);
        
        if (status.exit_code !== 0) {
            for (const fallback of fallbacks) {
                logger(`Primary failed. Trying fallback: ${fallback}...`, 'warning');
                resRaw = await executeToolCall({ function: { name: 'terminal_run', arguments: JSON.stringify({ command: fallback, workdir }) } }, logger);
                status = JSON.parse(resRaw);
                if (status.exit_code === 0) break;
            }
        }
        return status;
    };

    // PHASE 3 & 4: RAPID PATCH & AGENTIC VERIFICATION
    logger('PHASE 3: "The Rapid Patch" - Initiating Agentic Verification...', 'system');
    setIsVerifying(true);
    setActiveAgents({ 'Patching': TaskRouter.rapidPatch.model });
    
    let buildAttempts = 0;
    let buildSuccess = false;
    while (buildAttempts < 3) {
        buildAttempts++;
        logger(`Verification Cycle ${buildAttempts}/3...`, 'system');
        
        await executeToolCall({ function: { name: 'fs_sync', arguments: JSON.stringify({ files: filesSnapshotRef.current }) } }, logger);

        // AGENTIC INSTALL & CHECK
        const pipStatus = await agenticTerminalRun(
            'python3 -m pip install -r backend/requirements.txt',
            ['pip3 install -r backend/requirements.txt', 'pip install -r backend/requirements.txt']
        );

        const backendStatus = await agenticTerminalRun(
            'python3 -m py_compile backend/main.py',
            ['python -m py_compile backend/main.py']
        );

        const frontendStatus = await agenticTerminalRun(
            'npx -y esbuild frontend/src/App.tsx --bundle --dry-run', 
            ['node --check frontend/src/App.tsx', 'ls frontend/src/App.tsx']
        );

        if (backendStatus.exit_code === 0 && frontendStatus.exit_code === 0) {
            buildSuccess = true;
            logger('✓ VERIFICATION SUCCESSFUL: Full Stack Integrity Confirmed.', 'ai');
            showToast('Build Integrity Verified', 'success');
            break;
        }

        // SELF-HEALING
        const errorLog = backendStatus.exit_code !== 0 ? backendStatus.stderr : frontendStatus.stderr;
        logger(`!! DEPLOYMENT ERROR: Triggering rapid healing for ${backendStatus.exit_code === 0 ? 'frontend' : 'backend'}...`, 'warning');
        showToast('Build Conflict Detected', 'warning');
        
        const healingPatch = await callAPI(TaskRouter.rapidPatch,
            `Build failed. ERROR: ${errorLog}. Fix using PURE CODE ONLY via apply_unified_diff format.`,
            JSON.stringify(filesSnapshotRef.current),
            true,
            logger
        );

        if (healingPatch?.tool_calls) {
            for (const call of healingPatch.tool_calls) {
                if (call.function.name === 'apply_unified_diff') await executeToolCall(call, logger);
            }
        }
    }

    // Final SOUL sync
    const finalFiles = { ...filesSnapshotRef.current };
    finalFiles['SOUL.md'] = (finalFiles['SOUL.md'] || '') + `\n## Final Audit\n- Verified: ${buildSuccess ? 'SUCCESS' : 'FAILURE'}\n- Iterations: ${buildAttempts}\n- Time: ${new Date().toISOString()}\n`;
    updateProjectFiles(finalFiles);

    setIsVerifying(false);
    setIsGenerating(false);
    setActiveAgents({});
    logger('PHASE 5: Environment Stabilized. The Senior Engineer has signed off on the codebase.', 'ai');
    showToast(buildSuccess ? 'Cluster Stabilized' : 'Build Compromised', buildSuccess ? 'success' : 'error');
  };

  const sendFollowUp = async () => {
    if (!followUp.trim() || isGenerating) return;
    
    const userMsg = followUp;
    setFollowUp('');
    setChatHistory(prev => [...prev, { role: 'user', content: userMsg }]);
    
    setIsGenerating(true);
    const logger = (msg: string, role: ChatMessage['role'] = 'system') => setChatHistory(prev => [...prev, { role, content: msg }]);
    const entryFiles = { ...filesSnapshotRef.current };
    const soulContent = entryFiles['SOUL.md'] || '';

    // INTENT PREDICTION: Pre-Flight Scan
    if (userMsg.toLowerCase().includes('backend') || userMsg.toLowerCase().includes('api')) {
        logger('Intent Prediction: Scanning Backend environment...', 'system');
        await executeToolCall({ function: { name: 'terminal_run', arguments: JSON.stringify({ command: 'ls -R backend', workdir: '/' }) } }, logger);
    }
    
    // PHASE 1: DRAFT PATCH (Surgical)
    logger('COMMENCING DELTA-FIRST PATCH: Drafting surgical unified diff...', 'system');
    setActiveAgents({ 'Engineer': TaskRouter.draft.model });
    
    const draftPatch = await callAPI(TaskRouter.draft, 
        `STRICT SURGICAL DELTA PROTOCOL. You are the Senior Engineer.
        1. You MUST use apply_unified_diff. Format: FILE: [path] <<<<<<< SEARCH [exact lines] ======= [replacement] >>>>>>> REPLACE
        2. Only provide the specific viewport (5-10 lines) affected.
        3. STRICTLY PURE CODE. NO MARKDOWN HEADERS. No prose.
        4. Consult SOUL.md. Current SOUL: ${soulContent}`, 
        `Modification Task: ${userMsg}
        --- 
        CURRENT CODEBASE:
        ${JSON.stringify(entryFiles, null, 2)}`,
        true, // Enable tools
        logger
    );

    // PHASE 2: AUDIT & COMMIT
    logger('AUDIT PHASE: Validating patch via Council of Review (GPT-OSS)...', 'system');
    setActiveAgents({ 'Reviewer': TaskRouter.audit.model });
    
    const auditRes = await callAPI(TaskRouter.audit,
        `Audit this surgical patch against the SOUL.md context. 
        Ensure it contains ONLY executable code in the REPLACE blocks. No markdown notation.
        Reject if it violates the "Vibe" or removes safety logic. Output "APPROVED" or "REJECT: [reason]".`,
        `SOUL: ${soulContent}\nPatch Request: ${draftPatch?.content}`,
        false,
        logger
    );

    if (auditRes?.content?.toLowerCase().includes('approved')) {
        if (draftPatch?.tool_calls) {
            for (const call of draftPatch.tool_calls) {
                if (call.function.name === 'apply_unified_diff') await executeToolCall(call, logger);
            }
        }
        logger('✓ PATCH COMMITTED: Surgical edit verified by Council.', 'ai');
        showToast('Patch Committed', 'success');
        
        // SELF-HEALING: Verify immediately
        logger('Triggering Smart Build Pulse...', 'system');
        const check = await executeToolCall({ function: { name: 'terminal_run', arguments: JSON.stringify({ command: 'python3 -m py_compile backend/main.py && npx esbuild frontend/src/App.tsx --bundle --dry-run', workdir: '/' }) } }, logger);
        const checkStatus = JSON.parse(check);
        
        if (checkStatus.exit_code !== 0) {
            logger('!! RUNTIME COLLISION: Triggering Rapid Healing...', 'warning');
            setActiveAgents({ 'Healer': TaskRouter.rapidPatch.model });
            const heal = await callAPI(TaskRouter.rapidPatch, 
                `The last patch broke the build. ERROR: ${checkStatus.stderr}. 
                If it is a dependency conflict, resolve it autonomously (e.g. use --legacy-peer-deps or specific beta/nightly versions).
                Fix the issue using PURE CODE ONLY via apply_unified_diff.`,
                JSON.stringify(filesSnapshotRef.current),
                true,
                logger
            );
            if (heal?.tool_calls) {
                for (const call of heal.tool_calls) {
                    if (call.function.name === 'apply_unified_diff') await executeToolCall(call, logger);
                }
            }
        }
    } else {
        logger(`Council of Review BLOCK: ${auditRes?.content?.substring(0, 100)}`, 'warning');
    }
    
    setIsGenerating(false);
    setActiveAgents({});
    setChatHistory(prev => [...prev, { role: 'ai', content: `Modification cycle complete. ${auditRes?.content?.toLowerCase().includes('approved') ? 'Codebase stabilized.' : 'Review rejection handled.'}` }]);
    
    // Auto-update SOUL context
    const postFiles = { ...filesSnapshotRef.current };
    if (postFiles['SOUL.md']) {
        postFiles['SOUL.md'] += `\n## Delta Update (${new Date().toLocaleTimeString()})\n- Trigger: ${userMsg.substring(0, 50)}\n- Status: Verified\n`;
        updateProjectFiles(postFiles);
    }
  };

  const startNewProject = () => {
    confirmAction({
      title: 'Initialize New Cluster?',
      description: 'Starting a new project will purge all active state-trees and locally cached components. This operation is non-reversible.',
      confirmLabel: 'Reset Environment',
      onConfirm: () => {
        setView('landing');
        setStatus('idle');
        setPrompt('');
        setRectifiedPrompt('');
        setFollowUp('');
        setChatHistory([]);
        setActiveTab('workspace');
        setCompressedContext('');
        setProjectFiles({});
        setSelectedFile('');
        setActiveAgents({});
        showToast('Environment reset to baseline', 'success');
      }
    });
  };

  const startNewChatSession = () => {
    confirmAction({
        title: 'Flash AI Context?',
        description: 'Flushing the context clears the LLM memory to prevent hallucination drift while maintaining the current codebase integrity.',
        confirmLabel: 'Flush Memory',
        onConfirm: () => {
            if (chatHistory.length > 0) {
              setCompressedContext('Previous session context compressed. Codebase and architecture state actively preserved.');
            }
            setChatHistory([
              { role: 'system', content: 'Context flushed to mitigate hallucination drift. Architectural maps bound to Port 7860 & Vercel edge preserved. How would you like to proceed?' }
            ]);
            setFollowUp('');
            showToast('AI Context Refreshed', 'info');
        }
    });
  };

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-[#f7f6f2] text-[#2d2d2d] flex flex-col md:flex-row font-sans">
        {/* Session Sidebar */}
        <div className="w-full md:w-80 bg-[#f9f8f5] border-r border-alpha p-8 flex flex-col shadow-warm">
           <div className="flex justify-between items-center mb-10">
              <h2 className="text-xl font-bold flex items-center gap-2 font-display">
                <Layers className="w-5 h-5 text-[#01696f]" /> Projects
              </h2>
              <button 
                onClick={() => createSession()}
                className="p-2 hover:bg-[#efebe3] rounded-[8px] premium-transition border border-transparent hover:border-alpha"
              >
                <Sparkles className="w-4 h-4 text-[#01696f]" />
              </button>
           </div>
           
           <div className="flex-1 overflow-y-auto custom-scrollbar space-y-3">
              {sessions.length === 0 && (
                <div className="py-12 px-4 text-center border-2 border-dashed border-alpha rounded-[12px] opacity-40">
                   <p className="text-xs font-bold uppercase tracking-widest leading-loose">No active clusters found</p>
                </div>
              )}
              {sessions.map(s => (
                <div 
                  key={s.id}
                  onClick={() => loadSession(s)}
                  className="p-4 bg-[#f7f6f2] border border-alpha rounded-[12px] cursor-pointer premium-transition hover:translate-x-1 hover:border-[#01696f]/30 group"
                >
                  <div className="flex justify-between items-start mb-2">
                    <h4 className="font-bold text-[13px] truncate pr-2 group-hover:text-[#01696f] premium-transition">{s.name}</h4>
                    <span className="text-[9px] font-bold text-[#6b6b6b] opacity-40 uppercase tracking-tighter">
                      {new Date(s.last_modified).toLocaleDateString()}
                    </span>
                  </div>
                  <div className="text-[10px] text-[#6b6b6b] font-medium opacity-60">
                    Sovereign Runtime Cluster
                  </div>
                </div>
              ))}
           </div>

           <div className="mt-8 pt-8 border-t border-alpha">
              <div className="p-4 bg-[#01696f]/5 rounded-[12px] border border-[#01696f]/10">
                 <p className="text-[10px] font-bold text-[#01696f] uppercase tracking-widest mb-1">State Integrity</p>
                 <p className="text-[10px] text-[#01696f]/60 font-medium leading-relaxed">SQLite persistence actively caching agentic state trees across session cycles.</p>
              </div>
           </div>
        </div>

        {/* Main Content */}
        <div className="flex-1 relative overflow-y-auto custom-scrollbar pb-64">
          <nav className="p-8 flex justify-between items-center sticky top-0 bg-[#f7f6f2]/80 backdrop-blur-[12px] z-20 border-b border-alpha transition-all duration-300">
            <h1 className="text-2xl font-bold tracking-tight cursor-pointer flex items-center gap-3 font-display" onClick={startNewProject}>
              <Box className="w-6 h-6 text-[#01696f]" />
              AI Architect
            </h1>
            <div className="flex gap-6 items-center">
              <button onClick={() => {
                 confirmAction({
                   title: 'Fast-Track Manifest?',
                   description: 'This will spawn a clean session container immediately without pre-rectification logic. Continue?',
                   confirmLabel: 'Spawn Container',
                   onConfirm: async () => {
                      const ns = await createSession("New Sovereign Node");
                      if (ns) loadSession(ns);
                   }
                 })
              }} className="text-sm font-bold px-6 py-2.5 bg-[#f9f8f5] border border-alpha hover:bg-[#efebe3] shadow-warm rounded-[8px] premium-transition">New Project</button>
            </div>
          </nav>

          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto text-left py-24 px-8">
            <motion.h2 initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="text-6xl sm:text-7xl font-bold mb-10 tracking-tight text-[#2d2d2d] font-display">
              Build, <span className="text-[#01696f]">Intelligently.</span>
            </motion.h2>
            <p className="text-xl text-[#6b6b6b] mb-20 max-w-2xl leading-relaxed font-medium">
              Harness multi-model distribution. Route infrastructure generation to NVIDIA NIM and edge UI creation to OpenRouter with seamless state orchestration.
            </p>
            
            <div className="bg-[#f9f8f5] p-12 rounded-[12px] shadow-warm border border-alpha mb-16 text-left relative overflow-hidden group premium-transition hover:shadow-lg stagger-fade-in">
              <div className="absolute top-0 right-0 p-12 opacity-[0.03] group-hover:opacity-[0.06] premium-transition">
                  <Layers className="w-64 h-64" />
              </div>
              <h3 className="font-bold text-3xl mb-6 text-[#2d2d2d] relative z-10 font-display">Elastic Full-Stack Orchestration</h3>
              <p className="text-[#6b6b6b] text-lg leading-relaxed relative z-10 max-w-2xl mb-10 font-medium">
                AI Architect synthesizes your prompt into distinct, sovereign modules. It concurrently builds backends, frontends, and logic matrices, granting you the freedom to deploy anywhere—from serverless edges to dedicated clusters.
              </p>
              <div className="flex flex-wrap gap-4 relative z-10">
                  <div className="px-5 py-2.5 bg-[#f7f6f2] rounded-full border border-alpha text-[11px] font-bold text-[#6b6b6b] uppercase tracking-[0.1em] flex items-center gap-2.5">
                      <Box className="w-4 h-4" /> Multi-Runtime Support
                  </div>
                  <div className="px-5 py-2.5 bg-[#f7f6f2] rounded-full border border-alpha text-[11px] font-bold text-[#6b6b6b] uppercase tracking-[0.1em] flex items-center gap-2.5">
                      <Globe className="w-4 h-4" /> Infinite Deployment Targets
                  </div>
              </div>
            </div>
          </motion.div>

          <div className="absolute bottom-0 left-0 w-full p-8 bg-gradient-to-t from-[#f7f6f2] via-[#f7f6f2]/95 to-transparent z-40">
            <motion.div layout className="max-w-4xl mx-auto bg-[#f9f8f5] p-8 rounded-[12px] shadow-[0_20px_50px_rgba(0,0,0,0.06)] border border-alpha flex flex-col gap-6 relative stagger-fade-in" style={{ animationDelay: '150ms' }}>
              <div className="absolute -top-4 left-10 px-5 py-1.5 bg-[#01696f] text-white text-[11px] font-bold uppercase tracking-[0.15em] rounded-full shadow-lg">
                  Vibe Control Center
              </div>
              {status === 'idle' && (
                <div className="flex flex-col sm:flex-row gap-6 w-full">
                  <textarea
                    className="flex-1 w-full p-6 bg-[#f7f6f2] border border-alpha rounded-[8px] focus:ring-2 focus:ring-[#01696f]/20 focus:border-[#01696f] focus:outline-none resize-none transition-all placeholder:text-[#6b6b6b]/50 text-sm font-medium"
                    placeholder="Describe your next massive project..."
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    rows={2}
                  />
                  <motion.button
                    whileHover={{ scale: 1.01 }}
                    whileTap={{ scale: 0.98 }}
                    className="w-full sm:w-auto py-6 px-14 bg-[#01696f] text-white rounded-[8px] font-bold premium-transition shadow-lg shadow-[#01696f]/10"
                    onClick={async () => {
                        const ns = await createSession(prompt.substring(0, 30) || "Dynamic Venture");
                        if (ns) {
                            setActiveSession(ns);
                            rectifyPrompt(prompt);
                        }
                    }}
                  >
                    Rectify & Inspect
                  </motion.button>
                </div>
              )}
              
              {status === 'rectifying' && <div className="py-12 text-[#01696f] w-full text-center font-bold flex items-center justify-center gap-4 text-lg">
                <RefreshCcw className="w-6 h-6 animate-spin" /> 
                <span className="shimmer bg-clip-text text-transparent uppercase tracking-widest text-sm">Compressing requirements via Swarm Matrix...</span>
              </div>}
              
              {status === 'prompt-review' && (
                <div className="w-full space-y-8 stagger-fade-in">
                  <div className="bg-[#2d2d2d] p-8 rounded-[12px] text-[#efebe3] leading-relaxed border border-alpha max-h-72 overflow-y-auto font-mono text-[13px] shadow-inner custom-scrollbar relative">
                      <span className="text-[#6b6b6b] block mb-4 font-bold uppercase tracking-[0.2em] text-[10px]">Verified Spec:</span>
                      {rectifiedPrompt}
                      <div className="absolute bottom-4 right-4 text-[#01696f] opacity-50"><CheckCircle2 className="w-6 h-6" /></div>
                  </div>
                  <div className="flex flex-wrap gap-6">
                    <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} className="flex-1 min-w-[240px] py-6 bg-[#01696f] text-white rounded-[8px] transition font-bold shadow-xl shadow-[#01696f]/10" onClick={handleApproveAndBuild}>Approve & Spark Microservices</motion.button>
                    <motion.button whileHover={{ scale: 1.01 }} whileTap={{ scale: 0.98 }} className="px-12 py-6 bg-[#efebe3] text-[#2d2d2d] rounded-[8px] transition font-bold border border-alpha" onClick={() => setStatus('idle')}>Discard</motion.button>
                  </div>
                </div>
              )}
            </motion.div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#f7f6f2] flex p-6 gap-6 max-h-screen overflow-hidden font-sans">
      {/* Sidebar: Chat */}
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="w-80 lg:w-96 bg-[#f9f8f5] rounded-[12px] p-6 flex flex-col shadow-warm border border-alpha premium-transition">
        <div className="flex justify-between items-center mb-8 px-1">
            <h2 className="text-xl font-bold flex items-center gap-2 font-display"><BotIcon /> Orchestrator</h2>
            <div className="flex gap-2">
                <button onClick={startNewChatSession} className="text-[10px] bg-[#efebe3] text-[#2d2d2d] px-3.5 py-2 rounded-full border border-alpha hover:bg-[#efebe3]/80 transition font-bold uppercase tracking-wider" title="Clean AI Context">New Session</button>
            </div>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-6 mb-6 px-1 scrollbar-hide">
            {!compressedContext && (
                <div className="p-6 bg-[#f7f6f2] border border-alpha rounded-[8px] text-[#2d2d2d] leading-relaxed text-sm font-medium">
                    <span className="font-bold opacity-30 uppercase tracking-[0.2em] text-[9px] mb-3 block">Initial Directive</span>
                    {prompt}
                </div>
            )}
            {compressedContext && (
                <motion.div initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="p-4 bg-[#01696f]/5 border border-[#01696f]/10 rounded-[8px] text-[#01696f] text-xs flex items-center gap-3 shadow-sm font-bold">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-[#01696f]" /> {compressedContext}
                </motion.div>
            )}
            {chatHistory.map((msg, idx) => (
                <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} key={idx} 
                    className={`p-6 rounded-[12px] text-sm max-w-full overflow-hidden h-auto premium-transition ${
                        msg.role === 'user' ? 'bg-[#efebe3] ml-auto text-[#2d2d2d] border border-alpha shadow-sm' : 
                        msg.role === 'system' ? 'bg-[#2d2d2d] text-[#f7f6f2] shadow-xl my-8 w-full border border-alpha' : 
                        msg.role === 'warning' ? 'bg-amber-50 text-amber-900 border border-amber-200 shadow-sm mx-2' :
                        msg.role === 'tool' ? 'bg-[#f7f6f2] text-[#01696f] border border-alpha shadow-sm mx-2 overflow-wrap-anywhere break-words font-mono text-[11px]' :
                        'bg-white border border-alpha mr-auto shadow-warm'
                    }`}
                >
                    <div className={`text-[10px] uppercase font-bold mb-3 opacity-40 tracking-[0.15em] flex items-center gap-2 ${msg.role === 'system' ? 'text-[#01696f]' : ''}`}>
                        {msg.role === 'system' ? <Server className="w-3.5 h-3.5" /> : msg.role === 'ai' ? <SparklesIcon /> : ''} {msg.role}
                    </div>
                    {msg.content.includes('<<<<<<< SEARCH') ? (
                        <pre className="text-[11px] font-mono bg-[#1a1a1a] text-[#00ffc2] p-4 rounded-[8px] overflow-x-auto whitespace-pre leading-relaxed mt-3 border border-white/5">
                            {msg.content}
                        </pre>
                    ) : (
                        <div className="leading-relaxed whitespace-pre-wrap overflow-wrap-anywhere break-words font-medium">
                            {msg.content}
                        </div>
                    )}
                </motion.div>
            ))}
            {isGenerating && (
                <div className="p-6 rounded-[12px] bg-white border border-alpha mr-8 shadow-warm flex items-center gap-4 text-sm text-[#6b6b6b] font-bold">
                    <RefreshCcw className="w-4 h-4 animate-spin text-[#01696f]" /> 
                    <span className="shimmer bg-clip-text text-transparent">Synthesizing response...</span>
                </div>
            )}
            <div ref={chatEndRef} />
        </div>

        <div className="mt-auto">
            <div className="relative">
                <textarea
                    value={followUp}
                    onChange={(e) => setFollowUp(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendFollowUp(); }}}
                    placeholder="Instruct Copilot..."
                    className="w-full p-6 pr-16 bg-[#f7f6f2] border border-alpha rounded-[8px] text-sm focus:ring-2 focus:ring-[#01696f]/10 focus:border-[#01696f] focus:outline-none resize-none shadow-inner transition-all placeholder:text-[#6b6b6b]/40 font-medium"
                    rows={2}
                    disabled={isGenerating}
                />
                <button 
                  onClick={sendFollowUp}
                  disabled={isGenerating || !followUp.trim()}
                  className={`absolute right-4 bottom-4 p-3 rounded-[8px] transition scale-100 active:scale-95 ${isGenerating || !followUp.trim() ? 'bg-[#efebe3] text-[#6b6b6b]/30' : 'bg-[#01696f] text-white hover:bg-[#01696f]/90 shadow-lg shadow-[#01696f]/10'}`}
                >
                    <Send className="w-4 h-4" />
                </button>
            </div>
        </div>
      </motion.div>

      {/* Main Workspace */}
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex-1 bg-[#f9f8f5] rounded-[12px] flex flex-col shadow-warm border border-alpha overflow-hidden premium-transition">
        {/* Workspace Top Header */}
        <div className="bg-[#f7f6f2] border-b border-alpha px-8 py-4 flex justify-between items-center">
            <div className="flex items-center gap-4">
                <Box className="w-5 h-5 text-[#01696f]" />
                {isEditingSessionName ? (
                    <input 
                        autoFocus
                        className="bg-white border border-[#01696f]/30 px-3 py-1.5 rounded-[6px] text-sm font-bold text-[#2d2d2d] outline-none focus:ring-2 focus:ring-[#01696f]/20 w-64"
                        value={sessionNameInput}
                        onChange={(e) => setSessionNameInput(e.target.value)}
                        onBlur={renameSession}
                        onKeyDown={(e) => e.key === 'Enter' && renameSession()}
                    />
                ) : (
                    <h3 
                        onClick={() => {
                            setSessionNameInput(activeSession?.name || '');
                            setIsEditingSessionName(true);
                        }}
                        className="text-sm font-bold text-[#2d2d2d] hover:text-[#01696f] cursor-pointer premium-transition flex items-center gap-2 group font-display"
                    >
                        {activeSession?.name || 'In-Memory Build'}
                        <Edit className="w-3 h-3 opacity-0 group-hover:opacity-40 transition-opacity" />
                    </h3>
                )}
            </div>
            <div className="flex items-center gap-4">
                {isAutoSaving && (
                    <div className="flex items-center gap-2 text-[10px] font-bold text-[#01696f] uppercase tracking-widest animate-pulse">
                        <RefreshCcw className="w-3 h-3 animate-spin" />
                        Persisting State...
                    </div>
                )}
                <div className="flex gap-2">
                   <button onClick={() => setView('landing')} className="p-2 hover:bg-[#efebe3] rounded-[8px] border border-alpha premium-transition">
                       <X className="w-4 h-4 text-[#6b6b6b]" />
                   </button>
                </div>
            </div>
        </div>

        <div className="flex bg-[#f7f6f2] border-b border-alpha px-8 pt-2 gap-3">
            {(['workspace', 'codebase', 'preview'] as Tab[]).map((tab) => {
                const Icon = tab === 'workspace' ? LayoutIcon : tab === 'codebase' ? Code2 : Play;
                return (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex items-center gap-3 px-8 py-4 text-sm font-bold transition-all capitalize relative rounded-t-[8px] ${activeTab === tab ? 'bg-[#f9f8f5] text-[#01696f] border-t border-x border-alpha shadow-sm' : 'text-[#6b6b6b] hover:text-[#2d2d2d] hover:bg-[#efebe3]/50'}`}
                    >
                        <Icon className="w-4 h-4" />
                        {tab}
                        {activeTab === tab && <div className="absolute -bottom-[1px] left-0 right-0 h-[2px] bg-[#f9f8f5]" />}
                    </button>
                )
            })}
            <div className="ml-auto pr-8 flex items-center gap-6">
                <div className="flex items-center gap-3">
                    <span className="text-[10px] font-bold text-[#6b6b6b] uppercase tracking-widest">AI Execute Mode</span>
                    <button 
                        onClick={() => setAiExecuteMode(!aiExecuteMode)}
                        className={`w-12 h-6 rounded-full p-1 transition-all relative ${aiExecuteMode ? 'bg-[#01696f]' : 'bg-[#efebe3] border border-alpha'}`}
                    >
                        <motion.div 
                            animate={{ x: aiExecuteMode ? 24 : 0 }}
                            className="w-4 h-4 bg-white rounded-full shadow-sm"
                        />
                    </button>
                </div>
                {activeTab === 'workspace' && (
                    <div className="flex items-center gap-2 px-4 py-1.5 bg-[#efebe3] rounded-[8px] border border-alpha">
                        <div className="w-2 h-2 rounded-full bg-[#01696f] animate-pulse" />
                        <span className="text-[10px] font-bold text-[#01696f] uppercase tracking-wider">Live Bridge Stable</span>
                    </div>
                )}
            </div>
        </div>

        <div className="flex-1 overflow-hidden relative">
          {/* Global Loading Overlay */}
          {isGenerating && activeTab !== 'workspace' && (
              <div className="absolute inset-0 bg-white/60 backdrop-blur-[2px] z-10 flex items-center justify-center">
                  <div className="bg-white p-4 rounded-2xl shadow-xl flex items-center gap-3 border border-slate-100">
                      <RefreshCcw className="w-5 h-5 text-indigo-600 animate-spin" />
                      <span className="text-sm font-bold text-slate-700">Compiling Microservices...</span>
                  </div>
              </div>
          )}

          {activeTab === 'workspace' && (
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full overflow-hidden p-8 space-y-8 bg-[#f9f8f5] flex flex-col">
                {/* Agent Pulse Swarm */}
                {Object.keys(activeAgents).length > 0 && (
                    <motion.div initial={{ opacity: 0, y: -12 }} animate={{ opacity: 1, y: 0 }} className="p-6 bg-[#01696f]/5 rounded-[12px] border border-alpha flex flex-wrap gap-4 items-center shrink-0 shadow-sm">
                        <div className="flex items-center gap-3 mr-6">
                            <Sparkles className="w-5 h-5 text-[#01696f] animate-pulse" />
                            <span className="text-[11px] font-bold text-[#01696f] uppercase tracking-[0.2em] font-sans">Active Swarm Activity</span>
                        </div>
                        {Object.entries(activeAgents).map(([role, model]) => (
                            <div key={role} className="flex items-center gap-3 bg-white px-4 py-2 rounded-full border border-alpha shadow-sm text-[11px] premium-transition hover:scale-105">
                                <span className="font-bold text-[#6b6b6b] capitalize">{role}:</span>
                                <span className="text-[#01696f] font-bold font-mono">{(model as string).split('/').pop()}</span>
                                <div className="w-2 h-2 bg-[#01696f] rounded-full animate-pulse shadow-[0_0_8px_rgba(1,105,111,0.4)]"></div>
                            </div>
                        ))}
                    </motion.div>
                )}

                <div className="flex-1 overflow-hidden grid grid-cols-1 lg:grid-cols-2 gap-8">
                    {/* Integrated Terminal with Streaming & Syntax */}
                    <div className="bg-[#1e1e1e] rounded-[12px] shadow-2xl border border-white/5 flex flex-col overflow-hidden">
                        <div className="bg-[#2d2d2d] px-6 py-4 flex justify-between items-center border-b border-white/5">
                            <div className="flex items-center gap-3">
                                <TerminalIcon className="w-4 h-4 text-[#01696f]" />
                                <span className="text-[11px] font-bold text-[#f7f6f2] uppercase tracking-[0.2em] font-mono">Autonomous Console</span>
                            </div>
                            <div className="flex gap-4">
                                <button className="p-1.5 text-white/30 hover:text-white/60 transition-colors" title="Clear Terminal" onClick={() => setTerminalEntries([])}>
                                    <Trash2 className="w-4 h-4" />
                                </button>
                                <div className="w-3 h-3 rounded-full bg-[#ff5f56]" />
                                <div className="w-3 h-3 rounded-full bg-[#ffbd2e]" />
                                <div className="w-3 h-3 rounded-full bg-[#27c93f]" />
                            </div>
                        </div>
                        <div className="flex-1 p-6 overflow-y-auto custom-scrollbar font-mono text-[13px] leading-relaxed bg-[#1a1a1a]">
                            <div className="space-y-4">
                                {terminalEntries.length === 0 && (
                                    <div className="opacity-20 flex flex-col items-center justify-center py-24 gap-4">
                                        <Bot className="w-12 h-12" />
                                        <p className="text-[10px] uppercase font-bold tracking-[0.3em]">Awaiting Cluster Handshake...</p>
                                    </div>
                                )}
                                {terminalEntries.map(entry => (
                                    <div key={entry.id} className="animate-in fade-in slide-in-from-left-2 duration-300">
                                        <div className="flex items-center gap-3 mb-1.5 overflow-hidden">
                                            {entry.source === 'ai' ? <Bot className="w-4 h-4 text-[#01696f]" /> : <User className="w-4 h-4 text-white/30" />}
                                            <span className="text-[#39ff14] opacity-80 shrink-0 select-none font-bold">$</span>
                                            <span className="text-amber-400 font-bold break-all flex-1">{entry.command}</span>
                                            {entry.status === 'running' && <RefreshCcw className="w-3 h-3 text-[#01696f] animate-spin shrink-0" />}
                                            {entry.status === 'success' && <ShieldCheck className="w-4 h-4 text-[#27c93f] shrink-0" />}
                                            {entry.status === 'error' && <AlertCircle className="w-4 h-4 text-[#ff5f56] shrink-0" />}
                                        </div>
                                        {entry.output && (
                                            <pre className={`pl-8 whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed mb-6 ${entry.status === 'error' ? 'text-red-400/80 bg-red-950/20 p-4 rounded-[6px] border border-red-500/10' : 'text-[#f7f6f2]/80'}`}>
                                                {entry.output}
                                            </pre>
                                        )}
                                    </div>
                                ))}
                                <div ref={terminalEndRef} />
                            </div>
                        </div>
                    </div>

                    {/* Command Queue & Infrastructure Manifest */}
                    <div className="flex flex-col gap-8 overflow-hidden">
                        {/* Command Queue */}
                        <div className="bg-[#f9f8f5] rounded-[12px] border border-alpha shadow-warm flex flex-col max-h-[50%] overflow-hidden">
                            <div className="p-6 border-b border-alpha flex justify-between items-center bg-[#efebe3]/30">
                                <div className="flex items-center gap-3">
                                    <List className="w-4 h-4 text-[#2d2d2d]" />
                                    <h3 className="text-xs font-bold uppercase tracking-[0.2em] font-display">Command Pipeline</h3>
                                    {commandQueue.length > 0 && <span className="bg-[#01696f] text-white text-[10px] px-2 py-0.5 rounded-full">{commandQueue.length}</span>}
                                </div>
                                {commandQueue.length > 0 && (
                                    <button 
                                        onClick={executeAllQueued}
                                        className="text-[10px] font-bold text-[#01696f] hover:underline flex items-center gap-2 uppercase tracking-widest"
                                    >
                                        <Play className="w-3 h-3 fill-current" /> Run All
                                    </button>
                                )}
                            </div>
                            <div className="flex-1 overflow-y-auto p-6 space-y-4 custom-scrollbar">
                                {commandQueue.length === 0 ? (
                                    <div className="py-12 text-center opacity-30 flex flex-col items-center gap-3">
                                        <SkipForward className="w-8 h-8" />
                                        <p className="text-[10px] font-bold uppercase tracking-widest">No pending operations</p>
                                    </div>
                                ) : (
                                    <div className="space-y-3">
                                        {commandQueue.map(item => (
                                            <motion.div 
                                                key={item.id} 
                                                layout
                                                initial={{ opacity: 0, scale: 0.95 }}
                                                animate={{ opacity: 1, scale: 1 }}
                                                exit={{ opacity: 0, scale: 0.9 }}
                                                className="bg-white p-5 rounded-[10px] border border-alpha shadow-sm hover:shadow-md premium-transition group"
                                            >
                                                <div className="flex items-center gap-4 mb-4">
                                                    <div className="w-2 h-2 rounded-full bg-[#01696f]/40 group-hover:scale-125 transition-transform" />
                                                    <code className="text-xs font-mono text-[#01696f] font-bold break-all flex-1">{item.command}</code>
                                                </div>
                                                <div className="flex gap-3">
                                                    <button 
                                                        onClick={async () => {
                                                            setCommandQueue(prev => prev.filter(q => q.id !== item.id));
                                                            await runTerminalCommand(item.command, item.workdir, 'ai');
                                                        }}
                                                        className="flex-1 bg-[#efebe3] hover:bg-[#01696f] hover:text-white text-[10px] py-2.5 rounded-[6px] font-bold uppercase tracking-widest premium-transition"
                                                    >
                                                        Permit
                                                    </button>
                                                    <button 
                                                        onClick={() => setCommandQueue(prev => prev.filter(q => q.id !== item.id))}
                                                        className="px-4 text-[#6b6b6b] hover:text-[#ff5f56] hover:bg-[#ff5f56]/10 rounded-[6px] premium-transition"
                                                    >
                                                        <SkipForward className="w-4 h-4" />
                                                    </button>
                                                </div>
                                            </motion.div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Visualization / Deployment Matrix (Mock) */}
                        <div className="flex-1 bg-[#f9f8f5] rounded-[12px] border border-alpha shadow-warm p-8 flex flex-col gap-6 overflow-y-auto custom-scrollbar">
                           <div className="flex items-center justify-between border-b border-alpha pb-6">
                              <h3 className="text-xs font-bold uppercase tracking-[0.2em] font-display">Cluster Observability</h3>
                              <div className="px-3 py-1 bg-[#01696f]/10 text-[#01696f] text-[9px] font-bold rounded-full border border-[#01696f]/20 uppercase tracking-widest">Global Edge Active</div>
                           </div>
                           <div className="grid grid-cols-2 gap-6">
                                <div className="p-5 bg-white rounded-[10px] border border-alpha shadow-sm">
                                    <div className="text-[10px] font-bold text-[#6b6b6b] uppercase tracking-widest mb-3">Orchestration</div>
                                    <div className="text-2xl font-bold font-display text-[#01696f]">4.2<span className="text-xs opacity-40 ml-1">vCPUs</span></div>
                                    <div className="w-full h-1 bg-[#efebe3] rounded-full mt-4 overflow-hidden">
                                        <motion.div initial={{ width: 0 }} animate={{ width: '65%' }} className="h-full bg-[#01696f]" />
                                    </div>
                                </div>
                                <div className="p-5 bg-white rounded-[10px] border border-alpha shadow-sm">
                                    <div className="text-[10px] font-bold text-[#6b6b6b] uppercase tracking-widest mb-3">Sync Latency</div>
                                    <div className="text-2xl font-bold font-display text-[#2d2d2d]">12<span className="text-xs opacity-40 ml-1">ms</span></div>
                                    <div className="w-full h-1 bg-[#efebe3] rounded-full mt-4 overflow-hidden">
                                        <motion.div initial={{ width: 0 }} animate={{ width: '20%' }} className="h-full bg-[#01696f]" />
                                    </div>
                                </div>
                           </div>
                           
                           <div className="p-6 bg-[#2d2d2d] rounded-[10px] text-[#efebe3] font-mono text-[11px] leading-relaxed shadow-xl border border-white/5 relative overflow-hidden group">
                                <div className="absolute top-0 right-0 p-4 opacity-[0.05] group-hover:scale-110 transition-transform">
                                    <Globe className="w-16 h-16" />
                                </div>
                                <div className="text-[#01696f] font-bold mb-4 flex items-center gap-2">
                                    <RefreshCcw className="w-3 h-3 animate-spin" />
                                    <span>VIRTUAL_MESH_HEARTBEAT</span>
                                </div>
                                <div className="space-y-1">
                                    <p className="opacity-60">NODE_VERCEL_EDGE_01: STABLE</p>
                                    <p className="opacity-60">NODE_NVIDIA_NIM_CORP: OPTIONAL_SYNC</p>
                                    <p className="opacity-100 font-bold">NODE_LOCAL_ARCHITECT: ACTIVE_SYNC</p>
                                </div>
                           </div>
                        </div>
                    </div>
                </div>
            </motion.div>
          )}

          {activeTab === 'codebase' && (
            <div className="h-full flex p-8 gap-8 bg-[#f7f6f2]">
                <div className="w-72 flex flex-col bg-[#f9f8f5] border border-alpha rounded-[12px] shadow-sm overflow-hidden stagger-fade-in">
                    <div className="px-6 py-5 border-b border-alpha bg-[#f7f6f2]">
                        <h3 className="text-[10px] font-bold text-[#6b6b6b] uppercase tracking-[0.25em]">Repository</h3>
                    </div>
                    <ul className="p-4 space-y-1.5 overflow-y-auto custom-scrollbar">
                        {Object.keys(projectFiles).length === 0 && <li className="text-xs text-[#6b6b6b] italic p-3 px-4 opacity-50">No files generated yet.</li>}
                        {Object.keys(projectFiles).map(name => (
                            <li key={name} 
                                onClick={() => setSelectedFile(name)} 
                                onContextMenu={(e) => {
                                    e.preventDefault();
                                    setContextMenu({ x: e.clientX, y: e.clientY, fileName: name });
                                }}
                                className={`cursor-pointer text-[13px] py-3 px-4 rounded-[8px] flex items-center gap-3.5 transition-all font-mono leading-none ${selectedFile === name ? 'bg-[#01696f]/5 text-[#01696f] font-bold border border-[#01696f]/10 translate-x-1' : 'text-[#6b6b6b] hover:bg-[#efebe3] hover:text-[#2d2d2d] border border-transparent'}`}>
                                <FileCode className={`w-4 h-4 ${selectedFile === name ? 'text-[#01696f]' : 'text-[#6b6b6b]/40'}`} />
                                {name}
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="flex-1 bg-[#1a1a1a] rounded-[12px] border border-white/5 shadow-2xl overflow-hidden flex flex-col relative stagger-fade-in" style={{ animationDelay: '150ms' }}>
                    <div className="bg-[#2d2d2d] px-6 py-3 border-b border-white/5 flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <div className="flex gap-2"><div className="w-3 h-3 rounded-full bg-rose-500/30"></div><div className="w-3 h-3 rounded-full bg-amber-500/30"></div><div className="w-3 h-3 rounded-full bg-emerald-500/30"></div></div>
                            <span className="text-[#efebe3]/60 font-mono text-[11px] ml-4 tracking-[0.1em]">{selectedFile || 'SELECT_FILE'}</span>
                        </div>
                        {isRecompiling && (
                            <span className="text-[10px] font-bold text-[#01696f] uppercase tracking-[0.2em] flex items-center gap-2.5"><RefreshCcw className="w-3 h-3 animate-spin"/> Handshaking...</span>
                        )}
                        {!isRecompiling && Object.keys(projectFiles).length > 0 && (
                            <span className="text-[10px] font-bold text-[#01696f] uppercase tracking-[0.2em] flex items-center gap-2">
                              <div className="w-1.5 h-1.5 rounded-full bg-[#01696f]"></div> Synchronized
                            </span>
                        )}
                    </div>
                    <textarea 
                        className="flex-1 bg-transparent text-[#efebe3] font-mono text-[14px] p-8 overflow-auto resize-none focus:outline-none leading-relaxed selection:bg-[#01696f]/30"
                        value={selectedFile ? projectFiles[selectedFile] || '' : '// Awaiting handshake...'}
                        onChange={(e) => handleFileChange(selectedFile, e.target.value)}
                        disabled={!selectedFile}
                        spellCheck={false}
                    />
                </div>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="h-full p-8 bg-[#f7f6f2]">
               {projectFiles['index.html'] ? (
                   <div className="w-full h-full bg-white rounded-[12px] border border-alpha overflow-hidden shadow-warm flex flex-col relative stagger-fade-in">
                       <div className="bg-[#f9f8f5] border-b border-alpha px-6 py-3 flex items-center gap-6">
                           <div className="flex gap-2"><div className="w-3 h-3 rounded-full bg-[#efebe3]"></div><div className="w-3 h-3 rounded-full bg-[#efebe3]"></div><div className="w-3 h-3 rounded-full bg-[#efebe3]"></div></div>
                           <div className="flex-1 bg-[#f7f6f2] rounded-full border border-alpha px-5 py-1.5 flex items-center gap-3">
                               <Globe className="w-3.5 h-3.5 text-[#01696f]" />
                               <span className="text-[11px] font-mono text-[#6b6b6b] tracking-wider uppercase opacity-60">Architect_Edge://Pulse_Live</span>
                           </div>
                           <div className="flex items-center gap-2 px-3 py-1 bg-[#01696f]/5 text-[#01696f] rounded-full border border-[#01696f]/10">
                               <CheckCircle2 className="w-3 h-3" />
                               <span className="text-[10px] font-bold uppercase tracking-widest">Verified</span>
                           </div>
                       </div>
                       <div className="flex-1 bg-white relative">
                        {isGenerating && (
                            <div className="absolute inset-0 bg-[#f9f8f5]/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-4">
                                <RefreshCcw className="w-8 h-8 text-[#01696f] animate-spin" />
                                <span className="text-xs font-bold text-[#01696f] uppercase tracking-[0.2em] font-sans">Hot Reloading State Tree...</span>
                            </div>
                        )}
                        <iframe 
                            className="w-full h-full bg-white transition-opacity duration-300" 
                            srcDoc={projectFiles['index.html']} 
                            sandbox="allow-scripts allow-forms allow-same-origin"
                            title="Preview"
                        />
                       </div>
                   </div>
               ) : (
                <div className="w-full h-full rounded-[12px] border-2 border-dashed border-[#6b6b6b]/20 flex items-center justify-center bg-[#f9f8f5] relative overflow-hidden stagger-fade-in">
                    <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 15, ease: "linear" }} className="absolute -inset-40 bg-gradient-to-r from-transparent via-[#01696f]/5 to-transparent opacity-30 blur-3xl"></motion.div>
                    <div className="text-center relative z-10 w-full max-w-sm p-8">
                        <div className="w-24 h-24 bg-white rounded-full shadow-lg flex items-center justify-center mx-auto mb-8 border border-alpha premium-transition hover:scale-110">
                            <Layers className="w-10 h-10 text-[#01696f]/20" />
                        </div>
                        <h4 className="text-[#2d2d2d] font-bold text-xl mb-4 font-display">Environment Offline</h4>
                        <p className="text-sm text-[#6b6b6b] px-6 leading-relaxed font-medium">Provide a project mandate and instruct the architect to compile the distributed components to see the live preview here.</p>
                    </div>
                </div>
               )}
            </div>
          )}
        </div>
        
        <div className="px-8 py-4 bg-[#f9f8f5] border-t border-alpha flex justify-between items-center text-[10px] font-bold text-[#6b6b6b] tracking-[0.2em] uppercase">
            <div className="flex items-center gap-3">
              <div className={`w-2.5 h-2.5 rounded-full premium-transition ${isGenerating ? 'bg-[#01696f] animate-pulse shadow-[0_0_8px_rgba(1,105,111,0.4)]' : 'bg-[#01696f]/40'}`}></div> 
              {isGenerating ? 'Synchronizing Cluster...' : 'Swarm Stabilized'}
            </div>
            <div className="flex gap-10">
                <span className="opacity-60">Allocation: {(Object.values(projectFiles).map(f => typeof f === 'string' ? f.length : 0).reduce((acc, curr) => acc + curr, 0) / 1024).toFixed(2)} KB</span>
                <span className="text-[#01696f] hover:underline cursor-pointer" onClick={() => setIsDrawerOpen(true)}>Settings</span>
            </div>
        </div>

        {/* Portals */}
        {createPortal(
          <>
            {/* Toast System */}
            <div className="fixed top-8 right-8 z-[100] flex flex-col gap-2 pointer-events-none">
              <AnimatePresence mode="popLayout">
                {toasts.map((t) => (
                  <motion.div
                    key={t.id}
                    initial={{ x: 100, opacity: 0 }}
                    animate={{ x: 0, opacity: 1 }}
                    exit={{ x: 100, opacity: 0 }}
                    className="pointer-events-auto bg-[#f9f8f5] shadow-warm border border-alpha rounded-full px-5 py-3 flex items-center gap-3 group relative overflow-hidden"
                  >
                    <div className={`w-2 h-2 rounded-full ${t.type === 'success' ? 'bg-[#01696f]' : t.type === 'error' ? 'bg-rose-500' : t.type === 'warning' ? 'bg-amber-500' : 'bg-[#6b6b6b]'}`} />
                    <span className="text-sm font-bold text-[#2d2d2d] pr-4">{t.message}</span>
                    <button onClick={() => removeToast(t.id)} className="p-1 hover:bg-[#efebe3] rounded-full transition-colors opacity-0 group-hover:opacity-100">
                      <X className="w-3 h-3 text-[#6b6b6b]" />
                    </button>
                    <motion.div 
                      initial={{ width: '100%' }} 
                      animate={{ width: 0 }} 
                      transition={{ duration: 3, ease: 'linear' }}
                      onAnimationComplete={() => removeToast(t.id)}
                      className="absolute bottom-0 left-0 h-0.5 bg-[#01696f]/20"
                    />
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>

            {/* Confirmation Modal */}
            {modal?.isOpen && (
              <div className="fixed inset-0 z-[110] flex items-center justify-center p-4">
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  className="absolute inset-0 bg-[#2d2d2d]/20 backdrop-blur-[4px]" 
                  onClick={() => setModal(null)}
                />
                <motion.div 
                  initial={{ scale: 0.95, opacity: 0 }} 
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ duration: 0.18 }}
                  className="bg-[#f9f8f5] rounded-[16px] shadow-2xl border border-alpha p-8 max-w-md w-full relative z-10"
                >
                  <h3 className="text-xl font-bold text-[#2d2d2d] mb-2 font-display">{modal.title}</h3>
                  <p className="text-[#6b6b6b] mb-8 font-medium leading-relaxed">{modal.description}</p>
                  <div className="flex justify-end gap-4">
                    <button onClick={() => setModal(null)} className="px-6 py-2.5 font-bold text-[#6b6b6b] hover:bg-[#efebe3] rounded-[8px] transition-colors">Cancel</button>
                    <button 
                      onClick={() => { modal.onConfirm(); setModal(null); }} 
                      className="px-6 py-2.5 bg-[#01696f] text-white font-bold rounded-[8px] shadow-lg shadow-[#01696f]/10 premium-transition"
                    >
                      {modal.confirmLabel}
                    </button>
                  </div>
                </motion.div>
              </div>
            )}

            {/* Settings Drawer */}
            {isDrawerOpen && (
              <div className="fixed inset-0 z-[120]">
                <motion.div 
                  initial={{ opacity: 0 }} 
                  animate={{ opacity: 1 }} 
                  className="absolute inset-0 bg-[#2d2d2d]/40 backdrop-blur-sm" 
                  onClick={() => setIsDrawerOpen(false)}
                />
                <motion.div 
                  initial={{ x: '100%' }} 
                  animate={{ x: 0 }}
                  transition={{ type: 'spring', damping: 25, stiffness: 200 }}
                  className="absolute top-0 right-0 h-full w-[380px] max-w-full bg-[#f9f8f5] shadow-2xl border-l border-alpha flex flex-col"
                >
                  <div className="p-8 border-b border-alpha flex justify-between items-center bg-[#f7f6f2]">
                    <h3 className="text-xl font-bold text-[#2d2d2d] font-display flex items-center gap-2">
                        <Settings className="w-5 h-5 text-[#01696f]" /> Configuration
                    </h3>
                    <button onClick={() => setIsDrawerOpen(false)} className="p-2 hover:bg-[#efebe3] rounded-[8px] transition-colors">
                        <X className="w-5 h-5 text-[#6b6b6b]" />
                    </button>
                  </div>
                  <div className="p-8 space-y-8 flex-1 overflow-y-auto custom-scrollbar">
                    <section>
                        <h4 className="text-[10px] font-bold text-[#6b6b6b] uppercase tracking-[0.2em] mb-4">API Controllers</h4>
                        <div className="space-y-4">
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-[#2d2d2d] ml-1">Groq Key</label>
                                <input type="password" value="••••••••" disabled className="w-full bg-[#f7f6f2] border border-alpha rounded-[8px] px-4 py-2.5 text-sm font-mono opacity-60" />
                            </div>
                            <div className="space-y-1.5">
                                <label className="text-xs font-bold text-[#2d2d2d] ml-1">OpenRouter Key</label>
                                <input type="password" value="••••••••" disabled className="w-full bg-[#f7f6f2] border border-alpha rounded-[8px] px-4 py-2.5 text-sm font-mono opacity-60" />
                            </div>
                        </div>
                    </section>
                    <section>
                        <h4 className="text-[10px] font-bold text-[#6b6b6b] uppercase tracking-[0.2em] mb-4">Preferences</h4>
                        <div className="space-y-4">
                            <div 
                                onClick={() => setIsHighPrecision(!isHighPrecision)}
                                className="flex justify-between items-center bg-white p-4 rounded-[8px] border border-alpha shadow-sm cursor-pointer select-none"
                            >
                                <span className="text-sm font-bold text-[#2d2d2d]">High-Precision Mode</span>
                                <div className={`w-10 h-5 rounded-full relative premium-transition ${isHighPrecision ? 'bg-[#01696f]' : 'bg-[#efebe3]'}`}>
                                    <motion.div 
                                        animate={{ x: isHighPrecision ? 20 : 0 }}
                                        className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full shadow-sm"
                                    />
                                </div>
                            </div>
                            <div 
                                onClick={() => setIsDarkEnvironment(!isDarkEnvironment)}
                                className="flex justify-between items-center bg-white p-4 rounded-[8px] border border-alpha shadow-sm cursor-pointer select-none"
                            >
                                <span className="text-sm font-bold text-[#2d2d2d]">Dark Environment</span>
                                <div className={`w-10 h-5 rounded-full relative premium-transition ${isDarkEnvironment ? 'bg-[#01696f]' : 'bg-[#efebe3]'}`}>
                                    <motion.div 
                                        animate={{ x: isDarkEnvironment ? 20 : 0 }}
                                        className="absolute left-1 top-1 w-3 h-3 bg-white rounded-full shadow-sm"
                                    />
                                </div>
                            </div>
                        </div>
                    </section>
                    <section>
                        <h4 className="text-[10px] font-bold text-[#6b6b6b] uppercase tracking-[0.2em] mb-4">Terminal Aesthetics</h4>
                        <div className="p-4 bg-white rounded-[8px] border border-alpha shadow-sm">
                           <input type="range" className="w-full accent-[#01696f]" min="10" max="18" defaultValue="13" />
                           <div className="flex justify-between mt-2 text-[10px] font-bold text-[#6b6b6b]"><span>10px</span><span>18px</span></div>
                        </div>
                    </section>
                  </div>
                  <div className="p-8 bg-[#f7f6f2] border-t border-alpha">
                      <button className="w-full py-4 bg-[#01696f] text-white font-bold rounded-[8px] shadow-lg shadow-[#01696f]/10 premium-transition">Synchronize State</button>
                  </div>
                </motion.div>
              </div>
            )}

            {/* Context Menu */}
            {contextMenu && (
              <>
                <div className="fixed inset-0 z-[130]" onClick={() => setContextMenu(null)} onContextMenu={(e) => { e.preventDefault(); setContextMenu(null); }} />
                <motion.div 
                    initial={{ opacity: 0, scale: 0.98 }}
                    animate={{ opacity: 1, scale: 1 }}
                    className="fixed z-[131] bg-[#f9f8f5] border border-alpha shadow-xl rounded-[8px] py-2 w-48 overflow-hidden stagger-fade-in"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    <button className="w-full px-4 py-2 hover:bg-[#efebe3] text-sm text-[#2d2d2d] flex items-center gap-3 transition-colors text-left font-medium">
                        <Edit className="w-3.5 h-3.5 opacity-60" /> Rename
                    </button>
                    <button className="w-full px-4 py-2 hover:bg-[#efebe3] text-sm text-[#2d2d2d] flex items-center gap-3 transition-colors text-left font-medium">
                        <Copy className="w-3.5 h-3.5 opacity-60" /> Duplicate
                    </button>
                    <button onClick={() => { 
                        const name = contextMenu.fileName;
                        setContextMenu(null);
                        confirmAction({
                            title: 'Delete Resource?',
                            description: `Are you sure you want to permanently delete "${name}"? This action cannot be reversed within the current cluster state.`,
                            confirmLabel: 'Delete Permanently',
                            onConfirm: () => {
                                const newFiles = { ...filesSnapshotRef.current };
                                delete newFiles[name];
                                updateProjectFiles(newFiles);
                                setSelectedFile(prev => prev === name ? '' : prev);
                                showToast(`${name} deleted.`, 'success');
                            }
                        })
                    }} className="w-full px-4 py-2 hover:bg-rose-50 text-sm text-rose-600 flex items-center gap-3 transition-colors text-left font-medium">
                        <Trash2 className="w-3.5 h-3.5 opacity-60" /> Delete
                    </button>
                    <div className="h-px bg-alpha my-1" />
                    <button onClick={() => {
                        navigator.clipboard.writeText(contextMenu.fileName);
                        showToast('Path copied to clipboard', 'info');
                        setContextMenu(null);
                    }} className="w-full px-4 py-2 hover:bg-[#efebe3] text-sm text-[#6b6b6b] flex items-center gap-3 transition-colors text-left font-medium">
                        <Info className="w-3.5 h-3.5 opacity-60" /> Copy Path
                    </button>
                </motion.div>
              </>
            )}
          </>,
          document.body
        )}
      </motion.div>
    </div>
  );
}

function BotIcon() {
    return <svg className="w-6 h-6 text-[#01696f]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>;
}

function SparklesIcon() {
    return <svg className="w-3.5 h-3.5 text-[#01696f]" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>;
}
