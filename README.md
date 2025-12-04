# OpenAI Tool Calling with Kubernetes Integration

An AI agent that uses OpenAI's function calling API to read and inspect files from Kubernetes pods. The agent can analyze codebases running in Kubernetes by dynamically reading files when needed.

## Overview

This project implements an agent loop where an LLM (GPT-4) can:
- Receive user prompts about code in a Kubernetes pod
- Automatically call tools to read files from the pod when needed
- Use the file contents to provide intelligent responses

## How It Works

1. **User sends a prompt** via POST request to `/agent`
2. **Agent receives folder structure** from the Kubernetes pod
3. **LLM decides** if it needs to read files using the `read_file` tool
4. **Tool executes** - reads file from pod using `kubectl exec`
5. **LLM processes** the file content and provides a final response

## Prerequisites

- Node.js (v14+)
- Kubernetes cluster access
- `kubectl` configured and accessible
- OpenAI API key

## Installation

```bash
npm install
```

## Environment Variables

Create a `.env` file with:

```env
OPENAI_API_KEY=your_openai_api_key_here
POD_NAME=your-pod-name
NAMESPACE=default
PORT=3000
```

## Usage

Start the server:

```bash
npm start
```

Send a POST request to `/agent`:

```bash
curl -X POST http://localhost:3000/agent \
  -H "Content-Type: application/json" \
  -d '{"prompt": "What does the main component do?"}'
```

## API Endpoint

### POST `/agent`

**Request Body:**
```json
{
  "prompt": "Your question about the codebase"
}
```

**Response:**
```json
{
  "modelResponse": {
    "role": "assistant",
    "content": "AI response..."
  },
  "toolExecution": {
    "function": "read_file",
    "args": { "path": "/app/index.js" },
    "filePreview": "File content preview..."
  }
}
```

## Project Structure

- `server.js` - Main Express server with agent loop implementation
- `deployment.yml` - Kubernetes deployment configuration
- `service.yml` - Kubernetes service configuration
- `package.json` - Node.js dependencies

## Features

- ✅ OpenAI function/tool calling integration
- ✅ Kubernetes pod file reading via `kubectl exec`
- ✅ Automatic folder structure discovery
- ✅ Agent loop with tool execution and follow-up reasoning

## License

ISC

