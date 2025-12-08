// server.js
import express from "express";
import dotenv from "dotenv";
import { exec as cpExec } from "child_process";
import util from "util";
import OpenAI from "openai";

dotenv.config();
const exec = util.promisify(cpExec);

const app = express();
app.use(express.json());

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
// pick a model that supports function/tool calling per OpenAI docs
const MODEL = "gpt-4-0613"; // example — pick a supported model

// Tool descriptor sent to model: tells it the tool signature
const tools = [
    {
      type: "function",
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
      type: "function",
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
      type: "function",
      function: {
        name: "list_directory",
        description: "List the contents of a directory in the Kubernetes pod. Returns a list of files and subdirectories with their details (name, type, permissions).",
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
      type: "function",
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
      type: "function",
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
      type: "function",
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
    }
  ];

// helper: get pod name dynamically using label selector
async function getPodName(namespace, labelSelector = "app=react-app") {
  const cmd = `kubectl get pods -n ${namespace} -l ${labelSelector} -o jsonpath='{.items[0].metadata.name}'`;
  try {
    const { stdout, stderr } = await exec(cmd);
    if (stderr || !stdout || stdout.trim() === '') {
      throw new Error(stderr || "No pod found with the specified label selector");
    }
    // Remove any quotes and trim whitespace
    return stdout.trim().replace(/^['"]+|['"]+$/g, '');
  } catch (err) {
    throw new Error(`Failed to get pod name: ${err.message}`);
  }
}

// helper: run kubectl exec and return stdout string (utf8)
async function readFileFromPod(podName, namespace, filePath) {
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
    return `__ERROR_READING_FILE__: ${err.message}`;
  }
}


async function writeFileInPod(podName, namespace, filePath, content){
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
      console.warn(`Warning: Could not create directory ${dirPath}: ${err.message}`);
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
    return `__ERROR_WRITING_FILE__: ${err.message}`
  }
}

async function executeCommandInPod(podName, namespace, command, workingDir = "/app") {
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
    return `__ERROR_EXECUTING_COMMAND__: ${err.message}`;
  }
}

async function searchCodeInPod(podName, namespace, query, searchPath = "/app") {
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
    return `__ERROR_SEARCHING_CODE__: ${err.message}`;
  }
}

async function listDirectoryInPod(podName, namespace, dirPath = "/app") {
  const cleanPodName = podName.trim().replace(/^['"]+|['"]+$/g, '');
  
  // Escape special characters in the path for shell safety
  const escapedPath = dirPath.replace(/'/g, "'\"'\"'");
  
  // Use ls -la to get detailed directory listing
  const cmd = `kubectl exec ${cleanPodName} -n ${namespace} -- sh -c "ls -la '${escapedPath}' 2>&1"`;
  
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
    return `__ERROR_LISTING_DIRECTORY__: ${err.message}`;
  }
}

async function deleteFileInPod(podName, namespace, filePath) {
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
    return `__ERROR_DELETING_FILE__: ${err.message}`;
  }
}

// helper: get folder structure from pod using find command
async function getFolderMetadata(podName, namespace) {
  // Ensure podName doesn't have quotes
  const cleanPodName = podName.trim().replace(/^['"]+|['"]+$/g, '');
  const cmd = `kubectl exec ${cleanPodName} -n ${namespace} -- find /app -maxdepth 3 -not -path "*/node_modules/*"`;
  try {
    const { stdout, stderr } = await exec(cmd, { maxBuffer: 10 * 1024 * 1024 });
    if (stderr && !stdout) {
      throw new Error(stderr);
    }
    return stdout;
  } catch (err) {
    return `__ERROR_GETTING_FOLDER_METADATA__: ${err.message}`;
  }
}

// simple endpoint demonstrating the agent loop
app.post("/agent", async (req, res) => {
  console.log(`[AGENT] New request received`);
  const userPrompt = req.body.prompt || "Please inspect the repo and ask for any file you need.";
  
  const namespace = process.env.NAMESPACE || "default";
  const labelSelector = process.env.LABEL_SELECTOR || "app=react-app";

  // Dynamically get pod name using label selector
  let podName;
  try {
    podName = await getPodName(namespace, labelSelector);
  } catch (err) {
    console.error(`[AGENT] ERROR: Failed to find pod: ${err.message}`);
    return res.status(400).json({ error: `Failed to find pod: ${err.message}` });
  }

  // Get actual folder metadata from the pod
  const folderMetadataRaw = await getFolderMetadata(podName, namespace);
  const folderMetadata = `Project tree:\n${folderMetadataRaw}`;

  // initial message history
  const messages = [
    { role: "system", content: "You are an expert code assistant. Use tools if you need to read files, write files, execute commands, or search the codebase." },
    { role: "user", content: `${userPrompt}\n\n${folderMetadata}\nIf you need to read a file, call the 'read_file' tool. If you need to write or update a file, call the 'write_file' tool with { "path": "/app/your-file.js", "content": "file content here" }. If you need to install packages, run scripts, or execute any shell command, use the 'execute_command' tool with { "command": "your-command-here", "working_directory": "/app" }. If you need to find where code is used or search for patterns, use the 'search_code' tool with { "query": "search-term", "path": "/app" }.` }
  ];

  try {
    // 1) Ask the model (tools included in request)
    let currentResponse = await openai.chat.completions.create({
      model: MODEL,
      messages,
      // provide the tools so the model can produce a function call
      tools,
      tool_choice: "auto"
    });

    let currentMessage = currentResponse.choices?.[0]?.message;
    const toolExecutions = []; // Track all tool executions

    // need to add logs and max iterations to prevent infinite tool calls
    const MAX_ITERATIONS = 20;
    let iterationCount = 0;

    // Keep processing tool calls until model returns a final response
    while (currentMessage?.tool_calls && currentMessage.tool_calls.length > 0) {
      iterationCount++;
      console.log(`[AGENT] Iteration ${iterationCount} - Processing ${currentMessage.tool_calls.length} tool call(s)`);
      
      if(iterationCount > MAX_ITERATIONS) {
        console.error(`[AGENT] ERROR: Max iterations (${MAX_ITERATIONS}) reached!`);
        return res.status(500).json({ 
          error: "Max iterations reached", 
          lastMessage: currentMessage 
        });
      }
      
      // Add the assistant's tool call message to history ONCE per iteration
      messages.push(currentMessage);
      
      // Process each tool call
      for (const toolCall of currentMessage.tool_calls) {
        // Process each tool call
        const fnName = toolCall.function.name;
        const rawArgs = toolCall.function.arguments || "{}";
        
        let args = {};
        try { 
          args = JSON.parse(rawArgs); 
        } catch (e) {
          args = { path: rawArgs }; // fallback if model returned plain string
        }

        let toolResult;
        
        if (fnName === "read_file") {
          const filePath = args.path;
          console.log(`[AGENT] Executing: ${fnName}(${filePath})`);
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
          console.log(`[AGENT] Executing: ${fnName}(${filePath})`);
          // execute the tool (write file to pod)
          toolResult = await writeFileInPod(podName, namespace, filePath, fileContent);
          
          // Track execution for response
          toolExecutions.push({ 
            function: fnName, 
            args, 
            result: toolResult 
          });
        }
        else if (fnName === 'list_directory') {
          const dirPath = args.path || '/app';
          console.log(`[AGENT] Executing: ${fnName}(${dirPath})`);
          // execute the tool (list directory in pod)
          toolResult = await listDirectoryInPod(podName, namespace, dirPath);
          
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
          console.log(`[AGENT] Executing: ${fnName}(${command})`);
          // execute the tool (run command in pod)
          toolResult = await executeCommandInPod(podName, namespace, command, workingDir);
          
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
          console.log(`[AGENT] Executing: ${fnName}(${query})`);
          // execute the tool (search code in pod)
          toolResult = await searchCodeInPod(podName, namespace, query, searchPath);
          
          // Track execution for response
          toolExecutions.push({ 
            function: fnName, 
            args, 
            result: toolResult 
          });
        }
        else if (fnName === 'delete_file') {
          const filePath = args.path;
          console.log(`[AGENT] Executing: ${fnName}(${filePath})`);
          // execute the tool (delete file from pod)
          toolResult = await deleteFileInPod(podName, namespace, filePath);
          
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

      // Call the model again with the tool output so it can continue reasoning
      currentResponse = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools
      });

      currentMessage = currentResponse.choices?.[0]?.message;
    }

    // No more tool calls - return final assistant response
    console.log(`[AGENT] Completed: ${iterationCount} iteration(s), ${toolExecutions.length} tool execution(s)`);
    
    return res.json({
      modelResponse: currentMessage,
      toolExecution: toolExecutions.length === 1 
        ? toolExecutions[0] 
        : toolExecutions // Return array if multiple executions
    });
  } catch (err) {
    console.error(`[AGENT] ERROR: ${err.message}`);
    return res.status(500).json({ error: err.message });
  }
});

function sendSSE(res, type, data){
  res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
}



app.post("/stream-agent", async (req, res) => {
  console.log(`[STREAM-AGENT] New request received at ${new Date().toISOString()}`);
  console.log(`[STREAM-AGENT] Request body:`, JSON.stringify(req.body));
  
  // Set headers immediately
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*'); // Allow CORS for testing

  try {
    sendSSE(res, 'status', { message: 'Starting agent...' });

    const userPrompt = req.body.prompt || "Please inspect the repo and ask for any file you need.";
    const namespace = process.env.NAMESPACE || "default";
    const labelSelector = process.env.LABEL_SELECTOR || "app=react-app";

    let podName = null;
    let folderMetadata = "";

    // Dynamically get pod name using label selector
    try {
      console.log(`[STREAM-AGENT] Attempting to get pod name...`);
      podName = await getPodName(namespace, labelSelector);
      console.log(`[STREAM-AGENT] Pod found: ${podName}`);
      sendSSE(res, 'pod_found', { podName });

      // Get actual folder metadata from the pod
      console.log(`[STREAM-AGENT] Getting folder metadata...`);
      const folderMetadataRaw = await getFolderMetadata(podName, namespace);
      folderMetadata = `Project tree:\n${folderMetadataRaw}`;
    } catch (err) {
      console.error(`[STREAM-AGENT] ERROR: Failed to find pod: ${err.message}`);
      sendSSE(res, 'warning', { message: `Failed to find pod: ${err.message}. Continuing without pod access.` });
      folderMetadata = "Note: Pod access unavailable. You can still provide instructions.";
    }

    // initial message history
    const messages = [
      { role: "system", content: "You are an expert code assistant. Use tools if you need to read files, write files, execute commands, or search the codebase." },
      { role: "user", content: `${userPrompt}\n\n${folderMetadata}\nIf you need to read a file, call the 'read_file' tool. If you need to write or update a file, call the 'write_file' tool with { "path": "/app/your-file.js", "content": "file content here" }. If you need to install packages, run scripts, or execute any shell command, use the 'execute_command' tool with { "command": "your-command-here", "working_directory": "/app" }. If you need to find where code is used or search for patterns, use the 'search_code' tool with { "query": "search-term", "path": "/app" }.` }
    ];

    const MAX_ITERATIONS = 20;
    let iterationCount = 0;
    const toolExecutions = []; // Track all tool executions
    // Start the agent loop
    let hasMoreToolCalls = true;
    
    while (hasMoreToolCalls) {
      iterationCount++;
      
      if (iterationCount > MAX_ITERATIONS) {
        console.error(`[STREAM-AGENT] ERROR: Max iterations (${MAX_ITERATIONS}) reached!`);
        sendSSE(res, 'error', { message: `Max iterations (${MAX_ITERATIONS}) reached` });
        res.end();
        return;
      }

      console.log(`[STREAM-AGENT] Iteration ${iterationCount} - Calling model...`);

      // Call the model with streaming
      let currentResponse = await openai.chat.completions.create({
        model: MODEL,
        messages,
        tools,
        tool_choice: "auto",
        stream: true
      });

      // Initialize message accumulator for this iteration
      let currentMessage = { role: "assistant", content: "", tool_calls: [] };

      // Process streaming chunks
      for await (const chunk of currentResponse) {
        const delta = chunk.choices[0]?.delta;
        if (!delta) continue;
        
        // Accumulate content if present
        if (delta.content) {
          currentMessage.content += delta.content;
          sendSSE(res, 'model_chunk', { content: delta.content });
        }

        // Accumulate tool calls
        if (delta.tool_calls) {
          for (const toolCallDelta of delta.tool_calls) {
            const i = toolCallDelta.index;
        
            // Ensure array slot exists
            if (!currentMessage.tool_calls[i]) {
              currentMessage.tool_calls[i] = {
                id: "",
                type: "function",
                function: { name: "", arguments: "" }
              };
            }
        
            const call = currentMessage.tool_calls[i];
        
            // ID (usually arrives once)
            if (toolCallDelta.id) {
              call.id = toolCallDelta.id;
            }
        
            // Function name (may stream in parts)
            if (toolCallDelta.function?.name) {
              call.function.name += toolCallDelta.function.name;
            }
        
            // Function arguments (always streams in many chunks)
            if (toolCallDelta.function?.arguments) {
              call.function.arguments += toolCallDelta.function.arguments;
            }
          }
        }
      }

      // Check if we have tool calls to process
      if (currentMessage.tool_calls && currentMessage.tool_calls.length > 0) {
        console.log(`[STREAM-AGENT] Iteration ${iterationCount} - Processing ${currentMessage.tool_calls.length} tool call(s)`);
        
        // Add the assistant's tool call message to history
        messages.push(currentMessage);
        
        sendSSE(res, 'tool_calls', { 
          count: currentMessage.tool_calls.length,
          calls: currentMessage.tool_calls.map(tc => ({ 
            id: tc.id, 
            name: tc.function.name 
          }))
        });

        // Process each tool call
        for (const toolCall of currentMessage.tool_calls) {
          const fnName = toolCall.function.name;
          const rawArgs = toolCall.function.arguments || "{}";
          
          let args = {};
          try {
            args = JSON.parse(rawArgs);
          } catch (e) {
            args = { path: rawArgs }; // fallback if model returned plain string
          }

          sendSSE(res, 'tool_start', { function: fnName, args });

          let toolResult;
          
          if (fnName === "read_file") {
            const filePath = args.path;
            console.log(`[STREAM-AGENT] Executing: ${fnName}(${filePath})`);
            if (!podName) {
              toolResult = `__ERROR_READING_FILE__: Pod access not available.`;
            } else {
              toolResult = await readFileFromPod(podName, namespace, filePath);
            }
            
            toolExecutions.push({ 
              function: fnName, 
              args, 
              filePreview: toolResult.slice(0, 1000) 
            });
          } 
          else if (fnName === 'write_file') {
            const filePath = args.path;
            const fileContent = args.content;
            console.log(`[STREAM-AGENT] Executing: ${fnName}(${filePath})`);
            if (!podName) {
              toolResult = `__ERROR_WRITING_FILE__: Pod access not available.`;
            } else {
              toolResult = await writeFileInPod(podName, namespace, filePath, fileContent);
            }
            
            toolExecutions.push({ 
              function: fnName, 
              args, 
              result: toolResult 
            });
          }
          else if (fnName === 'list_directory') {
            const dirPath = args.path || '/app';
            console.log(`[STREAM-AGENT] Executing: ${fnName}(${dirPath})`);
            if (!podName) {
              toolResult = `__ERROR_LISTING_DIRECTORY__: Pod access not available.`;
            } else {
              toolResult = await listDirectoryInPod(podName, namespace, dirPath);
            }
            
            toolExecutions.push({ 
              function: fnName, 
              args, 
              result: toolResult 
            });
          }
          else if (fnName === 'execute_command') {
            const command = args.command;
            const workingDir = args.working_directory || '/app';
            console.log(`[STREAM-AGENT] Executing: ${fnName}(${command})`);
            if (!podName) {
              toolResult = `__ERROR_EXECUTING_COMMAND__: Pod access not available.`;
            } else {
              toolResult = await executeCommandInPod(podName, namespace, command, workingDir);
            }
            
            toolExecutions.push({ 
              function: fnName, 
              args, 
              result: toolResult 
            });
          }
          else if (fnName === 'search_code') {
            const query = args.query;
            const searchPath = args.path || '/app';
            console.log(`[STREAM-AGENT] Executing: ${fnName}(${query})`);
            if (!podName) {
              toolResult = `__ERROR_SEARCHING_CODE__: Pod access not available.`;
            } else {
              toolResult = await searchCodeInPod(podName, namespace, query, searchPath);
            }
            
            toolExecutions.push({ 
              function: fnName, 
              args, 
              result: toolResult 
            });
          }
          else if (fnName === 'delete_file') {
            const filePath = args.path;
            console.log(`[STREAM-AGENT] Executing: ${fnName}(${filePath})`);
            if (!podName) {
              toolResult = `__ERROR_DELETING_FILE__: Pod access not available.`;
            } else {
              toolResult = await deleteFileInPod(podName, namespace, filePath);
            }
            
            toolExecutions.push({ 
              function: fnName, 
              args, 
              result: toolResult 
            });
          }
          else {
            sendSSE(res, 'error', { message: `Unknown tool requested: ${fnName}` });
            res.end();
            return;
          }

          // Add the tool result into the messages with role "tool"
          messages.push({
            role: "tool",
            tool_call_id: toolCall.id,
            content: toolResult
          });

          sendSSE(res, 'tool_result', { 
            function: fnName, 
            result: toolResult.slice(0, 500) // Preview of result
          });
        }
      } else {
        // No more tool calls - this is the final response
        console.log(`[STREAM-AGENT] Completed: ${iterationCount} iteration(s), ${toolExecutions.length} tool execution(s)`);
        
        // Add final message to history (always add, even if empty, for consistency)
        messages.push(currentMessage);
        
        sendSSE(res, 'complete', { 
          message: 'Agent completed',
          iterations: iterationCount,
          toolExecutions: toolExecutions.length,
          finalResponse: currentMessage.content || "No response content"
        });
        
        hasMoreToolCalls = false;
      }
    }

    res.end();
  } catch (err) {
    console.error(`[STREAM-AGENT] ERROR: ${err.message}`);
    console.error(`[STREAM-AGENT] Stack:`, err.stack);
    try {
      sendSSE(res, 'error', { message: err.message });
      res.end();
    } catch (sendError) {
      // Response might already be closed
      console.error(`[STREAM-AGENT] Failed to send error: ${sendError.message}`);
      res.end();
    }
  }
})


const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
