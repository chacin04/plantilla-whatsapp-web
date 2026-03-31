# Agent Guidelines for plantilla-whatsapp-web

This document provides guidelines for AI agents working on this WhatsApp automation project with LLM integration and ChromaDB context.

## Project Overview

Node.js WhatsApp automation system using `whatsapp-web.js`, DeepSeek LLM API, ChromaDB for context, SQLite for chat state, and cron jobs for pending chat processing.

## Build and Development Commands

### Available npm scripts
```bash
npm start                      # Start main application
npm run start:chroma          # Start ChromaDB server (./chroma_db)
npm run start:chroma:getting-started # Alternative path
npm run test:context          # Test ChromaDB context functionality
```

### Manual commands
```bash
node -c file.js               # Check JavaScript syntax
npx chroma run --path ./chroma_db  # Start ChromaDB server
```

### Missing (not configured)
- Linting (ESLint/Prettier)
- Unit tests framework
- Type checking (TypeScript)

## Code Style Guidelines

### Imports and Exports
- CommonJS (`require`/`module.exports`) only
- Group imports: external packages first, then internal modules
- Use destructuring for named imports

```javascript
const { Client, LocalAuth } = require('whatsapp-web.js');
const config = require('./src/config/env');
```

### Naming Conventions
- **Variables/functions**: `camelCase` (some legacy `snake_case` tolerated)
- **Constants**: `UPPER_SNAKE_CASE`
- **Database columns**: `snake_case` (matches SQLite)
- **Configuration objects**: `camelCase` with nested uppercase keys

### Formatting
- **Indentation**: 4 spaces
- **Semicolons**: Always
- **Quotes**: Single quotes for strings
- **Braces**: Opening brace on same line

### Error Handling
- Use `try/catch` for async operations
- Throw descriptive `Error` objects with context
- Log errors with console.error and relevant identifiers
- Implement retry logic with exponential backoff for external APIs

```javascript
async function apiCall() {
    try {
        // operation
    } catch (error) {
        console.error('[MODULE] Error:', error);
        throw error;
    }
}
```

### Asynchronous Code
- Use `async/await` over promise chains
- Use `Promise.race` with timeouts for external calls

### Logging
- Prefix logs with module identifier in brackets: `[ChromaDB]`, `[LLM]`, `[CRON]`
- Include relevant identifiers (chat IDs, contact names)
- Use console.log for info, console.error for errors

## Project Structure Patterns

### Configuration
- Environment variables via `dotenv` in `src/config/env.js`
- Constants in `src/config/constants.js`
- Validation on startup

### Database Access
- SQLite with custom wrapper in `src/memory_chat/connection.js`
- Prepared statements, explicit connection management

### Service Modules
- LLM HTTP client: `src/services/llm-http.js`
- ChromaDB context: `src/services/context-db.js`
- Each exports a clear API

### Cron Jobs
- Scheduled tasks in `src/cron/check_pending.js`
- Uses `croner` package

## ChromaDB Integration

### Initialization
- Server runs separately: `npx chroma run --path ./chroma_db`
- Client connects to `localhost:8000`
- Collection recreated on each app start (delete old, create new)
- Local embeddings with `@xenova/transformers`

### Context Management
- Context loaded from `contexto.txt` in root
- Text split by paragraphs (`\n\n`)
- Semantic search returns top N similar paragraphs
- Context injected as additional system message before LLM calls

## Environment Variables

See `.env.example`:
```bash
# DeepSeek API
DEEPSEEK_API_KEY=your_key_here
DEEPSEEK_BASE_URL=https://api.deepseek.com/v1
LLM_MODEL=deepseek-chat

# WhatsApp
INACTIVITY_HOURS_FOR_GREETING=8

# ChromaDB (optional)
CONTEXT_FILE_PATH=contexto.txt
CONTEXT_RESULTS_COUNT=3
CHROMA_HOST=localhost
CHROMA_PORT=8000
CHROMA_SSL=false
```

## Development Notes

1. **ChromaDB Server**: Must run in separate terminal for context features
2. **First-time Setup**: Embedding model downloads on first run (~90MB)
3. **Error Resilience**: Components degrade gracefully when dependencies unavailable
4. **State Management**: Chat state persists in SQLite across restarts
5. **Configuration**: Modify `.env` and restart application

## Adding New Features

1. Follow existing patterns for imports, error handling, logging
2. Use configuration system for tunable parameters
3. Add new environment variables to `.env.example`
4. Consider graceful degradation when external services unavailable
5. Prefix logs with appropriate module identifier

## Common Issues

- **ChromaDB connection fails**: Ensure server running with `npm run start:chroma`
- **Embedding model errors**: Delete `node_modules/@huggingface/transformers/.cache` and restart
- **LLM API timeouts**: Check API key and network
- **Database locks**: Ensure connections properly closed
- **WhatsApp auth issues**: Clear `.wwebjs_auth` directory