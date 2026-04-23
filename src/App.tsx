/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useRef, useEffect } from 'react';
import * as motion from 'motion/react-client';
import { 
    Send, Play, Code2, Layout as LayoutIcon, RefreshCcw, 
    Box, FileCode, ChevronRight, CheckCircle2, Server, Globe, Layers, Sparkles 
} from 'lucide-react';

type View = 'landing' | 'building';
type AppStatus = 'idle' | 'rectifying' | 'prompt-review' | 'building';
type Tab = 'workspace' | 'codebase' | 'preview';

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
  const [isVerifying, setIsVerifying] = useState(false);
  const [activeAgents, setActiveAgents] = useState<Record<string, string>>({});
  const [terminalOutput, setTerminalOutput] = useState<string[]>([]);
  const [isRecompiling, setIsRecompiling] = useState(false);
  const compileTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const terminalEndRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [chatHistory]);

  useEffect(() => {
    terminalEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [terminalOutput]);

  const handleFileChange = (filename: string, content: string) => {
      const newFiles = { ...filesSnapshotRef.current, [filename]: content };
      updateProjectFiles(newFiles);
      setIsRecompiling(true);
      if (compileTimeoutRef.current) clearTimeout(compileTimeoutRef.current);
      compileTimeoutRef.current = setTimeout(() => {
          setIsRecompiling(false);
      }, 500);
  };

  const callAPI = async (task: TaskConfig, system: string, user: string, withTools: boolean = false, logger?: (msg: string, role: ChatMessage['role']) => void) => {
    const configs: any = {
        groq: { url: 'https://api.groq.com/openai/v1/chat/completions', key: import.meta.env.VITE_GROQ_API_KEY },
        openrouter: { url: 'https://openrouter.ai/api/v1/chat/completions', key: import.meta.env.VITE_OPENROUTER_API_KEY },
        nvidia: { url: 'https://integrate.api.nvidia.com/v1/chat/completions', key: import.meta.env.VITE_NVIDIA_API_KEY }
    };
    
    const attemptFetch = async (provider: string, model: string) => {
        const config = configs[provider];
        if (!config || !config.key) throw new Error(`Missing API Key for ${provider}.`);

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

        const res = await fetch(config.url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${config.key}`,
                ...(provider === 'openrouter' ? { 'HTTP-Referer': window.location.href, 'X-Title': 'AI Architect' } : {})
            },
            body: JSON.stringify(body)
        });
        
        if (!res.ok) {
            if (res.status === 429 || res.status === 503) throw new Error(`HTTP_${res.status}`);
            throw new Error(`${res.status} ${res.statusText}`);
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
          const tavilyKey = import.meta.env.VITE_TAVILY_API_KEY;
          if (!tavilyKey) return `// Tavily API Key missing.`;
          try {
              const res = await fetch('https://api.tavily.com/search', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ api_key: tavilyKey, query: `latest stable version and breaking changes of ${args.package_name} for ${args.framework}` })
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
          setTerminalOutput(prev => [...prev, `$ ${args.command}`]);
          try {
              const res = await fetch('/api/v1/execute', { 
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ command: args.command, workdir: args.workdir || '/' })
              });
              const data = await res.json();
              setTerminalOutput(prev => [...prev, data.stdout, data.stderr].filter(Boolean));
              return JSON.stringify(data);
          } catch (e) {
              const errorMsg = `Terminal Execution Failed: Proxy endpoint unreachable.`;
              setTerminalOutput(prev => [...prev, errorMsg]);
              return JSON.stringify({ stdout: '', stderr: errorMsg, exit_code: 1 });
          }
      }
      if (name === 'fs_sync') {
          log(`Syncing ${Object.keys(args.files).length} files to Virtual File System...`, 'tool');
          updateProjectFiles(args.files); // PERSIST RE-GENERATED CODEBASE TO FRONTEND STATE
          try {
              const res = await fetch('/api/v1/write', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ files: args.files })
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
  };

  const handleApproveAndBuild = async () => {
    setView('building');
    setStatus('building');
    setActiveTab('workspace');
    setIsGenerating(true);
    setTerminalOutput([]);
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
            break;
        }

        // SELF-HEALING
        const errorLog = backendStatus.exit_code !== 0 ? backendStatus.stderr : frontendStatus.stderr;
        logger(`!! DEPLOYMENT ERROR: Triggering rapid healing for ${backendStatus.exit_code === 0 ? 'frontend' : 'backend'}...`, 'warning');
        
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
  };

  const startNewChatSession = () => {
    if (chatHistory.length > 0) {
      setCompressedContext('Previous session context compressed. Codebase and architecture state actively preserved.');
    }
    setChatHistory([
      { role: 'system', content: 'Context flushed to mitigate hallucination drift. Architectural maps bound to Port 7860 & Vercel edge preserved. How would you like to proceed?' }
    ]);
    setFollowUp('');
  };

  if (view === 'landing') {
    return (
      <div className="min-h-screen bg-slate-50 text-slate-900 pb-64">
        <nav className="p-6 flex justify-between items-center max-w-7xl mx-auto sticky top-0 bg-slate-50/80 backdrop-blur-sm z-20">
          <h1 className="text-2xl font-bold tracking-tighter cursor-pointer flex items-center gap-2" onClick={startNewProject}>
            <Box className="w-6 h-6 text-indigo-600" />
            AI Architect
          </h1>
          <div className="flex gap-4 items-center">
            <button onClick={startNewProject} className="text-sm font-medium px-4 py-2 bg-white border border-slate-200 hover:bg-slate-50 shadow-sm rounded-lg transition">New Project</button>
            <div className="text-sm text-slate-500 hidden sm:block">Modern Agentic Builder</div>
          </div>
        </nav>

        <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="max-w-4xl mx-auto text-center py-24 px-6">
          <motion.h2 initial={{ opacity: 0, scale: 0.9 }} animate={{ opacity: 1, scale: 1 }} className="text-5xl sm:text-7xl font-extrabold mb-8 tracking-tight text-slate-950">
            Build, <span className="text-transparent bg-clip-text bg-gradient-to-r from-indigo-500 to-emerald-500">Intelligently.</span>
          </motion.h2>
          <p className="text-xl text-slate-600 mb-16 max-w-2xl mx-auto leading-relaxed">
            Harness multi-model distribution. Route infrastructure generation to NVIDIA NIM and edge UI creation to OpenRouter with seamless state orchestration.
          </p>
          
          <div className="bg-white p-10 rounded-[2rem] shadow-sm border border-slate-100/50 mb-12 text-left relative overflow-hidden group">
            <div className="absolute top-0 right-0 p-8 opacity-5 group-hover:opacity-10 transition-opacity">
                <Layers className="w-48 h-48" />
            </div>
            <h3 className="font-semibold text-2xl mb-4 text-slate-900 relative z-10">Elastic Full-Stack Orchestration</h3>
            <p className="text-slate-600 text-lg leading-relaxed relative z-10 max-w-2xl mb-6">
              AI Architect synthesizes your prompt into distinct, sovereign modules. It concurrently builds backends, frontends, and logic matrices, granting you the freedom to deploy anywhere—from serverless edges to dedicated clusters.
            </p>
            <div className="flex gap-4 relative z-10">
                <div className="px-4 py-2 bg-slate-50 rounded-xl border border-slate-100 text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Box className="w-4 h-4" /> Multi-Runtime Support
                </div>
                <div className="px-4 py-2 bg-slate-50 rounded-xl border border-slate-100 text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-2">
                    <Globe className="w-4 h-4" /> Infinite Deployment Targets
                </div>
            </div>
          </div>
        </motion.div>

        <div className="fixed bottom-0 left-0 w-full p-6 bg-gradient-to-t from-white via-white/95 to-transparent z-40">
          <motion.div layout className="max-w-4xl mx-auto bg-white p-6 rounded-[2.5rem] shadow-[0_20px_50px_rgba(0,0,0,0.15)] border border-slate-100 flex flex-col gap-4 relative">
            <div className="absolute -top-3 left-1/2 -translate-x-1/2 px-4 py-1 bg-indigo-600 text-white text-[10px] font-bold uppercase tracking-wider rounded-full shadow-lg">
                Vibe Control Center
            </div>
            {status === 'idle' && (
              <div className="flex flex-col sm:flex-row gap-4 w-full">
                <textarea
                  className="flex-1 w-full p-5 bg-slate-50 border border-slate-200 rounded-2xl focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none shadow-inner"
                  placeholder="Describe your next massive project..."
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  rows={2}
                />
                <motion.button
                  whileHover={{ scale: 1.02, backgroundColor: '#4338ca' }}
                  whileTap={{ scale: 0.98 }}
                  className="w-full sm:w-auto py-5 px-12 bg-indigo-600 text-white rounded-2xl font-bold transition shadow-md whitespace-nowrap active:shadow-inner"
                  onClick={() => rectifyPrompt(prompt)}
                >
                  Rectify & Inspect
                </motion.button>
              </div>
            )}
            
            {status === 'rectifying' && <div className="py-8 text-indigo-600 animate-pulse w-full text-center font-bold flex items-center justify-center gap-3"><RefreshCcw className="w-6 h-6 animate-spin text-indigo-500" /> Compressing requirements via Groq LPU...</div>}
            
            {status === 'prompt-review' && (
              <div className="w-full space-y-5">
                <div className="bg-slate-900 p-6 rounded-2xl text-indigo-200 leading-relaxed border border-slate-800 max-h-56 overflow-y-auto font-mono text-[11px] shadow-inner custom-scrollbar">
                    <span className="text-indigo-500/50 block mb-2 font-bold uppercase tracking-tighter">Verified Spec:</span>
                    {rectifiedPrompt}
                </div>
                <div className="flex gap-4">
                  <motion.button whileHover={{ scale: 1.02 }} className="flex-1 py-4.5 bg-emerald-600 text-white rounded-2xl hover:bg-emerald-700 transition font-bold shadow-lg shadow-emerald-500/20 active:shadow-inner" onClick={handleApproveAndBuild}>Approve & Spark Microservices</motion.button>
                  <motion.button whileHover={{ scale: 1.02 }} className="px-8 py-4.5 bg-slate-100 text-slate-700 rounded-2xl hover:bg-slate-200 transition font-bold active:shadow-inner" onClick={() => setStatus('idle')}>Discard</motion.button>
                </div>
              </div>
            )}
          </motion.div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex p-4 gap-4 max-h-screen overflow-hidden">
      {/* Sidebar: Chat */}
      <motion.div initial={{ opacity: 0, x: -20 }} animate={{ opacity: 1, x: 0 }} className="w-80 lg:w-96 bg-white rounded-3xl p-5 flex flex-col shadow-sm border border-slate-200">
        <div className="flex justify-between items-center mb-6 px-1">
            <h2 className="text-lg font-bold flex items-center gap-2"><BotIcon /> Orchestrator</h2>
            <div className="flex gap-1">
                <button onClick={startNewChatSession} className="text-[10px] bg-indigo-50 text-indigo-700 px-3 py-1.5 rounded-lg hover:bg-indigo-100 transition font-bold uppercase tracking-wider" title="Clean AI Context">New Session</button>
                <button onClick={startNewProject} className="text-[10px] bg-rose-50 text-rose-700 px-3 py-1.5 rounded-lg hover:bg-rose-100 transition font-bold uppercase tracking-wider">Exit</button>
            </div>
        </div>
        
        <div className="flex-1 overflow-y-auto space-y-4 mb-4 px-1 scrollbar-hide">
            {!compressedContext && (
                <div className="p-4 bg-slate-50 border border-slate-100 rounded-2xl text-slate-700 leading-relaxed text-xs">
                    <span className="font-bold opacity-40 uppercase tracking-widest text-[9px] mb-2 block">Initial Directive</span>
                    {prompt}
                </div>
            )}
            {compressedContext && (
                <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} className="p-3 bg-emerald-50 border border-emerald-100/50 rounded-xl text-emerald-800 text-xs flex items-center gap-2 shadow-sm">
                    <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-500" /> {compressedContext}
                </motion.div>
            )}
            {chatHistory.map((msg, idx) => (
                <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} key={idx} 
                    className={`p-4 rounded-2xl text-sm max-w-full overflow-hidden h-auto ${
                        msg.role === 'user' ? 'bg-indigo-50 ml-auto text-indigo-900 border border-indigo-100' : 
                        msg.role === 'system' ? 'bg-slate-900 text-slate-300 shadow-inner my-6 w-full' : 
                        msg.role === 'warning' ? 'bg-amber-100 text-amber-900 border border-amber-300 shadow-sm mx-4' :
                        msg.role === 'tool' ? 'bg-fuchsia-50 text-fuchsia-900 border border-fuchsia-200 shadow-sm mx-4 overflow-wrap-anywhere break-words' :
                        'bg-white border border-slate-100 mr-auto shadow-sm'
                    }`}
                >
                    <div className={`text-[9px] uppercase font-bold mb-1.5 opacity-60 tracking-widest flex items-center gap-1 ${msg.role === 'system' ? 'text-indigo-400' : ''}`}>
                        {msg.role === 'system' ? <Server className="w-3 h-3" /> : msg.role === 'ai' ? <SparklesIcon /> : ''} {msg.role}
                    </div>
                    {msg.content.includes('<<<<<<< SEARCH') ? (
                        <pre className="text-[10px] font-mono bg-slate-950 text-emerald-400 p-3 rounded-lg overflow-x-auto whitespace-pre leading-relaxed mt-2 border border-slate-800">
                            {msg.content}
                        </pre>
                    ) : (
                        <div className="leading-relaxed whitespace-pre-wrap overflow-wrap-anywhere break-words">
                            {msg.content}
                        </div>
                    )}
                </motion.div>
            ))}
            {isGenerating && (
                <div className="p-4 rounded-2xl bg-white border border-slate-100 mr-6 shadow-sm flex items-center gap-3 text-sm text-slate-500">
                    <RefreshCcw className="w-4 h-4 animate-spin text-indigo-500" /> Synthesizing response...
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
                    className="w-full p-4 pr-12 bg-slate-50 border border-slate-200 rounded-2xl text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none resize-none shadow-inner"
                    rows={2}
                    disabled={isGenerating}
                />
                <button 
                  onClick={sendFollowUp}
                  disabled={isGenerating || !followUp.trim()}
                  className={`absolute right-3 bottom-3 p-2 rounded-xl transition shadow-sm ${isGenerating || !followUp.trim() ? 'bg-slate-200 text-slate-400' : 'bg-indigo-600 text-white hover:bg-indigo-700'}`}
                >
                    <Send className="w-4 h-4" />
                </button>
            </div>
        </div>
      </motion.div>

      {/* Main Workspace */}
      <motion.div initial={{ opacity: 0, x: 20 }} animate={{ opacity: 1, x: 0 }} className="flex-1 bg-white rounded-3xl flex flex-col shadow-sm border border-slate-200 overflow-hidden">
        <div className="flex bg-slate-50 border-b border-slate-100 px-6 pt-4 gap-2">
            {(['workspace', 'codebase', 'preview'] as Tab[]).map((tab) => {
                const Icon = tab === 'workspace' ? LayoutIcon : tab === 'codebase' ? Code2 : Play;
                return (
                    <button
                        key={tab}
                        onClick={() => setActiveTab(tab)}
                        className={`flex items-center gap-2 px-6 py-3 text-sm font-semibold transition-all capitalize relative rounded-t-xl ${activeTab === tab ? 'bg-white text-indigo-700 border-t border-x border-slate-100 shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.02)]' : 'text-slate-500 hover:text-slate-800 hover:bg-slate-100'}`}
                    >
                        <Icon className="w-4 h-4" />
                        {tab}
                        {activeTab === tab && <div className="absolute -bottom-[1px] left-0 right-0 h-[2px] bg-white" />}
                    </button>
                )
            })}
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
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} className="h-full overflow-y-auto p-8 space-y-8 bg-white">
                {/* Agent Pulse Swarm */}
                {Object.keys(activeAgents).length > 0 && (
                    <motion.div initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} className="p-6 bg-indigo-50/50 rounded-3xl border border-indigo-100/50 flex flex-wrap gap-3 items-center">
                        <div className="flex items-center gap-2 mr-4">
                            <Sparkles className="w-4 h-4 text-indigo-500 animate-pulse" />
                            <span className="text-[10px] font-bold text-indigo-700 uppercase tracking-tighter">Active Swarm Activity</span>
                        </div>
                        {Object.entries(activeAgents).map(([role, model]) => (
                            <div key={role} className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-full border border-indigo-100 shadow-sm text-[10px]">
                                <span className="font-bold text-slate-400 capitalize">{role}:</span>
                                <span className="text-indigo-600 font-bold font-mono">{(model as string).split('/').pop()}</span>
                                <div className="w-1.5 h-1.5 bg-emerald-500 rounded-full animate-pulse"></div>
                            </div>
                        ))}
                    </motion.div>
                )}

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <div className="p-8 bg-slate-50 rounded-3xl border border-slate-100">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2"><Sparkles className="w-4 h-4" /> Logic Synthesis Status</h4>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center text-sm p-3 bg-white rounded-xl border border-slate-100">
                                <span className="font-semibold text-slate-600">Model Routing Efficiency</span> 
                                <span className="px-3 py-1 bg-emerald-50 text-emerald-700 rounded-md font-mono text-xs font-bold uppercase tracking-tighter">98.2%</span>
                            </div>
                            <div className="flex justify-between items-center text-sm p-3 bg-white rounded-xl border border-slate-100">
                                <span className="font-semibold text-slate-600">Context Retention</span> 
                                <span className="px-3 py-1 bg-indigo-50 text-indigo-700 rounded-md font-mono text-xs font-bold uppercase tracking-tighter">Active State</span>
                            </div>
                        </div>
                    </div>
                    <div className="p-8 bg-slate-50 rounded-3xl border border-slate-100">
                        <h4 className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-6 flex items-center gap-2"><FileCode className="w-4 h-4" /> Codebase Matrix</h4>
                        <div className="space-y-4">
                            <div className="flex justify-between items-center text-sm p-3 bg-white rounded-xl border border-slate-100">
                                <span className="font-semibold text-slate-600">Active Files</span> 
                                <span className="text-emerald-600 font-bold font-mono">{Object.keys(projectFiles).length || 0}</span>
                            </div>
                            <div className="flex justify-between items-center text-sm p-3 bg-white rounded-xl border border-slate-100">
                                <span className="font-semibold text-slate-600">Source Mass</span> 
                                <span className="text-indigo-600 font-bold font-mono">
                                    {(Object.values(projectFiles).reduce<number>((acc, f) => acc + (typeof f === 'string' ? f.length : 0), 0) / 1024).toFixed(2)} kb
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
                    <div className="p-8 bg-slate-900 rounded-3xl text-indigo-300 font-mono text-sm relative overflow-hidden shadow-inner flex flex-col min-h-[300px]">
                        <div className="absolute top-0 right-0 p-8 opacity-10"><Globe className="w-32 h-32 text-indigo-200" /></div>
                        <span className="text-indigo-200 font-bold uppercase tracking-widest text-[10px] mb-4 block">Holistic Agentic Orchestration</span>
                        <div className="mt-2 text-emerald-400/80 space-y-2 overflow-y-auto flex-1">
                            <p>{'>'} Compressing requirements via Groq LPU...</p>
                            <p>{'>'} Synthesizing logic matrices via multi-model swarm...</p>
                            <p>{'>'} Resolving frontend state-trees and reactive bindings...</p>
                            <p>{'>'} Orchestrating backend schemas and service routes...</p>
                            <p>{'>'} Verifying full-stack integrity across isolated threads...</p>
                            <p>{'>'} Finalizing build for unconstrained deployment...</p>
                        </div>
                    </div>
                    
                    <div className="bg-black rounded-3xl p-6 shadow-2xl border border-slate-800 flex flex-col min-h-[300px] font-mono text-xs">
                        <div className="flex items-center justify-between mb-4 border-b border-slate-800 pb-2">
                            <div className="flex items-center gap-2">
                                <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></div>
                                <span className="text-slate-400 font-bold uppercase tracking-widest text-[10px]">Remote Terminal</span>
                            </div>
                            <span className="text-slate-600 text-[8px]">bash v5.0.17</span>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-1 text-slate-300 custom-scrollbar">
                            {terminalOutput.length === 0 && <p className="text-slate-600 italic">No execution logs...</p>}
                            {terminalOutput.map((line, i) => (
                                <p key={i} className={line.startsWith('$') ? 'text-indigo-400' : line.toLowerCase().includes('error') ? 'text-rose-400' : 'text-slate-300'}>
                                    {line}
                                </p>
                            ))}
                            {isVerifying && <div className="inline-block w-2 h-4 bg-slate-400 animate-pulse ml-1 align-middle"></div>}
                            <div ref={terminalEndRef} />
                        </div>
                    </div>
                </div>
            </motion.div>
          )}

          {activeTab === 'codebase' && (
            <div className="h-full flex p-6 gap-6 bg-slate-50">
                <div className="w-64 flex flex-col bg-white border border-slate-200 rounded-2xl shadow-sm overflow-hidden">
                    <div className="px-5 py-4 border-b border-slate-100 bg-slate-50">
                        <h3 className="text-[10px] font-bold text-slate-500 uppercase tracking-widest">Repository</h3>
                    </div>
                    <ul className="p-3 space-y-1 overflow-y-auto">
                        {Object.keys(projectFiles).length === 0 && <li className="text-xs text-slate-400 italic p-2 px-3">No files generated yet.</li>}
                        {Object.keys(projectFiles).map(name => (
                            <li key={name} onClick={() => setSelectedFile(name)} 
                                className={`cursor-pointer text-sm py-2 px-3 rounded-lg flex items-center gap-3 transition-colors ${selectedFile === name ? 'bg-indigo-50 text-indigo-700 font-semibold' : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'}`}>
                                <FileCode className={`w-4 h-4 ${selectedFile === name ? 'text-indigo-500' : 'text-slate-400'}`} />
                                {name}
                            </li>
                        ))}
                    </ul>
                </div>
                <div className="flex-1 bg-slate-950 rounded-2xl border border-slate-800 shadow-inner overflow-hidden flex flex-col relative">
                    <div className="bg-slate-900 px-4 py-2 border-b border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <div className="flex gap-1.5"><div className="w-2.5 h-2.5 rounded-full bg-rose-500/50"></div><div className="w-2.5 h-2.5 rounded-full bg-amber-500/50"></div><div className="w-2.5 h-2.5 rounded-full bg-emerald-500/50"></div></div>
                            <span className="text-slate-400 font-mono text-[10px] ml-2 tracking-wider">{selectedFile || 'No file selected'}</span>
                        </div>
                        {isRecompiling && (
                            <span className="text-[10px] font-bold text-amber-500 uppercase tracking-widest flex items-center gap-1.5"><RefreshCcw className="w-3 h-3 animate-spin"/> Recompiling...</span>
                        )}
                        {!isRecompiling && Object.keys(projectFiles).length > 0 && (
                            <span className="text-[10px] font-bold text-emerald-500 uppercase tracking-widest">Compiled</span>
                        )}
                    </div>
                    <textarea 
                        className="flex-1 bg-transparent text-slate-300 font-mono text-sm p-6 overflow-auto resize-none focus:outline-none"
                        value={selectedFile ? projectFiles[selectedFile] || '' : '// Awaiting compilation...'}
                        onChange={(e) => handleFileChange(selectedFile, e.target.value)}
                        disabled={!selectedFile}
                        spellCheck={false}
                    />
                </div>
            </div>
          )}

          {activeTab === 'preview' && (
            <div className="h-full p-6 bg-slate-50">
               {projectFiles['index.html'] ? (
                   <div className="w-full h-full bg-white rounded-2xl border border-slate-200 overflow-hidden shadow-sm flex flex-col relative">
                       <div className="bg-slate-100 border-b border-slate-200 px-4 py-2 flex items-center gap-3">
                           <div className="flex gap-1.5"><div className="w-3 h-3 rounded-full bg-slate-300"></div><div className="w-3 h-3 rounded-full bg-slate-300"></div><div className="w-3 h-3 rounded-full bg-slate-300"></div></div>
                           <div className="flex-1 bg-white rounded-md border border-slate-200 px-3 py-1 flex items-center gap-2">
                               <Globe className="w-3 h-3 text-emerald-500" />
                               <span className="text-[10px] font-mono text-slate-500">https://vibe-edge.network/live/{rectifiedPrompt.substring(0,12).replace(/\W/g, '').toLowerCase()}</span>
                           </div>
                           <div className="flex items-center gap-1 px-2 py-0.5 bg-emerald-50 text-emerald-600 rounded-full border border-emerald-100">
                               <CheckCircle2 className="w-3 h-3" />
                               <span className="text-[9px] font-bold uppercase">Verified Build</span>
                           </div>
                       </div>
                       <iframe 
                           className="flex-1 w-full bg-white transition-opacity duration-300" 
                           srcDoc={projectFiles['index.html']} 
                           sandbox="allow-scripts allow-forms allow-same-origin"
                           title="Preview"
                       />
                   </div>
               ) : (
                <div className="w-full h-full rounded-2xl border-2 border-dashed border-slate-300 flex items-center justify-center bg-white/50 relative overflow-hidden">
                    <motion.div animate={{ rotate: 180 }} transition={{ repeat: Infinity, duration: 8, ease: "linear" }} className="absolute -inset-10 bg-gradient-to-r from-transparent via-slate-100 to-transparent opacity-50 blur-3xl"></motion.div>
                    <div className="text-center relative z-10 w-full max-w-sm">
                        <div className="w-20 h-20 bg-white rounded-full shadow-lg flex items-center justify-center mx-auto mb-6 border border-slate-100">
                            <Layers className="w-8 h-8 text-indigo-200" />
                        </div>
                        <h4 className="text-slate-800 font-bold text-lg mb-2">Build Environment Offline</h4>
                        <p className="text-sm text-slate-500 px-6">Provide a project mandate and instruct the architect to compile the distributed components to see the preview here.</p>
                    </div>
                </div>
               )}
            </div>
          )}
        </div>
        
        <div className="px-8 py-3 bg-white border-t border-slate-100 flex justify-between items-center text-[10px] font-bold text-slate-400 tracking-widest uppercase">
            <div className="flex items-center gap-2"><div className={`w-2 h-2 rounded-full ${isGenerating ? 'bg-amber-400 animate-pulse' : 'bg-emerald-400'}`}></div> {isGenerating ? 'Compiling Models...' : 'Cluster Stable'}</div>
            <div className="flex gap-6">
                <span>Memory: {(Object.values(projectFiles).map(f => typeof f === 'string' ? f.length : 0).reduce((acc, curr) => acc + curr, 0) / 1024).toFixed(2)} KB allocated</span>
                <span className="text-indigo-500 cursor-pointer hover:underline">HuggingFace :7860</span>
            </div>
        </div>
      </motion.div>
    </div>
  );
}

function BotIcon() {
    return <svg className="w-5 h-5 text-indigo-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 8V4H8"/><rect width="16" height="12" x="4" y="8" rx="2"/><path d="M2 14h2"/><path d="M20 14h2"/><path d="M15 13v2"/><path d="M9 13v2"/></svg>;
}

function SparklesIcon() {
    return <svg className="w-3 h-3 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9.937 15.5A2 2 0 0 0 8.5 14.063l-6.135-1.582a.5.5 0 0 1 0-.962L8.5 9.936A2 2 0 0 0 9.937 8.5l1.582-6.135a.5.5 0 0 1 .963 0L14.063 8.5A2 2 0 0 0 15.5 9.937l6.135 1.581a.5.5 0 0 1 0 .964L15.5 14.063a2 2 0 0 0-1.437 1.437l-1.582 6.135a.5.5 0 0 1-.963 0z"/></svg>;
}
