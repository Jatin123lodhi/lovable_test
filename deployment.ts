import { randomUUID } from "crypto";
import { exec as cpExec } from "child_process";
import util from "util";
import { createDeploymentAndServiceForBaseImage } from "./k8s-deployments";
import { baseImageMap } from "./config";

const exec = util.promisify(cpExec);

export interface DeploymentResult {
  podName: string;
  uniqueId: string;
  domain: string;
}

// Helper function to start base image deployment and return pod name
export async function startBaseImageDeployment(
  baseImage: string,
  deploymentName?: string,
  namespace: string = "default"
): Promise<DeploymentResult> {
  // 1. Get the image from baseImageMap[baseImage]
  const image = baseImageMap[baseImage];
  if (!image) {
    throw new Error(`Invalid base image "${baseImage}". Available options: ${Object.keys(baseImageMap).join(", ")}`);
  }

  // 2. Generate a UUID as the unique ID (instead of timestamp-based name)
  const uniqueId = deploymentName || randomUUID();
  const finalDeploymentName = uniqueId; // Use UUID directly as deployment name

  // Build the public domain for HMR configuration
  const domain = `${uniqueId}.lovableaiweb.info`;

  // 3. Create deployment and service using createDeploymentAndServiceForBaseImage
  console.log(`Creating deployment "${finalDeploymentName}" with image "${image}" in namespace "${namespace}"`);
  const deploymentAndService = await createDeploymentAndServiceForBaseImage(
    finalDeploymentName,
    image,
    1,
    namespace,
    [
      { name: "VITE_HMR_HOST", value: domain },
      { name: "VITE_HMR_PORT", value: "80" },
    ]
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
    return { podName, uniqueId, domain };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : String(err);
    throw new Error(`Failed to get pod name: ${errorMessage}`);
  }
}

