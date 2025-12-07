import express from "express";
import { randomUUID } from "crypto";
import { createDeploymentAndServiceForBaseImage } from "./k8s-deployments";
import OpenAI from "openai";
import type { ChatCompletionMessageParam, ChatCompletionTool } from "openai/resources/chat/completions";
import { exec as cpExec } from "child_process";
import util from "util"
const exec = util.promisify(cpExec);

const app = express();
app.use(express.json());

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000, // 2 minute timeout for API calls
  maxRetries: 2
});
const MODEL = "gpt-4-0613";

const PORT = process.env.PORT || 3000;

async function sendToLLM(prompt: string){
  // how to send to LLM and get response 
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${process.env.OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [{ role: "user", content: prompt }],
    }),
  });

  const data = await response.json() as { choices: { message: { content: string } }[] };
  return data.choices[0]?.message?.content?.trim() || "No response from LLM";
}

const baseImageMap: Record<string, string> = {
  "react": "cryptocal/react_base_img:latest",
  "react-native": "cryptocal/react-native_base_img:latest",
  "flutter": "cryptocal/flutter_base_img:latest",
  "vue": "cryptocal/vue_base_img:latest",
  "angular": "cryptocal/angular_base_img:latest",
  "svelte": "cryptocal/svelte_base_img:latest",
  "nextjs": "cryptocal/nextjs_base_img:latest",
  "nuxtjs": "cryptocal/nuxtjs_base_img:latest",
}

const tools: ChatCompletionTool[] = [
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

// helper: run kubectl exec and return stdout string (utf8)
async function readFileFromPod(podName: string, namespace: string, filePath: string): Promise<string> {
  // WARNING: sanitize filePath in production. This is minimal demo.
  // Ensure podName doesn't have quotes and properly escape the command
  const cleanPodName = podName.trim().replace(/^['"]+|['"]+$/g, '');
  const cmd = `kubectl exec ${cleanPodName} -n ${namespace} -- cat "${filePath}"`;
  try {
    const { stdout, stderr } = await exec(cmd, { maxBuffer: 10 * 1024 * 1024 }); // increase buffer if necessary
    if (stderr && !stdout) {
      throw new Error(stderr);
    }
    return stdout;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return `__ERROR_READING_FILE__: ${errorMessage}`;
  }
}

async function writeFileInPod(podName: string, namespace: string, filePath: string, content: string): Promise<string> {
  // Ensure podName doesn't have quotes
  const cleanPodName = podName.trim().replace(/^['"]+|['"]+$/g, '');
  
  // Extract directory path and create it if it doesn't exist
  const dirPath = filePath.substring(0, filePath.lastIndexOf('/'));
  if (dirPath) {
    const mkdirCmd = `kubectl exec ${cleanPodName} -n ${namespace} -- mkdir -p "${dirPath}"`;
    try {
      await exec(mkdirCmd);
    } catch (err) {
      // If mkdir fails, we'll still try to write the file (might be root directory)
      const errorMessage = err instanceof Error ? err.message : String(err);
      console.warn(`Warning: Could not create directory ${dirPath}: ${errorMessage}`);
    }
  }
  
  const encodedContent = Buffer.from(content).toString('base64');
  const cmd = `kubectl exec ${cleanPodName} -n ${namespace} -- sh -c "echo '${encodedContent}' | base64 -d > ${filePath}"`;
  try{
    const { stdout, stderr } = await exec(cmd, { maxBuffer: 10 * 1024 * 1024 });
    if(stderr && !stdout) {
      throw new Error(stderr);
    }

     // Touch the file to trigger file watcher (important for HMR)
     const touchCmd = `kubectl exec ${cleanPodName} -n ${namespace} -- touch "${filePath}"`;
     await exec(touchCmd);

    return `File written successfully to ${filePath}`;
  }catch(err){
    const errorMessage = err instanceof Error ? err.message : String(err);
    return `__ERROR_WRITING_FILE__: ${errorMessage}`
  }
}

async function executeCommandInPod(podName: string, namespace: string, command: string, workingDir: string = "/app"): Promise<string> {
  const cleanPodName = podName.trim().replace(/^['"]+|['"]+$/g, '');
  
  // Escape single quotes in the command for safe shell execution
  const escapedCommand = command.replace(/'/g, "'\"'\"'");
  
  // Execute command in the specified working directory
  const cmd = `kubectl exec ${cleanPodName} -n ${namespace} -- sh -c "cd ${workingDir} && ${escapedCommand}"`;
  
  try {
    const { stdout, stderr } = await exec(cmd, { 
      maxBuffer: 10 * 1024 * 1024, // 10MB buffer
      timeout: 300000 // 5 minute timeout for long-running commands
    });
    
    // Format the result
    const result = {
      stdout: stdout || '',
      stderr: stderr || '',
      success: !stderr || stderr.length === 0,
      exitCode: stderr ? 1 : 0
    };
    
    // Return formatted string for LLM consumption
    if (result.stdout && result.stderr) {
      return `STDOUT:\n${result.stdout}\n\nSTDERR:\n${result.stderr}`;
    } else if (result.stdout) {
      return result.stdout;
    } else if (result.stderr) {
      return `STDERR:\n${result.stderr}`;
    } else {
      return "Command executed successfully (no output)";
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return `__ERROR_EXECUTING_COMMAND__: ${errorMessage}`;
  }
}

async function searchCodeInPod(podName: string, namespace: string, query: string, searchPath: string = "/app"): Promise<string> {
  const cleanPodName = podName.trim().replace(/^['"]+|['"]+$/g, '');
  
  // Escape special characters in the query for grep
  // Replace single quotes with double quotes wrapped in single quotes for shell safety
  const escapedQuery = query.replace(/'/g, "'\"'\"'");
  
  // Use grep to search recursively, excluding common directories
  // -r: recursive, -n: show line numbers, -i: case insensitive (optional, can remove if case-sensitive needed)
  const cmd = `kubectl exec ${cleanPodName} -n ${namespace} -- sh -c "grep -rn '${escapedQuery}' ${searchPath} --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist --exclude-dir=build 2>/dev/null | head -100 || echo 'No matches found for: ${query}'"`;
  
  try {
    const { stdout, stderr } = await exec(cmd, { maxBuffer: 10 * 1024 * 1024 });
    
    if (stderr && !stdout) {
      return `__ERROR_SEARCHING_CODE__: ${stderr}`;
    }
    
    if (stdout && stdout.trim()) {
      // Format the results nicely
      const results = stdout.trim();
      // Limit results to prevent token overflow (already limited by head -100)
      return results.length > 5000 
        ? results.slice(0, 5000) + "\n\n... (results truncated, found more matches)"
        : results;
    } else {
      return `No matches found for "${query}" in ${searchPath}`;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return `__ERROR_SEARCHING_CODE__: ${errorMessage}`;
  }
}

async function listDirectoryInPod(podName: string, namespace: string, dirPath: string = "/app"): Promise<string> {
  const cleanPodName = podName.trim().replace(/^['"]+|['"]+$/g, '');
  
  // Escape special characters in the path for shell safety
  const escapedPath = dirPath.replace(/'/g, "'\"'\"'");
  
  // Use ls -1 to get simple directory listing (one item per line, no extra details)
  const cmd = `kubectl exec ${cleanPodName} -n ${namespace} -- sh -c "ls -1 '${escapedPath}' 2>&1"`;
  
  try {
    const { stdout, stderr } = await exec(cmd, { maxBuffer: 10 * 1024 * 1024 });
    
    if (stderr && !stdout) {
      return `__ERROR_LISTING_DIRECTORY__: ${stderr}`;
    }
    
    if (stdout && stdout.trim()) {
      return stdout.trim();
    } else {
      return `Directory '${dirPath}' is empty or does not exist`;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return `__ERROR_LISTING_DIRECTORY__: ${errorMessage}`;
  }
}

async function deleteFileInPod(podName: string, namespace: string, filePath: string): Promise<string> {
  const cleanPodName = podName.trim().replace(/^['"]+|['"]+$/g, '');
  
  // Escape special characters in the path for shell safety
  const escapedPath = filePath.replace(/'/g, "'\"'\"'");
  
  // Use rm command to delete the file
  const cmd = `kubectl exec ${cleanPodName} -n ${namespace} -- sh -c "rm -f '${escapedPath}' 2>&1"`;
  
  try {
    const { stdout, stderr } = await exec(cmd, { maxBuffer: 10 * 1024 * 1024 });
    
    if (stderr && !stdout) {
      return `__ERROR_DELETING_FILE__: ${stderr}`;
    }
    
    // Check if file still exists to confirm deletion
    const checkCmd = `kubectl exec ${cleanPodName} -n ${namespace} -- sh -c "test -f '${escapedPath}' && echo 'exists' || echo 'deleted'"`;
    const { stdout: checkOutput } = await exec(checkCmd);
    
    if (checkOutput.trim() === 'deleted') {
      return `File deleted successfully: ${filePath}`;
    } else {
      return `File may not have existed or was already deleted: ${filePath}`;
    }
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return `__ERROR_DELETING_FILE__: ${errorMessage}`;
  }
}

// Helper function to start base image deployment and return pod name
async function startBaseImageDeployment(
  baseImage: string,
  deploymentName?: string,
  namespace: string = "default"
): Promise<{ podName: string; uniqueId: string; domain: string }> {
  // 1. Get the image from baseImageMap[baseImage]
  const image = baseImageMap[baseImage];
  if (!image) {
    throw new Error(`Invalid base image "${baseImage}". Available options: ${Object.keys(baseImageMap).join(", ")}`);
  }

  // 2. Generate a UUID as the unique ID (instead of timestamp-based name)
  const uniqueId = deploymentName || randomUUID();
  const finalDeploymentName = uniqueId; // Use UUID directly as deployment name

  // 3. Create deployment and service using createDeploymentAndServiceForBaseImage
  console.log(`Creating deployment "${finalDeploymentName}" with image "${image}" in namespace "${namespace}"`);
  const deploymentAndService = await createDeploymentAndServiceForBaseImage(
    finalDeploymentName,
    image,
    1,
    namespace
  );

  console.log(`Deployment created: ${deploymentAndService.deployment}`);

  // 4. Wait for pod to be ready
  const waitCmd = `kubectl wait --for=condition=ready pod -l app=${finalDeploymentName} -n ${namespace} --timeout=300s`;
  try {
    console.log(`Waiting for pod to be ready...`);
    await exec(waitCmd);
    console.log(`Pod is ready!`);
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to wait for pod to be ready: ${errorMessage}`);
  }

  // 5. Get pod name using label selector (app=<deploymentName>)
  const getPodCmd = `kubectl get pods -l app=${finalDeploymentName} -n ${namespace} -o jsonpath="{.items[0].metadata.name}"`;
  try {
    const { stdout } = await exec(getPodCmd);
    const podName = stdout.trim();
    if (!podName) {
      throw new Error(`No pod found with label app=${finalDeploymentName} in namespace ${namespace}`);
    }
    console.log(`Pod name: ${podName}`);
    
    // 6. Return pod name, unique ID, and domain URL
    const domain = `${uniqueId}.lovableaiweb.info`;
    return { podName, uniqueId, domain };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to get pod name: ${errorMessage}`);
  }
}


app.get("/", (req, res) => {
  res.json('Backend running...')
})



app.post("/agent", async (req, res) => {
  const userPrompt = req.body.prompt || "Please inspect the repo and ask for any file you need.";
  const namespace = process.env.NAMESPACE || "default";
  const labelSelector = process.env.LABEL_SELECTOR || "app=react-app";

  // Track the current pod name (will be set when start_base_image is called)
  let podName: string | undefined;

  // Dynamically get pod name using label selector
  // let podName;
  // try {
  //   podName = await getPodName(namespace, labelSelector);
  // } catch (err) {
  //   return res.status(400).json({ error: `Failed to find pod: ${err.message}` });
  // }

  // // Get actual folder metadata from the pod
  // const folderMetadataRaw = await getFolderMetadata(podName, namespace);
  // const folderMetadata = `Project tree:\n${folderMetadataRaw}`;

  // initial message history
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: "You are a helpful assistant that can interact with Kubernetes pods and manage deployments. IMPORTANT: When starting a new base image deployment, always first use 'list_directory' to check the directory structure and see what files exist before trying to read them. React base images typically use TypeScript (.tsx files), not JavaScript (.js). After starting a deployment, wait a moment and check the directory structure to understand the project layout." },
    { role: "user", content: `${userPrompt}\n\nAvailable base images: ${Object.keys(baseImageMap).join(", ")}. If you need to start a base image deployment, call the 'start_base_image' tool with { "base_image": "react" } (or vue, angular, nextjs, nuxtjs, flutter, react-native, svelte).\n\nIMPORTANT WORKFLOW:\n1. After starting a base image, first use 'list_directory' with { "path": "/app" } to see the project structure\n2. Then use 'list_directory' with { "path": "/app/src" } to see source files\n3. React apps typically use .tsx or .ts files, not .js files\n4. Once you know the file structure, use 'read_file' to read files\n5. Use 'write_file' to create or update files\n6. Use 'execute_command' to run commands like 'npm install' or 'npm run dev'\n7. Use 'search_code' to find code patterns\n\nIf a file doesn't exist when you try to read it, check the directory structure first to find the correct path and file extension.` }
  ];
  // const messages: ChatCompletionMessageParam[] = [
  //   { role: "system", content: "You are a helpful assistant that can start base image deployments." },
  //   { role: "user", content: `${userPrompt}\n\nAvailable base images: ${Object.keys(baseImageMap).join(", ")}. Call the 'start_base_image' tool with { "base_image": "react" } to start a deployment.` }
  // ];

  try {
    // 1) Ask the model (tools included in request)
    console.log(`[LLM] Initial request with ${messages.length} messages`);
    let currentResponse = await openai.chat.completions.create({
      model: MODEL,
      messages,
      // provide the tools so the model can produce a function call
      tools,
      tool_choice: "auto"
    });

    let currentMessage = currentResponse.choices?.[0]?.message;
    const toolExecutions = []; // Track all tool executions
    let iterationCount = 0;
    const MAX_ITERATIONS = 20; // Prevent infinite loops

    // Keep processing tool calls until model returns a final response
    while (currentMessage?.tool_calls && currentMessage.tool_calls.length > 0) {
      iterationCount++;
      if (iterationCount > MAX_ITERATIONS) {
        console.error(`[LLM] Maximum iterations (${MAX_ITERATIONS}) reached. Breaking loop.`);
        break;
      }
      console.log(`[LLM] Iteration ${iterationCount}: Processing tool call`);

      messages.push(currentMessage);
      
      // Process all tool calls in parallel (or sequentially if dependencies exist)
      for (let toolCall of currentMessage.tool_calls) {
        // Check if toolCall exists
        if (!toolCall) {
          continue; // Skip invalid tool calls
        }
        
        // Type guard: check if it's a function tool call (not custom)
        if (toolCall.type !== 'function') {
          return res.status(400).json({ error: "Only function tool calls are supported" });
        }
        
        const fnName = toolCall.function.name;
        const rawArgs = toolCall.function.arguments || "{}";
        
        let args: any = {};
        try { 
          args = JSON.parse(rawArgs); 
        } catch (e) {
          args = { path: rawArgs }; // fallback if model returned plain string
        }

        let toolResult;
        
        if (fnName === "start_base_image") {
          const baseImage = args.base_image;
          const deploymentName = args.name;
          
          // Validate base_image exists in baseImageMap
          if (!baseImageMap[baseImage]) {
            toolResult = `__ERROR__: Invalid base image "${baseImage}". Available options: ${Object.keys(baseImageMap).join(", ")}`;
          } else {
            // Call helper function to start deployment and service, get pod name, uniqueId, and domain
            const result = await startBaseImageDeployment(baseImage, deploymentName, namespace);
            podName = result.podName;
            
            toolResult = `Base image deployment started successfully. Pod name: ${result.podName}. Access your app at: ${result.domain}`;
            
            // Track execution for response
            toolExecutions.push({ 
              function: fnName, 
              args, 
              podName: result.podName,
              uniqueId: result.uniqueId,
              domain: result.domain
            });
          }
        }
        else if (!podName) {
          toolResult = "__ERROR__: No pod available. Please start a base image deployment first using the 'start_base_image' tool.";
        } 
        else if (fnName === "read_file") {
          const filePath = args.path;
          // execute the tool (read file from pod)
          toolResult = await readFileFromPod(podName, namespace, filePath);
          
          // Track execution for response
          toolExecutions.push({ 
            function: fnName, 
            args, 
            filePreview: toolResult.slice(0, 1000) 
          });
        } 
        else if (fnName === 'write_file') {
          const filePath = args.path;
          const fileContent = args.content;
          
          // execute the tool (write file to pod)
          toolResult = await writeFileInPod(podName, namespace, filePath, fileContent);
          console.log(`[WRITE_FILE] Result: ${toolResult}`);
          
          // Track execution for response
          toolExecutions.push({ 
            function: fnName, 
            args, 
            result: toolResult 
          });
        }
        else if (fnName === 'list_directory') {
          const dirPath = args.path || '/app';
          
          // execute the tool (list directory in pod)
          toolResult = await listDirectoryInPod(podName, namespace, dirPath);
          console.log(`[LIST_DIRECTORY] Path: ${dirPath}`);
          console.log(`[LIST_DIRECTORY] Result: ${toolResult.slice(0, 500)}...`);
          
          // Track execution for response
          toolExecutions.push({ 
            function: fnName, 
            args, 
            result: toolResult 
          });
        }
        else if (fnName === 'execute_command') {
          const command = args.command;
          const workingDir = args.working_directory || '/app';
          
          // execute the tool (run command in pod)
          toolResult = await executeCommandInPod(podName, namespace, command, workingDir);
          console.log(`[EXECUTE_COMMAND] Command: ${command}, Working Dir: ${workingDir}`);
          console.log(`[EXECUTE_COMMAND] Result: ${toolResult.slice(0, 500)}...`);
          
          // Track execution for response
          toolExecutions.push({ 
            function: fnName, 
            args, 
            result: toolResult 
          });
        }
        else if (fnName === 'search_code') {
          const query = args.query;
          const searchPath = args.path || '/app';
          
          // execute the tool (search code in pod)
          toolResult = await searchCodeInPod(podName, namespace, query, searchPath);
          console.log(`[SEARCH_CODE] Query: ${query}, Path: ${searchPath}`);
          console.log(`[SEARCH_CODE] Result: ${toolResult.slice(0, 500)}...`);
          
          // Track execution for response
          toolExecutions.push({ 
            function: fnName, 
            args, 
            result: toolResult 
          });
        }
        else if (fnName === 'delete_file') {
          const filePath = args.path;
          
          // execute the tool (delete file from pod)
          toolResult = await deleteFileInPod(podName, namespace, filePath);
          console.log(`[DELETE_FILE] Path: ${filePath}`);
          console.log(`[DELETE_FILE] Result: ${toolResult}`);
          
          // Track execution for response
          toolExecutions.push({ 
            function: fnName, 
            args, 
            result: toolResult 
          });
        }
        else {
          return res.status(400).json({ error: "Unknown tool requested" });
        }

        // Add the tool result into the messages with role "tool"
        messages.push({
          role: "tool",
          tool_call_id: toolCall.id,  // Required for tool responses
          content: toolResult
        });
      }

      // Call the model again with all tool outputs so it can continue reasoning
      console.log(`[LLM] Calling API again with ${messages.length} messages (processed ${currentMessage.tool_calls.length} tool calls)`);
      try {
        currentResponse = await openai.chat.completions.create({
          model: MODEL,
          messages,
          tools
        });
        currentMessage = currentResponse.choices?.[0]?.message;
        console.log(`[LLM] API response received. Has tool_calls: ${currentMessage?.tool_calls?.length || 0}`);
      } catch (apiError) {
        console.error(`[LLM] API call failed:`, apiError);
        const errorMessage = apiError instanceof Error ? apiError.message : String(apiError);
        return res.status(500).json({ 
          error: `OpenAI API call failed: ${errorMessage}`,
          toolExecution: toolExecutions 
        });
      }
    }

    // No more tool calls - return final assistant response
    if (!currentMessage) {
      console.error(`[LLM] No message received from API after ${iterationCount} iterations`);
      return res.status(500).json({ 
        error: "No response from OpenAI API",
        toolExecution: toolExecutions 
      });
    }
    
    console.log(`[LLM] Final response ready. Total iterations: ${iterationCount}`);
    return res.json({
      modelResponse: currentMessage,
      toolExecution: toolExecutions.length === 1 
        ? toolExecutions[0] 
        : toolExecutions // Return array if multiple executions
    });
  } catch (err) {
    console.error(err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    return res.status(500).json({ error: errorMessage });
  }
});


app.post("/sandbox", async (req, res) => {
  try {
    const { prompt } = req.body;
    const baseImageLists = Object.keys(baseImageMap);
    const firstPromptToLLM = `
      I have these list of base images: ${baseImageLists}.
      I have this as the user prompt: ${prompt}.
      Please suggest me a base image based on the user prompt.
      Just return the base image name, no other text.
    `;
    const responseFromLLM = await sendToLLM(firstPromptToLLM);
    const baseImage = responseFromLLM as unknown as keyof typeof baseImageMap;
    // Validate that the baseImage exists in the map
    if (!baseImageMap[baseImage]) {
      throw new Error(`Invalid base image "${baseImage}" returned from LLM. Available options: ${Object.keys(baseImageMap).join(", ")}`);
    }
    console.log("baseImage", baseImage);
    
    const id = randomUUID();
    console.log("Deployment and service creation started...");
    
    const deploymentAndService = await createDeploymentAndServiceForBaseImage(
      id,
      baseImageMap[baseImage],
      1,
      "default"
    );
    console.log("Deployment and service creation completed...");
    res.json({
      url: `${id}.lovableaiweb.info`,
      deployment: deploymentAndService.deployment,
      service: deploymentAndService.service,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
});


app.listen(PORT, () => {
  console.log(`Server is running on port ${PORT}`);
});
