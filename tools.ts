import type { ChatCompletionTool } from "openai/resources/chat/completions";
import { baseImageMap } from "./config";

export const tools: ChatCompletionTool[] = [
  {
    type: "function" as const,
    function: {
      name: "read_file",
      description: "Read a file from the Kubernetes pod. Returns file contents or an error.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path of the file inside the pod (e.g. /app/index.js)"
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "write_file",
      description: "Write or update a file in the Kubernetes pod. Creates the file if it doesn't exist. Parent directories are automatically created if needed.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path of the file inside the pod (e.g. /app/index.js)"
          },
          content: {
            type: "string",
            description: "The content to write to the file"
          }
        },
        required: ["path", "content"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "list_directory",
      description: "List the contents of a directory in the Kubernetes pod. Returns a simple list of files and subdirectories (names only, one per line).",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path of the directory to list (e.g. /app, /app/src). Defaults to /app if not specified."
          }
        },
        required: []
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "execute_command",
      description: "Execute a shell command in the Kubernetes pod. Use this to install packages (npm install), run scripts (npm run dev, npm test), check file permissions, or execute any shell command. Returns stdout and stderr.",
      parameters: {
        type: "object",
        properties: {
          command: {
            type: "string",
            description: "The shell command to execute (e.g., 'npm install', 'npm run dev', 'ls -la /app/src', 'pwd')"
          },
          working_directory: {
            type: "string",
            description: "Optional: working directory to execute the command in (default: /app)"
          }
        },
        required: ["command"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "search_code",
      description: "Search for text or patterns across files in the codebase. Returns matching lines with file paths and line numbers. Use this to find where functions, components, or variables are used, or to understand code patterns.",
      parameters: {
        type: "object",
        properties: {
          query: {
            type: "string",
            description: "The text or pattern to search for (e.g., 'useState', 'function Header', 'import React')"
          },
          path: {
            type: "string",
            description: "Optional: directory path to search in (default: /app). Excludes node_modules and .git automatically."
          }
        },
        required: ["query"]
      }
    }
  },
  {
    type: "function" as const,
    function: {
      name: "delete_file",
      description: "Delete a file from the Kubernetes pod. Returns success message or an error if the file doesn't exist or cannot be deleted.",
      parameters: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Absolute path of the file to delete inside the pod (e.g. /app/index.js)"
          }
        },
        required: ["path"]
      }
    }
  },
  {
    type: "function",
    function: {
      name: "start_base_image",
      description: "Start a base image deployment in Kubernetes. Creates a deployment and service for the specified base image framework.",
      parameters: {
        type: "object",
        properties: {
          base_image: {
            type: "string",
            description: "The base image framework name (e.g., 'react', 'vue', 'angular', 'nextjs', 'flutter', 'react-native', 'svelte', 'nuxtjs')",
            enum: Object.keys(baseImageMap)
          },
          name: {
            type: "string",
            description: "Optional: Custom name for the deployment. If not provided, a UUID will be generated."
          }
        },
        required: ["base_image"]
      }
    }
  }
];

