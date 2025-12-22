import { exec as cpExec } from "child_process";
import util from "util";

const exec = util.promisify(cpExec);

// Helper function to sanitize pod name
function sanitizePodName(podName: string): string {
  return podName.trim().replace(/^['"]+|['"]+$/g, '');
}

// Helper function to escape single quotes for shell safety
function escapeShellString(str: string): string {
  return str.replace(/'/g, "'\"'\"'");
}

export async function readFileFromPod(podName: string, namespace: string, filePath: string): Promise<string> {
  const cleanPodName = sanitizePodName(podName);
  const cmd = `kubectl exec ${cleanPodName} -n ${namespace} -- cat "${filePath}"`;
  try {
    const { stdout, stderr } = await exec(cmd, { maxBuffer: 10 * 1024 * 1024 });
    if (stderr && !stdout) {
      throw new Error(stderr);
    }
    return stdout;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return `__ERROR_READING_FILE__: ${errorMessage}`;
  }
}

export async function writeFileInPod(podName: string, namespace: string, filePath: string, content: string): Promise<string> {
  const cleanPodName = sanitizePodName(podName);
  
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
  try {
    const { stdout, stderr } = await exec(cmd, { maxBuffer: 10 * 1024 * 1024 });
    if (stderr && !stdout) {
      throw new Error(stderr);
    }

    // Touch the file to trigger file watcher (important for HMR)
    const touchCmd = `kubectl exec ${cleanPodName} -n ${namespace} -- touch "${filePath}"`;
    await exec(touchCmd);

    return `File written successfully to ${filePath}`;
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    return `__ERROR_WRITING_FILE__: ${errorMessage}`;
  }
}

export async function executeCommandInPod(podName: string, namespace: string, command: string, workingDir: string = "/app"): Promise<string> {
  const cleanPodName = sanitizePodName(podName);
  
  // Escape single quotes in the command for safe shell execution
  const escapedCommand = escapeShellString(command);
  
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

export async function searchCodeInPod(podName: string, namespace: string, query: string, searchPath: string = "/app"): Promise<string> {
  const cleanPodName = sanitizePodName(podName);
  
  // Escape special characters in the query for grep
  const escapedQuery = escapeShellString(query);
  
  // Use grep to search recursively, excluding common directories
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

export async function listDirectoryInPod(podName: string, namespace: string, dirPath: string = "/app"): Promise<string> {
  const cleanPodName = sanitizePodName(podName);
  
  // Escape special characters in the path for shell safety
  const escapedPath = escapeShellString(dirPath);
  
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

export async function deleteFileInPod(podName: string, namespace: string, filePath: string): Promise<string> {
  const cleanPodName = sanitizePodName(podName);
  
  // Escape special characters in the path for shell safety
  const escapedPath = escapeShellString(filePath);
  
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
