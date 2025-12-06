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

## Message Flow Diagram

```
┌─────────────────────────────────────────────────────────────┐
│ INITIAL STATE                                                │
│ messages = [system, user]                                    │
└─────────────────────────────────────────────────────────────┘
                    ↓
┌─────────────────────────────────────────────────────────────┐
│ FIRST API CALL                                               │
│ openai.chat.completions.create({ messages, tools })         │
└─────────────────────────────────────────────────────────────┘
                    ↓
        ┌───────────────────────┐
        │ Has tool_calls?        │
        └───────────────────────┘
                ↓ YES                    ↓ NO
    ┌───────────────────────┐    ┌───────────────────────┐
    │ ENTER WHILE LOOP      │    │ EXIT - Return Final   │
    │                       │    │ Response              │
    └───────────────────────┘    └───────────────────────┘
                ↓
    ┌───────────────────────────────────────────┐
    │ ITERATION START                           │
    │ 1. Check MAX_ITERATIONS                   │
    │ 2. Push assistant message to messages[]   │
    │    messages.push(currentMessage)          │
    │    [system, user, assistant_with_tools]   │
    └───────────────────────────────────────────┘
                ↓
    ┌───────────────────────────────────────────┐
    │ ENTER FOR LOOP                            │
    │ Process EACH tool_call                    │
    └───────────────────────────────────────────┘
                ↓
    ┌───────────────────────────────────────────┐
    │ FOR EACH toolCall:                        │
    │                                           │
    │ 1. Parse fnName & args                    │
    │ 2. Execute tool                           │
    │    - readFileFromPod()                    │
    │    - writeFileInPod()                     │
    │    - executeCommandInPod()                │
    │    - etc.                                 │
    │ 3. Push tool result to messages[]         │
    │    messages.push({                        │
    │      role: "tool",                        │
    │      tool_call_id: toolCall.id,           │
    │      content: toolResult                  │
    │    })                                     │
    │    [..., assistant, tool_result_1,        │
    │              tool_result_2, ...]          │
    └───────────────────────────────────────────┘
                ↓
    ┌───────────────────────────────────────────┐
    │ FOR LOOP COMPLETE                         │
    │ All tool calls processed                  │
    │ All tool results added to messages[]      │
    └───────────────────────────────────────────┘
                ↓
    ┌───────────────────────────────────────────┐
    │ CALL OPENAI AGAIN                         │
    │ openai.chat.completions.create({          │
    │   messages,  // Now includes tool results │
    │   tools                                    │
    │ })                                        │
    └───────────────────────────────────────────┘
                ↓
    ┌───────────────────────────────────────────┐
    │ UPDATE currentMessage                     │
    │ currentMessage = response.choices[0].message│
    └───────────────────────────────────────────┘
                ↓
        ┌───────────────────────┐
        │ Check while condition  │
        │ Has tool_calls?        │
        └───────────────────────┘
                ↓ YES                    ↓ NO
        ┌───────────────────────┐        ┌───────────────────────┐
        │ LOOP BACK             │        │ EXIT WHILE LOOP       │
        │                       │        │ Return Final Response │
        └───────────────────────┘        └───────────────────────┘
```

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

