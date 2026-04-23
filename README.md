# AI Architect

A high-performance Vibe Coding platform for building, orchestrating, and deploying full-stack applications with an agentic multi-model swarm.

## Features

- **Elastic Orchestration**: Synthesize complex requirements into sovereign code modules.
- **Power Terminal**: Integrated bash environment with agentic self-healing verification.
- **Multi-Model Routing**: Intelligent task distribution across specialized LLM providers.
- **VFS Persistence**: Atomic codebase synchronization with state-ref locking.

## Architecture

- **Frontend**: React 19 + Vite + Tailwind CSS (Frosted Neon aesthetic)
- **Backend**: Express.js IDE Controller + Dynamic Child Environment support
- **Verification**: Post-build verification via `esbuild` and `py_compile`.

## Getting Started

1. Clone the repository.
2. Install dependencies:
   ```bash
   npm install
   ```
3. Set up environment variables in `.env`:
   - `VITE_GROQ_API_KEY`
   - `VITE_OPENROUTER_API_KEY`
   - `VITE_NVIDIA_API_KEY`
4. Start the development server:
   ```bash
   npm run dev
   ```

## Deployment

AI Architect is deployment-agnostic. You can deploy the controller and the generated apps to any platform supporting Node.js or Docker.

## License

MIT
