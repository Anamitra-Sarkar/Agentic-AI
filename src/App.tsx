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
    Bot, User, List, SkipForward, ShieldCheck, Terminal as TerminalIcon, WifiOff, LogOut, LoaderCircle
} from 'lucide-react';
import { auth, signInWithGoogle, signInWithGithub, logout, onAuthStateChanged, type User as FirebaseUser } from './firebase';

import type { View, AppStatus, Tab, ClarificationQuestion, QueuedInstruction, Session, TerminalEntry, CommandQueueItem, ToastType, ToastItem, ChatMessage, CheckpointState, TaskConfig } from './types';
import { TaskRouter, groqTools } from './constants';
import { cleanCode, waitForOnline, fetchWithRetry } from './utils';
import { ToastContainer } from './components/ToastContainer';
import { ConfirmModal } from './components/ConfirmModal';
import { FileTree } from './components/FileTree';
import { TerminalPanel } from './components/TerminalPanel';
import { ChatPanel } from './components/ChatPanel';
import { LandingView } from './components/LandingView';



export default function App() {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [view, setView] = useState<View>('landing');
  const [status, setStatus] = useState<AppStatus>('idle');
  const [prompt, setPrompt] = useState<string>('');
  const [rectifiedPrompt, setRectifiedPrompt] = useState<string>('');
  const [clarifications, setClarifications] = useState<ClarificationQuestion[]>([]);
  const [isClarifying, setIsClarifying] = useState(false);
  
  const [followUp, setFollowUp] = useState<string>('');
  const [chatHistory, setChatHistory] = useState<ChatMessage[]>([]);
  const [compressedContext, setCompressedContext] = useState<string>('');

  // Instruction Queue (persistent in-memory queue)
  const [instructionQueue, setInstructionQueue] = useState<QueuedInstruction[]>([]);
  const [queueInput, setQueueInput] = useState('');
  const isProcessingQueue = useRef(false);
  
  const [cloneUrl, setCloneUrl] = useState('');
  const [isUrlMode, setIsUrlMode] = useState(false);
  const [cloneProgress, setCloneProgress] = useState<number>(0);
  const [isAnalyzing, setIsAnalyzing] = useState(false);

  const [activeTab, setActiveTab] = useState<Tab>('workspace');
  const [projectFiles, setProjectFiles] = useState<Record<string, string>>({});
  const filesSnapshotRef = useRef<Record<string, string>>({});
  const fileIdMapRef = useRef<Record<string, string>>({});
  const [resumeCheckpoint, setResumeCheckpoint] = useState<CheckpointState | null>(null);
  const [isOnline, setIsOnline] = useState(navigator.onLine);
  const [isGenerationQueued, setIsGenerationQueued] = useState(false);
  const chatHistoryRef = useRef<ChatMessage[]>([]);
  
  const updateProjectFiles = (newFiles: Record<string, string>) => {
    filesSnapshotRef.current = newFiles;
    setProjectFiles(newFiles);
  };

  const [selectedFile, setSelectedFile] = useState<string>('');
  const [isGenerating, setIsGenerating] = useState(false);
  const [cursorPos, setCursorPos] = useState({ line: 1, col: 1 });
  
  // Preview State
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [isPreviewLoading, setIsPreviewLoading] = useState(false);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  
  const startPreview = async () => {
    if (!activeSession) return showToast('Save a session first', 'warning');
    setIsPreviewLoading(true);
    try {
      const res = await fetchWithRetry(`/api/sessions/${activeSession.id}/preview/start`, {
        method: 'POST',
        headers: sessionHeaders(),
      });
      const { url } = await res.json();
      setPreviewUrl(url);
    } catch (e) {
      showToast('Preview server failed to start', 'error');
    } finally {
      setIsPreviewLoading(false);
    }
  };
  
  // Monaco Refs
  const monacoRef = useRef<any>(null);
  const editorRef = useRef<any>(null);

  useEffect(() => {
    if (!selectedFile || !projectFiles[selectedFile]) return;
    const langMap: Record<string, string> = {
      '.tsx': 'typescript', '.ts': 'typescript', '.jsx': 'javascript',
      '.js': 'javascript', '.py': 'python', '.css': 'css',
      '.json': 'json', '.md': 'markdown', '.html': 'html'
    };
    const ext = selectedFile.substring(selectedFile.lastIndexOf('.'));
    const language = langMap[ext] || 'plaintext';

    if (editorRef.current) {
      editorRef.current.dispose();
    }

    (window as any).require.config({ paths: { vs: 'https://cdn.jsdelivr.net/npm/monaco-editor@0.52.0/min/vs' } });
    (window as any).require(['vs/editor/editor.main'], (monaco: any) => {
      monacoRef.current = monaco;
      const container = document.getElementById('monaco-container');
      if (!container) return;
      
      editorRef.current = monaco.editor.create(container, {
        value: projectFiles[selectedFile] || '',
        language,
        theme: 'vs-light',
        fontSize: 13,
        fontFamily: '"JetBrains Mono", monospace',
        minimap: { enabled: true },
        wordWrap: 'on',
        scrollBeyondLastLine: false,
        automaticLayout: true,
        padding: { top: 16 },
        lineNumbers: 'on',
        renderLineHighlight: 'line',
        smoothScrolling: true,
      });

      editorRef.current.onDidChangeModelContent(() => {
        const value = editorRef.current.getValue();
        handleFileChange(selectedFile, value);
      });

      editorRef.current.onDidChangeCursorPosition((e: any) => {
        setCursorPos({ line: e.position.lineNumber, col: e.position.column });
      });
    });

    return () => { editorRef.current?.dispose(); };
  }, [selectedFile]);

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
    chatHistoryRef.current = chatHistory;
  }, [chatHistory]);

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
    return onAuthStateChanged(auth, (u) => {
      setUser(u);
      setAuthLoading(false);
      if (!u) {
        setSessions([]);
        setActiveSession(null);
        setResumeCheckpoint(null);
      }
    });
  }, []);

  useEffect(() => {
    const handleOnline = () => {
      setIsOnline(true);
      setIsGenerationQueued(false);
      showToast('Connection restored', 'success');
    };
    const handleOffline = () => {
      setIsOnline(false);
      if (isGenerating) setIsGenerationQueued(true);
      showToast("You're offline — generation continues on cloud", 'warning');
    };
    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);
    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [isGenerating]);

  useEffect(() => {
    if (isGenerating && !isOnline) setIsGenerationQueued(true);
    if (isOnline && !isGenerating) setIsGenerationQueued(false);
  }, [isGenerating, isOnline]);

  useEffect(() => {
    if (!user) return;
    fetchSessions();
  }, [user]);

  useEffect(() => {
    if (!activeSession || !user) return;
    loadCheckpoint(activeSession.id);
  }, [activeSession, user]);

  const sessionHeaders = (extra: HeadersInit = {}) => ({
    'Content-Type': 'application/json',
    'X-User-Id': user?.uid || '',
    ...extra,
  });

  const loadCheckpoint = async (sessionId: string) => {
    try {
      const res = await fetchWithRetry(`/api/sessions/${sessionId}/checkpoint`, {
        method: 'GET',
        headers: sessionHeaders(),
      });
      if (!res.ok) {
        setResumeCheckpoint(null);
        return;
      }
      const data = await res.json();
      setResumeCheckpoint({
        phase: data.phase,
        files: JSON.parse(data.files || '{}'),
        chatHistory: JSON.parse(data.chat_history || '[]'),
        updated_at: data.updated_at,
      });
    } catch {
      setResumeCheckpoint(null);
    }
  };

  const saveCheckpoint = async (sessionId: string, phase: string, files: Record<string, string>, history: ChatMessage[]) => {
    await fetchWithRetry(`/api/sessions/${sessionId}/checkpoint`, {
      method: 'POST',
      headers: sessionHeaders(),
      body: JSON.stringify({ phase, files, chatHistory: history }),
    });
  };

  const fetchSessions = async () => {
    try {
      const res = await fetchWithRetry('/api/sessions', {
        method: 'GET',
        headers: sessionHeaders(),
      });
      const data = await res.json();
      setSessions(data);
      const savedSessionId = localStorage.getItem('ai-architect-last-session-id');
      if (savedSessionId) {
        const savedSession = data.find((s: Session) => s.id === savedSessionId);
        if (savedSession) {
          setActiveSession(savedSession);
          loadCheckpoint(savedSessionId);
        }
      }
    } catch (e) {
      showToast('Offline: Could not sync sessions', 'error');
    }
  };

  const createSession = async (name: string = "New Project") => {
    try {
      const res = await fetchWithRetry('/api/sessions', {
        method: 'POST',
        headers: sessionHeaders(),
        body: JSON.stringify({ name, modelConfig: TaskRouter, userId: user?.uid }),
      });
      const newSession = await res.json();
      setSessions(prev => [newSession, ...prev]);
      localStorage.setItem('ai-architect-last-session-id', newSession.id);
      return newSession;
    } catch (e) {
      showToast('Failed to create session', 'error');
    }
  };

  const loadSession = async (session: Session) => {
    setActiveSession(session);
    localStorage.setItem('ai-architect-last-session-id', session.id);
    setPrompt(session.name);
    setRectifiedPrompt(session.name);
    setView('building');
    setStatus('building');
    
    try {
      const [filesRes, historyRes] = await Promise.all([
        fetchWithRetry(`/api/sessions/${session.id}/files`, { method: 'GET', headers: sessionHeaders() }),
        fetchWithRetry(`/api/sessions/${session.id}/terminal-history`, { method: 'GET', headers: sessionHeaders() })
      ]);
      const filesArr = await filesRes.json();
      const history = await historyRes.json();
      
      const fileMap: Record<string, string> = {};
      filesArr.forEach((f: any) => { fileMap[f.path] = f.content; });
      
      // Populate filename -> id cache for faster auto-save
      fileIdMapRef.current = {};
      filesArr.forEach((f: any) => { if (f.path && f.id) fileIdMapRef.current[f.path] = f.id; });

      updateProjectFiles(fileMap);
      setTerminalEntries(history.map((h: any) => ({
        id: Math.random().toString(36).substring(7),
        source: h.command.startsWith('$ ') ? 'user' : 'ai',
        command: h.command.replace(/^\$ /, ''),
        output: h.output,
        status: 'success',
        timestamp: h.timestamp
      })));
      loadCheckpoint(session.id);
      showToast(`Restored: ${session.name}`, 'success');
    } catch (e) {
      showToast('Data recovery partially failed', 'warning');
    }
  };

  const renameSession = async () => {
    if (!activeSession || !sessionNameInput.trim()) return;
    try {
      await fetchWithRetry(`/api/sessions/${activeSession.id}`, {
        method: 'PUT',
        headers: sessionHeaders(),
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
      // Use cached filename -> id map to avoid fetching the file list repeatedly
      const existingId = fileIdMapRef.current[filename];
      if (existingId) {
        await fetchWithRetry(`/api/sessions/${activeSession.id}/files/${existingId}`, {
          method: 'PUT',
          headers: sessionHeaders(),
          body: JSON.stringify({ content })
        });
      } else {
        const res = await fetchWithRetry(`/api/sessions/${activeSession.id}/files`, {
          method: 'POST',
          headers: sessionHeaders(),
          body: JSON.stringify({ path: filename, content, language: 'typescript' })
        });
        // Update cache with returned id if available
        const created = await res.json().catch(() => null);
        if (created && created.id && created.path) {
          fileIdMapRef.current[created.path] = created.id;
        }
      }
    } catch (e) {
      console.error('Auto-save failed', e);
    } finally {
      setTimeout(() => setIsAutoSaving(false), 800);
    }
  };

  const autoSaveTimerRef = useRef<NodeJS.Timeout|null>(null);

  const handleFileChange = (filename: string, content: string) => {
      const newFiles = { ...filesSnapshotRef.current, [filename]: content };
      updateProjectFiles(newFiles);
      setIsRecompiling(true);
      if (compileTimeoutRef.current) clearTimeout(compileTimeoutRef.current);
      compileTimeoutRef.current = setTimeout(() => {
          setIsRecompiling(false);
      }, 500);

      // Auto-save logic (2s debounce)
      if (autoSaveTimerRef.current) clearTimeout(autoSaveTimerRef.current as any);
      const timer = setTimeout(() => {
          autoSaveFile(filename, content);
      }, 2000);
      autoSaveTimerRef.current = timer as any;
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
      const response = await fetchWithRetry('/api/terminal/execute-stream', {
        method: 'POST',
        headers: sessionHeaders(),
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
                        const verifyRes = await fetchWithRetry('/api/terminal/verify', {
                            method: 'POST',
                            headers: sessionHeaders(),
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
                  fetchWithRetry(`/api/sessions/${activeSession.id}/terminal-history`, {
                    method: 'POST',
                    headers: sessionHeaders(),
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

        const res = await fetchWithRetry(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        
        if (!res.ok) {
            if (res.status === 429 || res.status === 503) throw new Error(`HTTP${res.status}`);
            const errorData = await res.json().catch(() => ({}));
            throw new Error(errorData.error || `${res.status} ${res.statusText}`);
        }
        return await res.json();
    };

    try {
        const data = await attemptFetch(task.provider, task.model);
        return data.choices?.[0]?.message;
    } catch (err: any) {
        if (err.message.includes('HTTP429') || err.message.includes('HTTP503') || err.message.includes('timeout')) {
            if ('fallback' in task && task.fallback) {
                if (logger) logger(`${task.provider === 'openrouter' ? 'OpenRouter' : 'NVIDIA'} ${err.message.replace('HTTP', '')} -> Fallback: Groq ${task.fallback.model}`, 'warning');
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
              const res = await fetchWithRetry('/api/proxy/tavily', {
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
              const res = await fetchWithRetry('/api/v1/write', {
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

  const handleCloneFromUrl = async () => {
    if (!cloneUrl.trim()) return showToast('Enter a valid URL', 'warning');
    setIsAnalyzing(true);
    setCloneProgress(1);

    try {
      const res = await fetchWithRetry('/api/scrape', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: cloneUrl })
      });
      const data = await res.json();
      
      if (data.error) throw new Error(data.error);

      // Simulate step analysis for UI
      await new Promise(r => setTimeout(r, 800));
      setCloneProgress(2);
      await new Promise(r => setTimeout(r, 800));
      setCloneProgress(3);
      await new Promise(r => setTimeout(r, 800));
      setCloneProgress(4);
      await new Promise(r => setTimeout(r, 800));

      const clonePrompt = `
CLONE TARGET: ${cloneUrl}
TITLE: ${data.title}
DESCRIPTION: ${data.metaDescription}

VISUAL IDENTITY:
- Detected color palette: ${data.colors.join(', ')}
- Detected fonts: ${data.fonts.join(', ')}

LAYOUT STRUCTURE (${data.sections.length} sections detected):
${data.sections.map((s: any, i: number) => `${i+1}. <${s.tag}> "${s.text}"`).join('\n')}

NAVIGATION ITEMS: ${data.links.slice(0, 8).join(' | ')}
KEY HEADINGS: ${data.headings.slice(0, 8).join(' | ')}
CONTENT SAMPLE: ${data.bodyText.substring(0, 800)}

INSTRUCTIONS:
Recreate this website as a pixel-accurate React 19 + Tailwind CSS clone.
- Match the color palette exactly using the detected colors above
- Recreate every detected section with similar layout and content
- Use the same navigation structure
- Make it fully responsive
- Add smooth scroll animations between sections
- Backend: FastAPI with a /api/health endpoint
`;

      const ns = await createSession(data.title || 'Cloned Project');
      if (ns) {
          setActiveSession(ns);
          setPrompt(clonePrompt);
          setRectifiedPrompt(clonePrompt);
          // Auto-trigger build
          setTimeout(() => {
              handleApproveAndBuild();
          }, 500);
      }
    } catch (e: any) {
      showToast(`Analysis failed: ${e.message}`, 'error');
    } finally {
      setIsAnalyzing(false);
      setCloneProgress(0);
    }
  }

  const askClarifications = async (input: string) => {
    setStatus('clarifying');
    setIsClarifying(true);

    const systemPrompt = `You are the Pre-Flight Clarification Agent for an AI full-stack code generator.
Your job: analyze the user's project prompt and generate 1 to 3 SHORT clarifying questions that would significantly change the architecture or implementation.

RULES:
- Maximum 3 questions. Minimum 1. Only ask if genuinely ambiguous.
- If the prompt is already detailed and unambiguous, return { "questions": [] } and we skip clarification entirely.
- Each question must be actionable — the answer must change what code gets written.
- Prefer yes/no or multiple-choice over open text.
- Do NOT ask about deployment, hosting, or timeline.
- Do NOT ask obvious things ("Should it look good?" — never ask this).
- Question types: "yesno", "choice" (provide 2-4 options), "text" (for short answers only when necessary).

GOOD questions:
- "Should users be able to create accounts and log in?" (yesno)
- "What's the primary data store?" (choice: ["SQLite", "PostgreSQL", "MongoDB", "None — in-memory only"])
- "Should the app have a REST API or just a frontend?" (choice: ["REST API + Frontend", "Frontend only", "API only"])

BAD questions:
- "What color scheme do you prefer?" (not architectural)
- "Should it be fast?" (obviously yes)
- "What framework?" (your stack is fixed: React + FastAPI)

Return ONLY valid JSON in this exact shape:
{
  "questions": [
    { "id": "q1", "question": "...", "type": "yesno" | "choice" | "text", "options": ["...", "..."] }
  ]
}`;

    try {
      const response = await callAPI(
        TaskRouter.clarifier,
        systemPrompt,
        `User's project prompt: "${input}"`,
        false
      );

      const raw = response?.content || '';
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error('No JSON returned');

      const parsed = JSON.parse(jsonMatch[0]);
      const questions: ClarificationQuestion[] = (parsed.questions || []).map((q: any) => ({
        ...q,
        answer: null
      }));

      if (questions.length === 0) {
        setIsClarifying(false);
        setStatus('idle');
        rectifyPrompt(input);
        return;
      }

      setClarifications(questions);
      setIsClarifying(false);
    } catch (e) {
      setIsClarifying(false);
      setStatus('idle');
      rectifyPrompt(input);
    }
  };

  const rectifyPrompt = async (input: string, clarificationContext?: string) => {
    setStatus('rectifying');
    setPrompt(input);
    const fullInput = clarificationContext
      ? `${input}\n\nUSER CLARIFICATIONS:\n${clarificationContext}`
      : input;
    const content = (await callAPI(TaskRouter.rectification, 
        'You are the Senior Engineer Rectification Agent. Your goal is to translate an abstract user "vibe" into a strict technical specification. If a user asks for a vibe like "poppy", inject specific architectural requirements for spring animations (motion/react), bold shadow-xl utility classes, and high-contrast emerald/indigo color palettes without seeking clarification.', 
        fullInput
    ))?.content;
    setRectifiedPrompt(content || '');
    setStatus('prompt-review');
    showToast('Plan Rectified & Verified', 'success');
  };

  const submitClarifications = () => {
    const unanswered = clarifications.filter(q => q.answer === null);
    if (unanswered.length > 0) {
      showToast('Please answer all questions before proceeding', 'warning');
      return;
    }
    const context = clarifications.map(q => `Q: ${q.question}\nA: ${q.answer}`).join('\n\n');
    setClarifications([]);
    rectifyPrompt(prompt, context);
  };

  const phaseIndex = (phase: string) => {
    const match = phase.match(/phase-(\d+)/i);
    return match ? Number(match[1]) : 1;
  };

  const handleApproveAndBuild = async (startPhase: number = 1, restoredFiles: Record<string, string> = {}, restoredHistory: ChatMessage[] = []) => {
    setView('building');
    setStatus('building');
    setActiveTab('workspace');
    setIsGenerating(true);
    setIsGenerationQueued(false);
    if (startPhase === 1) setTerminalEntries([]);
    setActiveAgents({});
    if (startPhase > 1) {
      updateProjectFiles(restoredFiles);
      setChatHistory(restoredHistory);
    }
    
    const logger = (msg: string, role: ChatMessage['role'] = 'system') => setChatHistory(prev => [...prev, { role, content: msg }]);
    logger(`RECTIFIED SPEC: ${rectifiedPrompt}`, 'system');
    
    // Detect Clone Mode
    const isClone = rectifiedPrompt.trim().startsWith('CLONE TARGET:');
    const taskConfig = isClone ? TaskRouter.cloneMode : TaskRouter.draft;
    const additionalInstruction = isClone ? "\nThis is a pixel-accurate clone task. Match the visual design, colors, layout structure, and content hierarchy as closely as possible. Do NOT add generic placeholder content." : "";

    // PHASE 1: PLAN (Manifest Generation & SOUL.md Integration)
    const projectSoul = `# SOUL.md - Project Integrity State\n\n## Tech Stack\n- Backend: ${isClone ? 'Python 3.10 (FastAPI)' : 'Python 3.10 (FastAPI)'}\n- Frontend: React 19 + Tailwind CSS\n- UI Style: ${isClone ? 'Identical Clone' : 'Light & Soothing — warm beige surfaces (#f7f6f2 bg, #f9f8f5 cards), teal accent (#01696f), Satoshi body font, Boska display font'}\n\n## Design System (The Vibe)\n- Spec: ${rectifiedPrompt.substring(0, 500)}\n\n## Verification Status\n- Build Status: Awaiting Pulse Check\n`;
    let currentFiles: Record<string, string> = startPhase > 1 ? { ...restoredFiles } : { 'SOUL.md': projectSoul };

    if (startPhase <= 1) {
      logger('PHASE 1: Extracting Project Soul...');
      setActiveAgents({ 'Architect': TaskRouter.rectification.model });
      
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
      logger(`PHASE 1: "The Draft" - Synthesizing full stack ${isClone ? 'clone' : 'logic'}...`, 'system');
      setActiveAgents({ 'Drafting': taskConfig.model });
      
      const [backendRes, frontendRes, cssRes, reqsRes, dockerRes] = await Promise.all([
          callAPI(taskConfig, `DRAFT PHASE: Generate pure Python FastAPI code. Define any efficient port. ONLY PURE CODE.${additionalInstruction}`, `Build FastAPI backend for: ${rectifiedPrompt}`, false, logger),
          callAPI(taskConfig, `DRAFT PHASE: Generate React 19 code. API base should dynamically target the backend. ONLY PURE CODE.${additionalInstruction}`, `Build React frontend for: ${rectifiedPrompt}`, false, logger),
          callAPI(taskConfig, `DRAFT PHASE: Generate Tailwind @layer CSS for optimized theme.${additionalInstruction}`, `CSS for: ${rectifiedPrompt}`, false, logger),
          callAPI(taskConfig, `DRAFT PHASE: Generate backend/requirements.txt. Include any required dependencies (beta/nightly allowed).${additionalInstruction}`, `Requirements for: ${rectifiedPrompt}`, false, logger),
          callAPI(taskConfig, `DRAFT PHASE: Generate Dockerfile. Expose appropriate ports. ONLY PURE CODE.${additionalInstruction}`, `Dockerfile for: ${rectifiedPrompt}`, false, logger)
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
      currentFiles = initialFiles;
      if (activeSession) await saveCheckpoint(activeSession.id, 'phase-1', currentFiles, chatHistoryRef.current);
    }

    // PHASE 2: AUDIT (Heavyweight Integrity Check via GPT-OSS)
    if (startPhase <= 2) {
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
              currentFiles = purgedFiles;
          } catch (e) {
              logger('Audit refinement failed. Continuing to verification.', 'warning');
          }
      }
      if (activeSession) await saveCheckpoint(activeSession.id, 'phase-2', filesSnapshotRef.current, chatHistoryRef.current);
    }

    const agenticTerminalRun = async (primary: string, fallbacks: string[], workdir: string = '/') => {
        logger(`Running: ${primary}...`, 'system');
        let resRaw = await executeToolCall({ function: { name: 'terminal_run', arguments: JSON.stringify({ command: primary, workdir }) } }, logger);
        let status: any;
        try {
            status = JSON.parse(resRaw);
        } catch (e) {
            status = { exit_code: -1, stderr: String(resRaw) };
        }
        
        if (status.exit_code !== 0) {
            for (const fallback of fallbacks) {
                logger(`Primary failed. Trying fallback: ${fallback}...`, 'warning');
                resRaw = await executeToolCall({ function: { name: 'terminal_run', arguments: JSON.stringify({ command: fallback, workdir }) } }, logger);
                try {
                    status = JSON.parse(resRaw);
                } catch (e) {
                    status = { exit_code: -1, stderr: String(resRaw) };
                }
                if (status.exit_code === 0) break;
            }
        }
        return status;
    };

    // PHASE 3 & 4: RAPID PATCH & AGENTIC VERIFICATION
    let buildSuccess = false;
    if (startPhase <= 3) {
      logger('PHASE 3: "The Rapid Patch" - Initiating Agentic Verification...', 'system');
      setIsVerifying(true);
      setActiveAgents({ 'Patching': TaskRouter.rapidPatch.model });
      
      let buildAttempts = 0;
      while (buildAttempts < 3) {
          buildAttempts++;
          logger(`Verification Cycle ${buildAttempts}/3...`, 'system');
          
          await executeToolCall({ function: { name: 'fs_sync', arguments: JSON.stringify({ files: filesSnapshotRef.current }) } }, logger);

          // AGENTIC INSTALL & CHECK
          await agenticTerminalRun(
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
      if (activeSession) await saveCheckpoint(activeSession.id, 'phase-3', filesSnapshotRef.current, chatHistoryRef.current);
    }

    // Final SOUL sync
    if (startPhase <= 4) {
      const finalFiles = { ...filesSnapshotRef.current };
      finalFiles['SOUL.md'] = (finalFiles['SOUL.md'] || '') + `\n## Final Audit\n- Verified: ${buildSuccess ? 'SUCCESS' : 'FAILURE'}\n- Iterations: ${3}\n- Time: ${new Date().toISOString()}\n`;
      updateProjectFiles(finalFiles);
      if (activeSession) await saveCheckpoint(activeSession.id, 'phase-4', finalFiles, chatHistoryRef.current);
    }

    setIsVerifying(false);
    setIsGenerating(false);
    setActiveAgents({});
    logger('PHASE 5: Environment Stabilized. The Senior Engineer has signed off on the codebase.', 'ai');
    showToast(buildSuccess ? 'Cluster Stabilized' : 'Build Compromised', buildSuccess ? 'success' : 'error');
  };

  const resumeBuildFromCheckpoint = async () => {
    if (!activeSession || !resumeCheckpoint) return;
    const nextPhase = phaseIndex(resumeCheckpoint.phase) + 1;
    const restoredPrompt = resumeCheckpoint.chatHistory.find(msg => msg.content.startsWith('RECTIFIED SPEC:'))?.content.replace('RECTIFIED SPEC: ', '') || rectifiedPrompt;
    setPrompt(restoredPrompt);
    setRectifiedPrompt(restoredPrompt);
    setResumeCheckpoint(null);
    await handleApproveAndBuild(nextPhase, resumeCheckpoint.files, resumeCheckpoint.chatHistory);
  };

  const statusOverlays = (
    <>
      <AnimatePresence>
        {!isOnline && (
          <motion.div
            initial={{ y: -40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -40, opacity: 0 }}
            className="fixed top-0 left-0 w-full z-50 bg-amber-50 border-b border-amber-200 px-6 py-2 flex items-center gap-3 text-amber-800 text-sm font-bold"
          >
            <WifiOff className="w-4 h-4" />
            Offline — LLMs are still working on the cloud. Results will sync on reconnect.
          </motion.div>
        )}
      </AnimatePresence>
      <AnimatePresence>
        {resumeCheckpoint && activeSession && (
          <motion.div
            initial={{ y: -20, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: -20, opacity: 0 }}
            className="fixed top-14 left-1/2 -translate-x-1/2 z-40 bg-[#f9f8f5] border border-alpha shadow-warm rounded-full px-5 py-3 flex items-center gap-4 text-sm font-bold text-[#2d2d2d]"
          >
            <span>Resume incomplete build?</span>
            <button onClick={resumeBuildFromCheckpoint} className="px-4 py-1.5 rounded-full bg-[#01696f] text-white text-xs uppercase tracking-widest">
              Resume
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );

  // Core direct send logic extracted so it can be called by the queue processor.
  const sendFollowUpDirect = async (instruction: string) => {
    if (!instruction.trim()) return;

    const userMsg = instruction;
    // Mirror previous behavior: add user message to chat (caller clears followUp)
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
                for (const call of heal?.tool_calls) {
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

  // Queue helpers
  const addToQueue = (instruction: string) => {
    if (!instruction || !instruction.trim()) return;
    const item: QueuedInstruction = {
      id: Math.random().toString(36).substring(2, 9),
      instruction: instruction.trim(),
      queuedAt: Date.now(),
      status: 'queued'
    };
    setInstructionQueue(prev => [...prev, item]);
    setQueueInput('');
    showToast('Instruction queued', 'info');
    // If agent is free, start processing immediately
    if (!isGenerating && !isProcessingQueue.current) {
      processQueue();
    }
  };

  const processQueue = async () => {
    if (isProcessingQueue.current) return;
    isProcessingQueue.current = true;

    while (true) {
      // Get next queued item
      let nextItem: QueuedInstruction | null = null;
      setInstructionQueue(prev => {
        const idx = prev.findIndex(i => i.status === 'queued');
        if (idx === -1) return prev;
        nextItem = prev[idx];
        return prev.map((i, ii) => ii === idx ? { ...i, status: 'processing' } : i);
      });

      // Small delay to let state settle
      await new Promise(r => setTimeout(r, 50));

      if (!nextItem) break; // Queue empty

      try {
        // Set the follow-up input (visible) and trigger sendFollowUpDirect
        setFollowUp((nextItem as QueuedInstruction).instruction);
        await sendFollowUpDirect((nextItem as QueuedInstruction).instruction);
        setInstructionQueue(prev => prev.map(i => i.id === (nextItem as QueuedInstruction).id ? { ...i, status: 'done' } : i));
      } catch (e) {
        setInstructionQueue(prev => prev.map(i => i.id === (nextItem as QueuedInstruction).id ? { ...i, status: 'failed' } : i));
      }

      // Auto-clear done items older than 5 seconds
      setTimeout(() => {
        setInstructionQueue(prev => prev.filter(i => i.status !== 'done'));
      }, 5000);
    }

    isProcessingQueue.current = false;
  };

  // Public send handler (used by button/Enter)
  const sendFollowUp = async () => {
    if (!followUp.trim()) return;
    if (isGenerating) {
      addToQueue(followUp);
      setFollowUp('');
      return;
    }

    // Agent free — send immediately
    const toSend = followUp;
    setFollowUp('');
    await sendFollowUpDirect(toSend);
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
        setClarifications([]);
        setIsClarifying(false);
        setActiveTab('workspace');
        setCompressedContext('');
        setProjectFiles({});
        setSelectedFile('');
        setActiveAgents({});
        setActiveSession(null);
        setResumeCheckpoint(null);
        localStorage.removeItem('ai-architect-last-session-id');
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

  if (authLoading) {
    return (
      <div className="min-h-screen bg-[#f7f6f2] flex items-center justify-center">
        {statusOverlays}
        <LoaderCircle className="w-8 h-8 animate-spin text-[#01696f]" />
      </div>
    );
  }

  if (!user) {
    return (
      <div className="min-h-screen bg-[#f7f6f2] flex items-center justify-center px-6 text-[#2d2d2d]">
        {statusOverlays}
        <motion.div className="w-full max-w-sm bg-[#f9f8f5] shadow-warm rounded-[16px] p-10 border border-alpha text-center">
          <div className="flex items-center justify-center gap-3 mb-4">
            <Box className="w-8 h-8 text-[#01696f]" />
            <h1 className="text-2xl font-bold font-display">AI Architect</h1>
          </div>
          <p className="text-sm uppercase tracking-[0.25em] text-[#6b6b6b] font-bold mb-10">The Agentic Full-Stack Engineer</p>
          <div className="space-y-3">
            <motion.button whileTap={{ scale: 0.98 }} onClick={() => signInWithGoogle()} className="w-full bg-white border border-alpha rounded-[12px] px-4 py-3.5 flex items-center justify-center gap-3 font-bold premium-transition hover:shadow-sm">
              <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.72 1.22 9.23 3.6l6.9-6.9C35.94 2.57 30.52 0 24 0 14.62 0 6.49 5.38 2.51 13.21l8.03 6.23C12.43 13.02 17.64 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.5 24.5c0-1.58-.14-3.1-.39-4.5H24v9h12.72c-.55 2.95-2.22 5.45-4.72 7.12l7.35 5.71C43.88 37.49 46.5 31.65 46.5 24.5z" />
                <path fill="#FBBC05" d="M10.54 28.44A14.5 14.5 0 0 1 10 24c0-1.52.26-2.99.72-4.44l-8.03-6.23A23.96 23.96 0 0 0 0 24c0 3.84.91 7.47 2.51 10.67l8.03-6.23z" />
                <path fill="#34A853" d="M24 48c6.52 0 11.96-2.16 15.94-5.88l-7.35-5.71c-2.04 1.37-4.66 2.18-8.59 2.18-6.36 0-11.57-3.52-13.46-8.5l-8.03 6.23C6.49 42.62 14.62 48 24 48z" />
              </svg>
              Continue with Google
            </motion.button>
            <motion.button whileTap={{ scale: 0.98 }} onClick={() => signInWithGithub()} className="w-full bg-[#24292e] text-white rounded-[12px] px-4 py-3.5 flex items-center justify-center gap-3 font-bold premium-transition hover:shadow-sm">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                <path d="M12 .5C5.65.5.5 5.72.5 12.2c0 5.18 3.29 9.57 7.86 11.13.58.11.79-.26.79-.57v-2.2c-3.2.71-3.88-1.57-3.88-1.57-.52-1.37-1.27-1.74-1.27-1.74-1.04-.73.08-.72.08-.72 1.15.08 1.75 1.22 1.75 1.22 1.03 1.79 2.71 1.27 3.37.97.1-.75.4-1.27.73-1.56-2.55-.3-5.24-1.31-5.24-5.83 0-1.29.44-2.34 1.16-3.17-.12-.3-.5-1.5.11-3.13 0 0 .95-.31 3.11 1.21a10.4 10.4 0 0 1 5.66 0c2.16-1.52 3.11-1.21 3.11-1.21.61 1.63.23 2.83.11 3.13.72.83 1.16 1.88 1.16 3.17 0 4.53-2.69 5.53-5.25 5.82.41.36.78 1.07.78 2.16v3.2c0 .31.21.68.8.56 4.56-1.56 7.85-5.94 7.85-11.12C23.5 5.72 18.35.5 12 .5Z" />
              </svg>
              Continue with GitHub
            </motion.button>
          </div>
          <p className="mt-8 text-xs text-[#6b6b6b]">By signing in, you agree to use this responsibly.</p>
        </motion.div>
      </div>
    );
  }

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-[#f7f6f2] text-[#2d2d2d] flex flex-col md:flex-row font-sans">
        {statusOverlays}
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
              <div className="flex gap-4 items-center">
                <div className="flex items-center gap-3">
                  <img src={user.photoURL || `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(user.displayName || user.email || user.uid)}`} alt={user.displayName || 'User'} className="w-8 h-8 rounded-full object-cover border border-alpha" />
                  <span className="text-sm font-bold max-w-32 truncate">{user.displayName || user.email || 'Signed in'}</span>
                </div>
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
                <div className="flex flex-col gap-6 w-full">
                  {!isUrlMode ? (
                    <>
                      <textarea
                        className="flex-1 w-full p-6 bg-[#f7f6f2] border border-alpha rounded-[8px] focus:ring-2 focus:ring-[#01696f]/20 focus:border-[#01696f] focus:outline-none resize-none transition-all placeholder:text-[#6b6b6b]/50 text-sm font-medium"
                        placeholder="Describe your next massive project..."
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        rows={3}
                      />
                      <div className="flex justify-between items-center">
                        <button 
                          onClick={() => setIsUrlMode(true)}
                          className="text-[10px] font-bold text-[#6b6b6b] hover:text-[#01696f] uppercase tracking-widest premium-transition"
                        >
                          Or clone from URL
                        </button>
                        <motion.button 
                          whileHover={{ scale: 1.01 }}
                          whileTap={{ scale: 0.98 }}
                          onClick={async () => {
                              const ns = await createSession(prompt.substring(0, 30) || "Dynamic Venture");
                              if (ns) {
                                  setActiveSession(ns);
                                  askClarifications(prompt);
                              }
                          }}
                          disabled={!prompt.trim()}
                          className="px-12 py-4 bg-[#01696f] text-white font-bold rounded-[8px] shadow-xl shadow-[#01696f]/20 premium-transition hover:translate-y-[-2px] active:scale-95 disabled:opacity-50 disabled:translate-y-0 flex items-center gap-3"
                        >
                          <SparklesIcon />
                          Initiate Build
                        </motion.button>
                      </div>
                    </>
                  ) : (
                    <div className="space-y-6">
                      <div className="flex flex-col sm:flex-row gap-4">
                        <div className="flex-1 relative">
                          <Globe className="absolute left-6 top-1/2 -translate-y-1/2 w-4 h-4 text-[#01696f]" />
                          <input 
                            type="text"
                            placeholder="https://example.com — paste any website"
                            className="w-full pl-14 pr-6 py-4 bg-[#f7f6f2] border border-alpha rounded-[8px] focus:ring-2 focus:ring-[#01696f]/20 focus:border-[#01696f] focus:outline-none text-sm font-medium"
                            value={cloneUrl}
                            onChange={(e) => setCloneUrl(e.target.value)}
                          />
                        </div>
                        <button 
                          onClick={handleCloneFromUrl}
                          disabled={isAnalyzing || !cloneUrl.trim()}
                          className="px-10 py-4 bg-[#01696f] text-white font-bold rounded-[8px] shadow-xl shadow-[#01696f]/20 premium-transition hover:translate-y-[-2px] active:scale-95 disabled:opacity-50 flex items-center justify-center gap-3 whitespace-nowrap min-w-[220px]"
                        >
                          {isAnalyzing ? <RefreshCcw className="w-4 h-4 animate-spin" /> : <Globe className="w-4 h-4" />}
                          Analyze & Clone
                        </button>
                      </div>
                      
                      {isAnalyzing && (
                        <div className="grid grid-cols-1 md:grid-cols-4 gap-4 animate-in fade-in slide-in-from-bottom-2">
                          {[
                            "Scraping layout structure...",
                            "Extracting color palette...",
                            "Mapping component hierarchy...",
                            "Synthesizing clone specification..."
                          ].map((step, i) => (
                            <div key={i} className={`flex items-center gap-3 p-4 rounded-[8px] border premium-transition ${cloneProgress > i ? 'bg-[#01696f]/5 border-[#01696f]/20 opacity-100' : 'bg-transparent border-alpha opacity-30'}`}>
                              {cloneProgress > i ? <Check className="w-3.5 h-3.5 text-[#01696f]" /> : <div className="w-3.5 h-3.5 rounded-full border border-current" />}
                              <span className="text-[10px] font-bold uppercase tracking-tight truncate">{step}</span>
                            </div>
                          ))}
                        </div>
                      )}

                      <button 
                        onClick={() => { setIsUrlMode(false); setIsAnalyzing(false); setCloneProgress(0); }}
                        className="text-[10px] font-bold text-[#6b6b6b] hover:text-[#01696f] uppercase tracking-widest premium-transition mt-2"
                      >
                        ← Back to standard prompt
                      </button>
                    </div>
                  )}
                </div>
              )}
              
              {status === 'clarifying' && isClarifying && (
                <div className="py-12 text-[#01696f] w-full text-center font-bold flex items-center justify-center gap-4 text-lg">
                  <RefreshCcw className="w-6 h-6 animate-spin" />
                  <span className="shimmer bg-clip-text text-transparent uppercase tracking-widest text-sm">
                    Analyzing requirements...
                  </span>
                </div>
              )}

              {clarifications.length > 0 && (
                <motion.div 
                  initial={{ opacity: 0, y: 20 }} 
                  animate={{ opacity: 1, y: 0 }}
                  className="w-full space-y-6 stagger-fade-in"
                >
                  <div className="flex items-center gap-3 mb-2">
                    <div className="w-8 h-8 rounded-full bg-[#01696f15] flex items-center justify-center">
                      <Bot className="w-4 h-4 text-[#01696f]" />
                    </div>
                    <div>
                      <p className="font-bold text-[#2d2d2d] text-sm">Pre-Flight Check</p>
                      <p className="text-[10px] text-[#6b6b6b] uppercase tracking-widest font-bold">
                        {clarifications.length} question{clarifications.length > 1 ? 's' : ''} to optimize your build
                      </p>
                    </div>
                  </div>

                  {clarifications.map((q, idx) => (
                    <motion.div
                      key={q.id}
                      initial={{ opacity: 0, y: 12 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: idx * 0.1 }}
                      className="bg-[#f9f8f5] border border-alpha rounded-[12px] p-6"
                    >
                      <p className="font-bold text-[#2d2d2d] text-sm mb-4 flex items-start gap-2">
                        <span className="text-[#01696f] font-black">{idx + 1}.</span>
                        {q.question}
                      </p>

                      {q.type === 'yesno' && (
                        <div className="flex gap-3">
                          {['Yes', 'No'].map(opt => (
                            <button
                              key={opt}
                              onClick={() => setClarifications(prev => prev.map(cq => cq.id === q.id ? { ...cq, answer: opt } : cq))}
                              className={`flex-1 py-3 rounded-[8px] text-sm font-bold border premium-transition
                                ${q.answer === opt 
                                  ? 'bg-[#01696f] text-white border-[#01696f] shadow-lg shadow-[#01696f15]' 
                                  : 'bg-[#f7f6f2] text-[#2d2d2d] border-alpha hover:border-[#01696f30] hover:bg-[#f3f0ec]'
                                }`}
                            >
                              {opt === 'Yes' ? '✓ Yes' : '✗ No'}
                            </button>
                          ))}
                        </div>
                      )}

                      {q.type === 'choice' && (
                        <div className="flex flex-wrap gap-2">
                          {(q.options || []).map(opt => (
                            <button
                              key={opt}
                              onClick={() => setClarifications(prev => prev.map(cq => cq.id === q.id ? { ...cq, answer: opt } : cq))}
                              className={`px-4 py-2 rounded-full text-xs font-bold border premium-transition
                                ${q.answer === opt
                                  ? 'bg-[#01696f] text-white border-[#01696f] shadow-md'
                                  : 'bg-[#f7f6f2] text-[#6b6b6b] border-alpha hover:border-[#01696f30] hover:text-[#2d2d2d]'
                                }`}
                            >
                              {opt}
                            </button>
                          ))}
                        </div>
                      )}

                      {q.type === 'text' && (
                        <input
                          type="text"
                          placeholder="Type your answer..."
                          value={q.answer || ''}
                          onChange={e => setClarifications(prev => prev.map(cq => cq.id === q.id ? { ...cq, answer: e.target.value } : cq))}
                          className="w-full px-4 py-3 bg-[#f7f6f2] border border-alpha rounded-[8px] text-sm font-medium focus:ring-2 focus:ring-[#01696f20] focus:border-[#01696f] focus:outline-none premium-transition"
                        />
                      )}
                    </motion.div>
                  ))}

                  <div className="flex gap-4">
                    <motion.button
                      whileHover={{ scale: 1.01 }}
                      whileTap={{ scale: 0.98 }}
                      onClick={submitClarifications}
                      className="flex-1 py-4 bg-[#01696f] text-white rounded-[8px] font-bold shadow-xl shadow-[#01696f10] premium-transition"
                    >
                      Confirm & Build →
                    </motion.button>
                    <button
                      onClick={() => { setClarifications([]); rectifyPrompt(prompt); }}
                      className="px-8 py-4 bg-[#efebe3] text-[#2d2d2d] rounded-[8px] font-bold border border-alpha premium-transition hover:bg-[#e8e4dc]"
                    >
                      Skip — use defaults
                    </button>
                  </div>
                </motion.div>
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
      {statusOverlays}
      {/* Sidebar: Chat */}
      <ChatPanel
        chatHistory={chatHistory}
        followUp={followUp}
        setFollowUp={setFollowUp}
        isGenerating={isGenerating}
        sendFollowUpDirect={sendFollowUpDirect}
        queueInput={queueInput}
        setQueueInput={setQueueInput}
        instructionQueue={instructionQueue}
        addToQueue={addToQueue}
        chatEndRef={chatEndRef}
      />

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
                <div className="flex items-center gap-3">
                  <img src={user.photoURL || `https://api.dicebear.com/9.x/thumbs/svg?seed=${encodeURIComponent(user.displayName || user.email || user.uid)}`} alt={user.displayName || 'User'} className="w-8 h-8 rounded-full object-cover border border-alpha" />
                  <span className="text-xs font-bold max-w-32 truncate">{user.displayName || user.email || 'Signed in'}</span>
                </div>
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
                        onClick={() => {
                            setActiveTab(tab);
                            if (tab === 'preview') startPreview();
                        }}
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
                            {isGenerating && !isOnline && (
                              <span className="px-3 py-1 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-[10px] font-bold uppercase tracking-widest">Queued — will resume on reconnect</span>
                            )}
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

                <TerminalPanel terminalEntries={terminalEntries} setTerminalEntries={setTerminalEntries} commandQueue={commandQueue} setCommandQueue={setCommandQueue} aiExecuteMode={aiExecuteMode} setAiExecuteMode={setAiExecuteMode} executeAllQueued={executeAllQueued} runTerminalCommand={runTerminalCommand} terminalEndRef={terminalEndRef} />

                </div>
            </motion.div>
          )}

          {activeTab === 'codebase' && (
            <div className="h-full flex p-8 gap-8 bg-[#f7f6f2]">
                <div className="w-72">
              <FileTree projectFiles={projectFiles} selectedFile={selectedFile} setSelectedFile={setSelectedFile} contextMenu={contextMenu} setContextMenu={setContextMenu} confirmAction={confirmAction} showToast={showToast} />
            </div>
                <div className="flex-1 bg-white rounded-[12px] border border-alpha shadow-2xl overflow-hidden flex flex-col relative stagger-fade-in" style={{ animationDelay: '150ms' }}>
                    <div className="bg-[#f9f8f5] px-6 py-3 border-b border-alpha flex items-center justify-between">
                        <div className="flex items-center gap-4">
                            <span className="text-[#2d2d2d] font-bold font-mono text-[11px]">{selectedFile || 'PROJECT_ROOT'}</span>
                            {selectedFile && (
                                <div className="px-2 py-0.5 bg-[#01696f]/5 text-[#01696f] text-[9px] font-bold rounded uppercase tracking-widest border border-[#01696f]/10">
                                    {selectedFile.substring(selectedFile.lastIndexOf('.') + 1) || 'text'}
                                </div>
                            )}
                            <div className="h-4 w-px bg-alpha mx-2" />
                            <span className="text-[10px] font-mono text-[#6b6b6b] font-bold">LN {cursorPos.line}, COL {cursorPos.col}</span>
                        </div>
                        <div className="flex items-center gap-4">
                            {selectedFile && (
                                <button 
                                    onClick={() => {
                                        navigator.clipboard.writeText(projectFiles[selectedFile]);
                                        showToast('Code copied to clipboard', 'success');
                                    }}
                                    className="p-1.5 hover:bg-[#efebe3] rounded-[6px] text-[#6b6b6b] transition-colors"
                                    title="Copy Code"
                                >
                                    <Copy className="w-4 h-4" />
                                </button>
                            )}
                            {isRecompiling && (
                                <span className="text-[10px] font-bold text-[#01696f] uppercase tracking-[0.2em] flex items-center gap-2.5"><RefreshCcw className="w-3 h-3 animate-spin"/> Handshaking...</span>
                            )}
                        </div>
                    </div>
                    {selectedFile ? (
                        <div id="monaco-container" className="flex-1 w-full h-full min-h-0" />
                    ) : (
                        <div className="flex-1 flex flex-col items-center justify-center bg-[#f9f8f5] opacity-40 gap-4">
                            <BotIcon />
                            <p className="text-[10px] font-bold uppercase tracking-[0.3em]">SELECT SOURCE TO INTEGRATE</p>
                        </div>
                    )}
                </div>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="h-full p-8 bg-[#f7f6f2]">
                {isPreviewLoading ? (
                    <div className="w-full h-full bg-[#f9f8f5] rounded-[12px] border border-alpha overflow-hidden shadow-warm flex flex-col items-center justify-center gap-6 stagger-fade-in relative">
                        <div className="shimmer absolute inset-0 opacity-10" />
                        <div className="relative">
                            <RefreshCcw className="w-12 h-12 text-[#01696f] animate-spin" />
                            <div className="absolute -inset-4 bg-[#01696f]/5 rounded-full animate-ping" />
                        </div>
                        <div className="text-center">
                            <h4 className="text-[#2d2d2d] font-bold text-lg mb-2 font-display uppercase tracking-widest">Spinning up runtime</h4>
                            <p className="text-xs text-[#6b6b6b] font-medium tracking-wider">ALLOCATING PORT AND MOUNTING VOLUME...</p>
                        </div>
                    </div>
                ) : previewUrl ? (
                    <div className="w-full h-full bg-white rounded-[12px] border border-alpha overflow-hidden shadow-warm flex flex-col relative stagger-fade-in">
                        <div className="bg-[#f9f8f5] border-b border-alpha px-6 py-3 flex items-center gap-6">
                            <div className="flex gap-2">
                                <button 
                                    onClick={() => iframeRef.current?.contentWindow?.location.reload()}
                                    className="p-1 hover:bg-[#efebe3] rounded transition-all text-[#6b6b6b]"
                                    title="Reload"
                                >
                                    <RefreshCcw className="w-3.5 h-3.5" />
                                </button>
                                <button 
                                    onClick={() => window.open(previewUrl)}
                                    className="p-1 hover:bg-[#efebe3] rounded transition-all text-[#6b6b6b]"
                                    title="Open Externally"
                                >
                                    <Globe className="w-3.5 h-3.5" />
                                </button>
                            </div>
                            <div className="flex-1 bg-[#f7f6f2] rounded-full border border-alpha px-5 py-1.5 flex items-center gap-3">
                                <Globe className="w-3.5 h-3.5 text-[#01696f]" />
                                <span className="text-[11px] font-mono text-[#6b6b6b] tracking-wider uppercase opacity-60 truncate">{previewUrl}</span>
                            </div>
                            <div className="flex items-center gap-2 px-3 py-1 bg-[#27c93f]/5 text-[#27c93f] rounded-full border border-[#27c93f]/10">
                                <div className="w-1.5 h-1.5 rounded-full bg-[#27c93f] animate-pulse" />
                                <span className="text-[9px] font-bold uppercase tracking-widest">Runtime Live</span>
                            </div>
                        </div>
                        <div className="flex-1 bg-white relative">
                            {isGenerating && (
                                <div className="absolute inset-0 bg-[#f9f8f5]/80 backdrop-blur-sm z-10 flex flex-col items-center justify-center gap-4">
                                    <RefreshCcw className="w-8 h-8 text-[#01696f] animate-spin" />
                                    <span className="text-xs font-bold text-[#01696f] uppercase tracking-[0.2em] font-sans">{!isOnline ? 'Queued — will resume on reconnect' : 'Hot Reloading State Tree...'}</span>
                                </div>
                            )}
                            <iframe 
                                ref={iframeRef}
                                className="w-full h-full bg-white transition-opacity duration-300" 
                                src={previewUrl} 
                                sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
                                title="Preview"
                            />
                        </div>
                    </div>
                ) : (
                    <div className="w-full h-full rounded-[12px] border-2 border-dashed border-[#6b6b6b]/20 flex items-center justify-center bg-[#f9f8f5] relative overflow-hidden stagger-fade-in group">
                        <motion.div animate={{ rotate: 360 }} transition={{ repeat: Infinity, duration: 15, ease: "linear" }} className="absolute -inset-40 bg-gradient-to-r from-transparent via-[#01696f]/5 to-transparent opacity-30 blur-3xl"></motion.div>
                        <div className="text-center relative z-10 w-full max-w-sm p-8">
                            <div className="w-24 h-24 bg-white rounded-full shadow-lg flex items-center justify-center mx-auto mb-8 border border-alpha premium-transition group-hover:scale-110 group-hover:rotate-12">
                                <Play className="w-10 h-10 text-[#01696f]/40 fill-current" />
                            </div>
                            <h4 className="text-[#2d2d2d] font-bold text-xl mb-4 font-display">Cluster Deployment Ready</h4>
                            <p className="text-sm text-[#6b6b6b] px-6 leading-relaxed font-medium mb-8">Generated resources are staged in the virtual container. Launch the isolated runtime to verify the build.</p>
                            <button 
                                onClick={startPreview}
                                className="px-8 py-3 bg-[#01696f] text-white font-bold rounded-full shadow-xl shadow-[#01696f]/20 premium-transition hover:translate-y-[-2px] active:scale-95 flex items-center gap-3 mx-auto"
                            >
                                <Play className="w-4 h-4 fill-current" />
                                Launch Preview
                            </button>
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
            {/* Portals: Toasts & Modal */}
        <>
          <ToastContainer toasts={toasts} removeToast={removeToast} />
          <ConfirmModal modal={modal} setModal={setModal} />
        </>


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
                      <div className="space-y-3">
                        <button className="w-full py-4 bg-[#01696f] text-white font-bold rounded-[8px] shadow-lg shadow-[#01696f]/10 premium-transition">Synchronize State</button>
                        <button onClick={async () => { await logout(); setView('landing'); setActiveSession(null); setIsDrawerOpen(false); localStorage.removeItem('ai-architect-last-session-id'); }} className="w-full py-4 bg-white text-[#2d2d2d] font-bold rounded-[8px] border border-alpha premium-transition flex items-center justify-center gap-2">
                          <LogOut className="w-4 h-4" />
                          Sign Out
                        </button>
                      </div>
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
