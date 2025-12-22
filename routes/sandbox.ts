import type { Request, Response } from "express";
import { randomUUID } from "crypto";
import { baseImageMap } from "../config";
import { createDeploymentAndServiceForBaseImage } from "../k8s-deployments";
import { sendToLLM } from "../llm";

export async function handleSandbox(req: Request, res: Response) {
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
    const domain = `${id}.lovableaiweb.info`;
    console.log("Deployment and service creation started...");
    
    const deploymentAndService = await createDeploymentAndServiceForBaseImage(
      id,
      baseImageMap[baseImage],
      1,
      "default",
      [
        { name: "VITE_HMR_HOST", value: domain },
        { name: "VITE_HMR_PORT", value: "80" },
      ]
    );
    console.log("Deployment and service creation completed...");
    res.json({
      url: domain,
      deployment: deploymentAndService.deployment,
      service: deploymentAndService.service,
    });
  } catch (error: any) {
    res.status(500).json({ success: false, error: error.message });
  }
}

