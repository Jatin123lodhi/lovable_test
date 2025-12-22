import type { Request, Response } from "express";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";
import { MODEL, DEFAULT_NAMESPACE, baseImageMap } from "../config";
import { tools } from "../tools";
import { startBaseImageDeployment } from "../deployment";
import {
  readFileFromPod,
  writeFileInPod,
  listDirectoryInPod,
  executeCommandInPod,
  searchCodeInPod,
  deleteFileInPod,
} from "../pod-operations";

const openai = new OpenAI({ 
  apiKey: process.env.OPENAI_API_KEY,
  timeout: 120000, // 2 minute timeout for API calls
  maxRetries: 2
});

export async function handleAgent(req: Request, res: Response) {
  const userPrompt = req.body.prompt || "Please inspect the repo and ask for any file you need.";
  const namespace = process.env.NAMESPACE || DEFAULT_NAMESPACE;
  const labelSelector = process.env.LABEL_SELECTOR || "app=react-app";

  // Track the current pod name (can be provided in request or set when start_base_image is called)
  let podName: string | undefined = req.body.podName;

  // Build initial message based on whether podName is provided
  let systemMessage = "You are a helpful assistant that can interact with Kubernetes pods and manage deployments. IMPORTANT: When starting a new base image deployment, always first use 'list_directory' to check the directory structure and see what files exist before trying to read them. React base images typically use TypeScript (.tsx files), not JavaScript (.js). After starting a deployment, wait a moment and check the directory structure to understand the project layout.";
  
  let userMessage = userPrompt;
  
  if (podName) {
    // Pod already provided - skip base image creation step
    console.log(`[LLM] Using provided pod: ${podName}`);
    userMessage += `\n\nNOTE: A pod is already available (${podName}). You can directly use the following tools without calling 'start_base_image':\n- read_file: Read files from the pod\n- write_file: Write or update files\n- list_directory: List directory contents\n- execute_command: Run shell commands\n- search_code: Search for code patterns\n- delete_file: Delete files\n\nIMPORTANT WORKFLOW:\n1. First use 'list_directory' with { "path": "/app" } to see the project structure\n2. Then use 'list_directory' with { "path": "/app/src" } to see source files\n3. React apps typically use .tsx or .ts files, not .js files\n4. Once you know the file structure, use 'read_file' to read files\n5. Use 'write_file' to create or update files\n6. Use 'execute_command' to run commands like 'npm install' or 'npm run dev'\n7. Use 'search_code' to find code patterns\n\nIf a file doesn't exist when you try to read it, check the directory structure first to find the correct path and file extension.`;
  } else {
    // No pod provided - need to start base image first
    userMessage += `\n\nAvailable base images: ${Object.keys(baseImageMap).join(", ")}. If you need to start a base image deployment, call the 'start_base_image' tool with { "base_image": "react" } (or vue, angular, nextjs, nuxtjs, flutter, react-native, svelte).\n\nIMPORTANT WORKFLOW:\n1. After starting a base image, first use 'list_directory' with { "path": "/app" } to see the project structure\n2. Then use 'list_directory' with { "path": "/app/src" } to see source files\n3. React apps typically use .tsx or .ts files, not .js files\n4. Once you know the file structure, use 'read_file' to read files\n5. Use 'write_file' to create or update files\n6. Use 'execute_command' to run commands like 'npm install' or 'npm run dev'\n7. Use 'search_code' to find code patterns\n\nIf a file doesn't exist when you try to read it, check the directory structure first to find the correct path and file extension.`;
  }

  // initial message history
  const messages: ChatCompletionMessageParam[] = [
    { role: "system", content: systemMessage },
    { role: "user", content: userMessage }
  ];

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
}

