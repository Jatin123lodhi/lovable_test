# AI Application Builder (Lovable.ai Clone)

An AI-powered application builder that generates and deploys web applications to Kubernetes using OpenAI's API. Similar to Lovable.ai, this platform allows you to describe your application in natural language and automatically generates, builds, and deploys it.

## Features

- 🤖 **AI-Powered Code Generation**: Uses OpenAI GPT-4 to generate code based on natural language prompts
- 🚀 **Multi-Framework Support**: Supports React, Vue, Angular, Next.js, Nuxt.js, Flutter, React Native, and Svelte
- ☸️ **Kubernetes Integration**: Automatically deploys applications to Kubernetes pods with services
- 🛠️ **Interactive Development**: Provides tools for file operations, code execution, and code search within deployed pods
- 📝 **File Management**: Read, write, and manage files directly in Kubernetes pods
- 🔍 **Code Search**: Search across codebases to understand project structure and patterns
- ⚡ **Hot Module Reload**: Supports file watching and hot reloading for rapid development

## Architecture

The application consists of:
- **Express API Server**: RESTful API that handles agent requests
- **OpenAI Integration**: Uses GPT-4 with function calling to interact with Kubernetes pods
- **Kubernetes Client**: Manages deployments, services, and pod interactions
- **Agent Tools**: Set of functions that allow the AI to:
  - Read and write files in pods
  - Execute shell commands (npm install, npm run dev, etc.)
  - List directory contents
  - Search code across the codebase

## Prerequisites

- [Bun](https://bun.com) runtime (v1.2.20+)
- Kubernetes cluster access (via kubeconfig or in-cluster config)
- OpenAI API key
- `kubectl` installed and configured

## Installation

```bash
bun install
```

## Configuration

Set the following environment variables:

```bash
OPENAI_API_KEY=your_openai_api_key
OPENAI_MODEL=gpt-4o-mini  # Optional, defaults to gpt-4o-mini
PORT=3000  # Optional, defaults to 3000
NAMESPACE=default  # Optional, defaults to "default"
LABEL_SELECTOR=app=react-app  # Optional, defaults to "app=react-app"
KUBECONFIG=~/.kube/config  # Optional, uses default kubeconfig location
```

## Usage

### Start the Server

```bash
bun run index.ts
```

### Build an Application

Send a POST request to `/agent` with your application description:

```bash
curl -X POST http://localhost:3000/agent \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "Create a todo app with React that allows users to add, complete, and delete tasks"
  }'
```

The agent will:
1. Start a base image deployment (e.g., React)
2. Inspect the project structure
3. Generate and write code files
4. Install dependencies
5. Run the development server

## Supported Base Images

- `react` - React with TypeScript
- `vue` - Vue.js
- `angular` - Angular
- `nextjs` - Next.js
- `nuxtjs` - Nuxt.js
- `flutter` - Flutter
- `react-native` - React Native
- `svelte` - Svelte

## API Endpoints

- `GET /` - Health check endpoint
- `POST /agent` - Main agent endpoint that accepts prompts and builds applications

## How It Works

1. **User sends a prompt** describing the application they want to build
2. **AI agent analyzes** the prompt and determines which base image to use
3. **Kubernetes deployment** is created with the selected base image
4. **AI agent interacts** with the pod using tools to:
   - Explore the project structure
   - Generate code files
   - Install dependencies
   - Run development servers
5. **Application is deployed** and accessible via Kubernetes service

## Project Structure

```
.
├── index.ts              # Main Express server and agent logic
├── k8s-deployments.ts    # Kubernetes deployment and service creation
├── package.json          # Dependencies and project configuration
└── README.md             # This file
```

## Technologies Used

- **Bun**: Fast JavaScript runtime
- **Express**: Web framework
- **OpenAI API**: GPT-4 for code generation
- **Kubernetes Client**: Node.js client for Kubernetes operations
- **TypeScript**: Type-safe development

## License

Private project - All rights reserved
