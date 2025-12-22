import type { Request, Response } from "express";
import { DEFAULT_NAMESPACE } from "../config";
import { readFileFromPod, writeFileInPod } from "../pod-operations";

// Helper function to send Server-Sent Events
function sendSSE(res: Response, type: string, data: any) {
  res.write(`data: ${JSON.stringify({ type, data })}\n\n`);
}

export async function handleStreamDummy(req: Request, res: Response) {
  console.log(`[STREAM-DUMMY] New request received at ${new Date().toISOString()}`);
  
  // Set headers immediately for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  const namespace = process.env.NAMESPACE || DEFAULT_NAMESPACE;
  const podName = req.body.podName;
  const appTsxPath = req.body.filePath || "/app/src/App.tsx";

  if (!podName) {
    sendSSE(res, 'error', { message: 'podName is required' });
    res.end();
    return;
  }

  try {
    sendSSE(res, 'status', { message: 'Starting dummy stream...' });
    sendSSE(res, 'pod_found', { podName, source: 'provided' });

    // Read current App.tsx to get its structure
    sendSSE(res, 'status', { message: 'Reading current App.tsx...' });
    let currentAppContent = "";
    try {
      currentAppContent = await readFileFromPod(podName, namespace, appTsxPath);
      sendSSE(res, 'file_read', { path: appTsxPath, preview: currentAppContent.slice(0, 200) });
    } catch (err) {
      // If file doesn't exist, create a basic React component structure
      console.log(`[STREAM-DUMMY] File not found, creating new App.tsx`);
      currentAppContent = `import { useState, useEffect } from 'react';

function App() {
  const [numbers, setNumbers] = useState<number[]>([]);

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>Streaming Test</h1>
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(10, 1fr)', 
        gap: '10px',
        marginTop: '20px'
      }}>
        {numbers.map((num) => (
          <div 
            key={num} 
            style={{ 
              padding: '10px', 
              background: '#007bff', 
              color: 'white', 
              borderRadius: '5px',
              textAlign: 'center'
            }}
          >
            {num}
          </div>
        ))}
      </div>
      {numbers.length === 100 && (
        <p style={{ marginTop: '20px', color: 'green' }}>
          ✅ Stream completed! Received all 100 numbers.
        </p>
      )}
    </div>
  );
}

export default App;`;
    }

    // Extract the numbers array initialization if it exists, otherwise start fresh
    let numbersArray: number[] = [];
    
    // Write numbers 1-100 incrementally
    for (let i = 1; i <= 100; i++) {
      numbersArray.push(i);
      
      // Create the updated App.tsx content with current numbers
      const updatedAppContent = `import { useState, useEffect } from 'react';

function App() {
  const [numbers] = useState<number[]>([${numbersArray.join(', ')}]);

  return (
    <div style={{ padding: '20px', fontFamily: 'Arial' }}>
      <h1>Streaming Test</h1>
      <p>Status: 🟢 Connected - Received ${numbersArray.length}/100 numbers</p>
      <div style={{ 
        display: 'grid', 
        gridTemplateColumns: 'repeat(10, 1fr)', 
        gap: '10px',
        marginTop: '20px'
      }}>
        {numbers.map((num) => (
          <div 
            key={num} 
            style={{ 
              padding: '10px', 
              background: '#007bff', 
              color: 'white', 
              borderRadius: '5px',
              textAlign: 'center'
            }}
          >
            {num}
          </div>
        ))}
      </div>
      {numbers.length === 100 && (
        <p style={{ marginTop: '20px', color: 'green' }}>
          ✅ Stream completed! Received all 100 numbers.
        </p>
      )}
    </div>
  );
}

export default App;`;

      // Write the file
      sendSSE(res, 'tool_start', { 
        function: 'write_file', 
        args: { path: appTsxPath, number: i } 
      });
      
      const writeResult = await writeFileInPod(podName, namespace, appTsxPath, updatedAppContent);
      
      sendSSE(res, 'tool_result', { 
        function: 'write_file', 
        result: `Written number ${i} to App.tsx`,
        number: i,
        total: 100
      });

      sendSSE(res, 'model_chunk', { content: `Number ${i} written... ` });

      // Wait 1 second before next write
      if (i < 100) {
        await new Promise(resolve => setTimeout(resolve, 1000));
      }
    }

    sendSSE(res, 'complete', { 
      message: 'Dummy stream completed',
      totalNumbers: 100,
      filePath: appTsxPath
    });

    res.end();
  } catch (err) {
    console.error(`[STREAM-DUMMY] ERROR:`, err);
    const errorMessage = err instanceof Error ? err.message : String(err);
    try {
      sendSSE(res, 'error', { message: errorMessage });
      res.end();
    } catch (sendError) {
      console.error(`[STREAM-DUMMY] Failed to send error: ${sendError instanceof Error ? sendError.message : String(sendError)}`);
      res.end();
    }
  }
}

