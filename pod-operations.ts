import type { ToolCall, ToolCallResult } from "./types";
import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export async function executeToolCall(
  podName: string,
  toolCall: ToolCall,
  namespace: string = "default"
): Promise<ToolCallResult> {
  try {
    switch (toolCall.type) {
      case "create_file":
        return await createFileInPod(podName, toolCall.file_path, toolCall.content || "", namespace);
      
      case "update_file":
        return await updateFileInPod(podName, toolCall.file_path, toolCall.content || "", namespace);
      
      case "delete_file":
        return await deleteFileInPod(podName, toolCall.file_path, namespace);
      
      case "read_file":
        return await readFileInPod(podName, toolCall.file_path, namespace);
      
      default:
        return { success: false, error: `Unknown tool call type: ${toolCall.type}` };
    }
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function createFileInPod(
  podName: string,
  filePath: string,
  content: string,
  namespace: string = "default"
): Promise<ToolCallResult> {
  try {
    // Safe heredoc to avoid escaping issues
    const base64Content = Buffer.from(content).toString('base64');
    const command = `kubectl exec ${podName} -n ${namespace} -- sh -c "echo '${base64Content}' | base64 -d > ${filePath}"`;

    const { stdout, stderr } = await execAsync(command);
    console.log("stdout", stdout);
    console.log("stderr", stderr);
    if (stderr && stderr.trim()) {
      return { success: false, error: stderr };
    }

    return { success: true, output: stdout.trim() };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function updateFileInPod(
  podName: string,
  filePath: string,
  content: string,
  namespace: string = "default"
): Promise<ToolCallResult> {
  try {
    // Encode content to base64 to safely handle special characters, newlines, etc.
    const base64Content = Buffer.from(content).toString('base64');
    
    // Create directory if it doesn't exist, then write the file
    // Using mkdir -p to create parent directories if needed
    const lastSlashIndex = filePath.lastIndexOf('/');
    const dirPath = lastSlashIndex > 0 ? filePath.substring(0, lastSlashIndex) : '.';
    
    // Write file using base64 decode to handle any content safely
    const command = `kubectl exec ${podName} -n ${namespace} -- sh -c "mkdir -p ${dirPath} && echo '${base64Content}' | base64 -d > ${filePath}"`;

    const { stdout, stderr } = await execAsync(command);
    console.log("stdout", stdout);
    console.log("stderr", stderr);
    
    if (stderr && stderr.trim() && !stderr.includes("Warning") && !stderr.includes("warn")) {
      return { success: false, error: stderr };
    }

    return { 
      success: true, 
      output: `File ${filePath} updated successfully in pod ${podName}` 
    };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
}

export async function deleteFileInPod(
  podName: string,
  filePath: string,
  namespace: string = "default"
): Promise<ToolCallResult> {

  
  const command = `kubectl exec ${podName} -n ${namespace} -- rm ${filePath}`;
  const { stdout, stderr } = await execAsync(command);
  console.log("stdout", stdout);
  console.log("stderr", stderr);
  if (stderr && stderr.trim()) {
    return { success: false, error: stderr };
  }
  return { success: true, output: stdout.trim() };
}

export async function readFileInPod(
  podName: string,
  filePath: string,
  namespace: string = "default"
): Promise<ToolCallResult> {

  const command = `kubectl exec ${podName} -n ${namespace} -- cat ${filePath}`;
  const { stdout, stderr } = await execAsync(command);
  console.log("stdout", stdout);
  console.log("stderr", stderr);
  if (stderr && stderr.trim()) {
    return { success: false, error: stderr };
  }
  return { success: true, output: stdout.trim() };
}

