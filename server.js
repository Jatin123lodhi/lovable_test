// server.js
import express from "express";
import dotenv from "dotenv";
import { exec as cpExec } from "child_process";
import util from "util";
import fs from "fs-extra";
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
    }
  ];

// helper: run kubectl exec and return stdout string (utf8)
async function readFileFromPod(podName, namespace, filePath) {
  // WARNING: sanitize filePath in production. This is minimal demo.
  const cmd = `kubectl exec ${podName} -n ${namespace} -- cat ${filePath}`;
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

// helper: get folder structure from pod using find command
async function getFolderMetadata(podName, namespace) {
  const cmd = `kubectl exec ${podName} -n ${namespace} -- find /app -maxdepth 3 -not -path "*/node_modules/*"`;
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
  const userPrompt = req.body.prompt || "Please inspect the repo and ask for any file you need.";
  const podName = process.env.POD_NAME;
  const namespace = process.env.NAMESPACE || "default";

  // Get actual folder metadata from the pod
  const folderMetadataRaw = await getFolderMetadata(podName, namespace);
  const folderMetadata = `Project tree:\n${folderMetadataRaw}`;

  // initial message history
  const messages = [
    { role: "system", content: "You are an expert code assistant. Use tools if you need to read files." },
    { role: "user", content: `${userPrompt}\n\n${folderMetadata}\nIf you need to read a file, call the 'read_file' tool with { \"path\": \"/app/your-file.js\" }.` }
  ];

  try {
    // 1) Ask the model (tools included in request)
    const initialResp = await openai.chat.completions.create({
      model: MODEL,
      messages,
      // provide the tools so the model can produce a function call
      tools,
      tool_choice: "auto"
    });

    const choice = initialResp.choices?.[0];
    const message = choice?.message;
    console.log(message,'-----msessage')
    // If model decided to call a function/tool:
    if (message?.tool_calls && message.tool_calls.length > 0) {  // Changed from function_call
        const toolCall = message.tool_calls[0];  // Get first tool call
        const fnName = toolCall.function.name;  // Changed structure
        const rawArgs = toolCall.function.arguments || "{}"; 
      let args = {};
      try { args = JSON.parse(rawArgs); } catch (e) {
        args = { path: rawArgs }; // fallback if model returned plain string
      }

      if (fnName === "read_file") {
        const filePath = args.path;

        messages.push(message);

        // execute the tool (read file from pod)
        const fileContent = await readFileFromPod(podName, namespace, filePath);

        // Add the tool result into the messages with role "tool" or "function"
        messages.push({
            role: "tool",
            tool_call_id: toolCall.id,  // Add this - required for tool responses
            name: fnName,
            content: fileContent
          });

        // 2) Call the model again with the tool output so it can continue reasoning
        const followup = await openai.chat.completions.create({
          model: MODEL,
          messages,
          tools
        });

        // final assistant output
        return res.json({
          modelResponse: followup.choices?.[0]?.message,
          toolExecution: { function: fnName, args, filePreview: fileContent.slice(0, 1000) }
        });
      } else {
        return res.status(400).json({ error: "Unknown tool requested" });
      }
    } else {
      // Model didn't call tool; return model message directly
      return res.json({ modelResponse: message });
    }
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Server running on ${PORT}`));
