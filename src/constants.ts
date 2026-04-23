export const TaskRouter = {
    // GROQ (Verified Routing Matrix)
    rectification: { provider: 'groq', model: 'llama-3.3-70b-versatile' } as const,
    clarifier: { provider: 'groq', model: 'llama-3.3-70b-versatile' } as const,
    compression: { provider: 'groq', model: 'llama-3.3-70b-versatile' } as const,
    toolController: { provider: 'groq', model: 'llama-3.3-70b-versatile' } as const,
    
    // THE SWARM PHASES
    draft: { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' } as const,
    audit: { provider: 'groq', model: 'openai/gpt-oss-120b' } as const,
    rapidPatch: { provider: 'groq', model: 'qwen/qwen3-32b' } as const,
    
    // NVIDIA NIM (Infrastructure)
    backendCore: { provider: 'nvidia', model: 'qwen3-coder-480b-a35b-instruct', fallback: { provider: 'groq', model: 'qwen/qwen3-32b' } } as const,
    agenticLogic: { provider: 'nvidia', model: 'deepseek-v3.2' } as const, 
    intermediateLogic: { provider: 'nvidia', model: 'llama-4-maverick-17b-128e-instruct', fallback: { provider: 'groq', model: 'meta-llama/llama-4-scout-17b-16e-instruct' } } as const,
    asyncOrchestration: { provider: 'nvidia', model: 'step-3.5-flash' } as const,

    // OPENROUTER (Frontend)
    refactoring: { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' } as const,
    apiInterfaces: { provider: 'openrouter', model: 'google/gemma-4-31b-it:free', fallback: { provider: 'groq', model: 'llama-3.3-70b-versatile' } } as const,
    frontendReact: { provider: 'openrouter', model: 'z-ai/glm-4.5-air:free' } as const,
    edgeCasesDocs: { provider: 'openrouter', model: 'openai/gpt-oss-120b:free', fallback: { provider: 'groq', model: 'openai/gpt-oss-120b' } } as const,
    validation: { provider: 'groq', model: 'openai/gpt-oss-120b' } as const, // Heavyweight for validation
    cloneMode: { provider: 'nvidia', model: 'qwen3-coder-480b-a35b-instruct', fallback: { provider: 'openrouter', model: 'nvidia/nemotron-3-super-120b-a12b:free' } } as const
} as const;

export const groqTools = [
    { type: "function", function: { name: "tavily_dependency_check", description: "Query package stats (e.g. react 19, tailwind 4, etc).", parameters: { type: "object", properties: { package_name: { type: "string" }, framework: { type: "string" } }, required: ["package_name", "framework"] } } },
    { type: "function", function: { name: "huggingface_space_init", description: "Generate README.md for Docker HuggingFace spaces using port 7860.", parameters: { type: "object", properties: { space_name: { type: "string" }, sdk: { type: "string", enum: ["docker", "gradio"] } }, required: ["space_name", "sdk"] } } },
    { type: "function", function: { name: "vercel_json_scaffold", description: "Generate vercel.json rewrite rules.", parameters: { type: "object", properties: { framework_preset: { type: "string" } }, required: ["framework_preset"] } } },
    { type: "function", function: { name: "terminal_run", description: "Executes a shell command on the Hugging Face Docker backend and returns the full log.", parameters: { type: "object", properties: { command: { type: "string" }, workdir: { type: "string" } }, required: ["command", "workdir"] } } },
    { type: "function", function: { name: "fs_sync", description: "Bulk-writes the entire project state to the Hugging Face Docker volume.", parameters: { type: "object", properties: { files: { type: "object", additionalProperties: { type: "string" } } }, required: ["files"] } } },

    // New grounded-edit tools
    { type: "function", function: { name: "fs_search", description: "Search across all project files for a regex pattern. Returns matching filenames and line numbers.", parameters: { type: "object", properties: { pattern: { type: "string", description: "Regex pattern to search for" }, file_glob: { type: "string", description: "File glob filter e.g. '*.tsx' or '*'" } }, required: ["pattern"] } } },
    { type: "function", function: { name: "fs_read_lines", description: "Read a specific line range from a project file. Use BEFORE editing to ground context.", parameters: { type: "object", properties: { file_path: { type: "string" }, start_line: { type: "number" }, end_line: { type: "number" } }, required: ["file_path", "start_line", "end_line"] } } },
    { type: "function", function: { name: "plan_and_confirm", description: "Before making any edits, present a numbered plan of changes to the user and wait for approval.", parameters: { type: "object", properties: { title: { type: "string" }, steps: { type: "array", items: { type: "string" }, description: "List of planned actions e.g. ['Replace terminal block in App.tsx line 450', 'Wire TerminalPanel props']" } }, required: ["title", "steps"] } } },

    { type: "function", function: { name: "apply_unified_diff", description: "Surgically update a file using SEARCH/REPLACE blocks. Forbidden from sending whole files.", parameters: { type: "object", properties: { patch_text: { type: "string", description: "Raw SEARCH/REPLACE blocks. Format: FILE: [path] <<<<<<< SEARCH [exact lines] ======= [replacement] >>>>>>> REPLACE" } }, required: ["patch_text"] } } },
    { type: "function", function: { name: "get_preview_url", description: "Returns the proxied URL for the running app on the HF container.", parameters: { type: "object", properties: {}, required: [] } } }
];
