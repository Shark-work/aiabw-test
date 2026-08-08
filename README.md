# Fullstack AI Agents with Next.js

![learnwithparam.com](https://www.learnwithparam.com/ai-bootcamp/opengraph-image)

Build a multi-step AI agent end to end in a single Next.js 15 app. The agent plans, calls tools, observes results, and streams natural-language answers back to a chat UI. Tools live next to the route handler, state streams through the Vercel AI SDK, and the whole thing ships as one deployable unit.

> Start learning at [learnwithparam.com](https://learnwithparam.com). Regional pricing available with discounts of up to 60%.

## What You'll Learn

- Design a multi-step agent loop using `streamText` with `maxSteps` so the model can call tools, observe, and reply in one turn
- Define typed tools with Zod schemas that the model can discover, call, and chain
- Wire `useChat` to render streaming text and tool invocations inline in a React 19 UI
- Run a Fullstack AI agent in one Next.js app (no separate Python service, no orchestration framework)
- Swap providers cleanly by routing through 阿里云百炼 (DashScope / 通义千问) as the default gateway
- Ship with Docker, a Makefile, and a `.env.example` so the project is reproducible on any machine

## Tech Stack

- **Next.js 15** (App Router, Turbopack) with **TypeScript** and **React 19**
- **Vercel AI SDK** (`ai`, `@ai-sdk/react`) for `streamText`, tools, and `useChat`
- **阿里云百炼**（`@ai-sdk/openai`，OpenAI 兼容模式）作为默认 LLM 接入
- **Zod** for tool input schemas
- **Tailwind CSS** + **shadcn/ui** + **lucide-react** for the UI
- **pnpm** for dependency management

## Getting Started

### Prerequisites

- Node.js 20+ and `pnpm` (installed automatically by `make setup`)
- 一个阿里云百炼（DashScope）的 API Key（用于聊天模型）

### Quick Start

```bash
make dev

# Or step by step:
make setup          # Install deps and create .env
# Edit .env with your BAILIAN_API_KEY and BAILIAN_MODEL
make run            # Next.js dev server at http://localhost:3000
```

### With Docker

```bash
make build
make up
make logs
make down
```

## API Routes

| Route | What it does |
|---|---|
| `POST /api/chat` | Multi-step agent with tool calling (`get_weather`, `calculator`, `web_search`), streamed via the AI SDK |

## Agent Tools

The agent has three tools wired up in `src/lib/agent-tools.ts`. All three are safe to run locally with no extra keys:

- `get_weather(city)` — Returns a mock weather payload for common cities
- `calculator(expression)` — Evaluates arithmetic expressions safely
- `web_search(query)` — Returns canned search snippets you can replace with a real provider

Try a prompt like: *"What's the weather in Tokyo and what's 47 * 23?"* — the agent will call `get_weather`, then `calculator`, then produce a single merged answer.

## Challenges

Work through these to go from a demo to a real agent:

1. **Tool calling basics** — Watch the model call `get_weather` and render the tool invocation card in the UI
2. **Multi-step reasoning** — Ask a question that needs two tools and confirm the agent chains them inside `maxSteps`
3. **Real weather tool** — Replace the mock with a real API (OpenWeather or WeatherAPI) and handle the error path
4. **Real search tool** — Swap the mock for Tavily, Brave, or SerpAPI and rank the results before returning them
5. **Streaming UX** — Show a live "Agent is calling tool X..." indicator while tool calls are in flight
6. **Guardrails** — Add an input allowlist for `calculator` and reject expressions that exceed a length budget
7. **Provider swap** — Route the agent through Mistral or Gemini by flipping `LLM_PROVIDER` and adding the matching SDK
8. **Memory** — Persist conversation history to a database so a user can resume a thread after a reload

## Project Structure

```
src/
├── app/
│   ├── api/
│   │   └── chat/route.ts       # Multi-step agent endpoint (streamText + tools)
│   ├── page.tsx                # Home page with the chat panel
│   ├── layout.tsx
│   └── globals.css
├── components/
│   ├── chat/
│   │   ├── chat-panel.tsx      # useChat + message rendering
│   │   └── tool-call-card.tsx  # Inline tool-invocation UI
│   └── ui/                     # shadcn/ui primitives
└── lib/
    ├── agent-tools.ts          # get_weather, calculator, web_search
    └── utils.ts                # cn helper + system prompt
```

## Makefile Targets

```
make help           Show all available commands
make setup          Install deps and create .env
make dev            Setup and run dev server
make run            Run the Next.js dev server (port 3000)
make build-next     Build for production
make start          Start the production server
make lint           Run ESLint
make build          Build Docker image
make up             Start Docker container
make down           Stop container
make clean          Remove node_modules and .next
```

## Learn more

- Start the course: [learnwithparam.com/courses/fullstack-agents-nextjs](https://www.learnwithparam.com/courses/fullstack-agents-nextjs)
- AI Bootcamp for Software Engineers: [learnwithparam.com/ai-bootcamp](https://www.learnwithparam.com/ai-bootcamp)
- All courses: [learnwithparam.com/courses](https://www.learnwithparam.com/courses)
