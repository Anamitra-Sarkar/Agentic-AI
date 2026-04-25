export const TaskRouter = {
  // GROQ — Ultra-fast inference (<1s response)
  clarifier:           { provider: 'groq' as const, model: 'llama-3.3-70b-versatile' },
  rectification:       { provider: 'groq' as const, model: 'llama-3.3-70b-versatile' },
  compression:         { provider: 'groq' as const, model: 'llama-3.3-70b-versatile' },
  toolController:      { provider: 'groq' as const, model: 'llama-3.3-70b-versatile' },
  validation:          { provider: 'groq' as const, model: 'openai/gpt-oss-120b' },
  audit:               { provider: 'groq' as const, model: 'openai/gpt-oss-120b' },
  rapidPatch:          { provider: 'groq' as const, model: 'qwen/qwen3-32b' },
  draft:               { provider: 'groq' as const, model: 'meta-llama/llama-4-scout-17b-16e-instruct' },

  // NVIDIA NIM — Heavy infrastructure & coding specialists
  backendCore:         { provider: 'nvidia' as const, model: 'qwen/qwen3-coder-480b-a35b-instruct',  fallback: { provider: 'groq' as const, model: 'qwen/qwen3-32b' } },
  agenticLogic:        { provider: 'nvidia' as const, model: 'deepseek/deepseek-v3.2' },
  asyncOrchestration:  { provider: 'nvidia' as const, model: 'writer/palmyra-x5' },
  cloneMode:           { provider: 'nvidia' as const, model: 'qwen/qwen3-coder-480b-a35b-instruct',  fallback: { provider: 'openrouter' as const, model: 'nvidia/nemotron-3-super-120b-a12b:free' } },
  intermediateLogic:   { provider: 'nvidia' as const, model: 'meta/llama-4-maverick-17b-128e-instruct', fallback: { provider: 'groq' as const, model: 'meta-llama/llama-4-scout-17b-16e-instruct' } },
  dataModeling:        { provider: 'nvidia' as const, model: 'mistralai/mistral-small-3.1-24b-instruct' },
  sqlGeneration:       { provider: 'nvidia' as const, model: 'mistralai/mistral-small-3.1-24b-instruct' },

  // OPENROUTER FREE — Specialized models
  visualAnalysis:      { provider: 'openrouter' as const, model: 'google/gemma-4-31b-it:free',              fallback: { provider: 'groq' as const, model: 'meta-llama/llama-4-scout-17b-16e-instruct' } },
  uiClone:             { provider: 'openrouter' as const, model: 'google/gemma-4-31b-it:free',              fallback: { provider: 'groq' as const, model: 'meta-llama/llama-4-scout-17b-16e-instruct' } },
  refactoring:         { provider: 'openrouter' as const, model: 'z-ai/glm-4.5-air:free' },
  docGeneration:       { provider: 'openrouter' as const, model: 'z-ai/glm-4.5-air:free' },
  frontendReact:       { provider: 'openrouter' as const, model: 'nvidia/nemotron-3-super-120b-a12b:free',  fallback: { provider: 'groq' as const, model: 'meta-llama/llama-4-scout-17b-16e-instruct' } },
  apiInterfaces:       { provider: 'openrouter' as const, model: 'google/gemma-4-31b-it:free',              fallback: { provider: 'groq' as const, model: 'llama-3.3-70b-versatile' } },
  edgeCasesDocs:       { provider: 'openrouter' as const, model: 'openai/gpt-oss-120b:free',               fallback: { provider: 'groq' as const, model: 'openai/gpt-oss-120b' } },
  architectureDesign:  { provider: 'openrouter' as const, model: 'deepseek/deepseek-v3:free',              fallback: { provider: 'nvidia' as const, model: 'deepseek/deepseek-v3.2' } },
  bugAnalysis:         { provider: 'openrouter' as const, model: 'deepseek/deepseek-v3:free',              fallback: { provider: 'nvidia' as const, model: 'deepseek/deepseek-v3.2' } },
  i18nLocalization:    { provider: 'openrouter' as const, model: 'qwen/qwen3-30b-a3b:free' },
  codeReview:          { provider: 'openrouter' as const, model: 'qwen/qwen3-30b-a3b:free' },
} as const;

export const groqTools = [
    { type: "function", function: { name: "tavily_dependency_check", description: "Query package stats (e.g. react 19, tailwind 4, etc).", parameters: { type: "object", properties: { package_name: { type: "string" }, framework: { type: "string" } }, required: ["package_name", "framework"] } } },
    { type: "function", function: { name: "huggingface_space_init", description: "Generate README.md for Docker HuggingFace spaces using port 7860.", parameters: { type: "object", properties: { space_name: { type: "string" }, sdk: { type: "string", enum: ["docker", "gradio"] } }, required: ["space_name", "sdk"] } } },
    { type: "function", function: { name: "vercel_json_scaffold", description: "Generate vercel.json rewrite rules.", parameters: { type: "object", properties: { framework_preset: { type: "string" } }, required: ["framework_preset"] } } },
    { type: "function", function: { name: "terminal_run", description: "Executes a shell command on the Hugging Face Docker backend and returns the full log.", parameters: { type: "object", properties: { command: { type: "string" }, workdir: { type: "string" } }, required: ["command", "workdir"] } } },
    { type: "function", function: { name: "fs_sync", description: "Bulk-writes the entire project state to the Hugging Face Docker volume.", parameters: { type: "object", properties: { files: { type: "object", additionalProperties: { type: "string" } } }, required: ["files"] } } },

    { type: "function", function: { name: "fs_search", description: "Search across all project files for a regex pattern. Returns matching filenames and line numbers. ALWAYS call this before editing any file.", parameters: { type: "object", properties: { pattern: { type: "string", description: "Regex pattern for search" }, file_glob: { type: "string", description: "Optional file extension filter e.g. '.tsx'" } }, required: ["pattern"] } } },
    { type: "function", function: { name: "fs_read_lines", description: "Read a specific line range from a project file. ALWAYS call before editing to ground context.", parameters: { type: "object", properties: { file_path: { type: "string" }, start_line: { type: "number" }, end_line: { type: "number" } }, required: ["file_path", "start_line", "end_line"] } } },
    { type: "function", function: { name: "plan_and_confirm", description: "Present a numbered plan of changes to the user and wait for approval BEFORE making any edits. ALWAYS call before apply_unified_diff.", parameters: { type: "object", properties: { title: { type: "string" }, steps: { type: "array", items: { type: "string" } } }, required: ["title", "steps"] } } },

    { type: "function", function: { name: "apply_unified_diff", description: "Surgically update a file using SEARCH/REPLACE blocks. Forbidden from sending whole files.", parameters: { type: "object", properties: { patch_text: { type: "string", description: "Raw SEARCH/REPLACE blocks. Format: FILE: [path] <<<<<<< SEARCH [exact lines] ======= [replacement] >>>>>>> REPLACE" } }, required: ["patch_text"] } } },
    { type: "function", function: { name: "get_preview_url", description: "Returns the proxied URL for the running app on the HF container.", parameters: { type: "object", properties: {}, required: [] } } }
];
