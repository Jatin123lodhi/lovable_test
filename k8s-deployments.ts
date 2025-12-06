import {
  KubeConfig,
  CoreV1Api,
  AppsV1Api,
  V1Deployment,
  V1Service,
} from "@kubernetes/client-node";
import fs from "fs";


// Initialize Kubernetes clients
const kc = new KubeConfig();
process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
// Load kubeconfig with fallback priority:
// 1. KUBECONFIG environment variable (file path)
// 2. Default kubeconfig location (~/.kube/config)
// 3. In-cluster config (when running inside Kubernetes)
const kubeconfigPath = process.env.KUBECONFIG || 
  (process.platform === 'win32' 
    ? `${process.env.HOME || process.env.USERPROFILE}\\.kube\\config`
    : `${process.env.HOME}/.kube/config`);
console.log("kubeconfigPath", kubeconfigPath);
try {
  // Try loading from file first (for local development or when KUBECONFIG is set)
  if (process.env.KUBECONFIG || fs.existsSync(kubeconfigPath)) {
    console.log("Loading kubeconfig from file:", kubeconfigPath);
    kc.loadFromFile(kubeconfigPath);

  } else {
    // Fallback to in-cluster config (when running as a pod in Kubernetes)
    console.log("Loading kubeconfig from cluster");
    kc.loadFromCluster();
  }
} catch (error) {
  // If file loading fails, try in-cluster config
  try {
    kc.loadFromCluster();
  } catch (clusterError) {
    console.error('Failed to load Kubernetes config:', error);
    throw new Error('Unable to initialize Kubernetes client. Please ensure KUBECONFIG is set or running in-cluster.');
  }
}   


export const k8sCoreApi = kc.makeApiClient(CoreV1Api);
export const k8sAppsApi = kc.makeApiClient(AppsV1Api);


/**
 * Creates a deployment with react_base_img and a service for it
 * @param name - Deployment name (default: auto-generated)
 * @param image - Docker image name (default: "cryptocal/react_base_img:latest")
 * @param replicas - Number of replicas (default: 1)
 * @param namespace - Kubernetes namespace (default: "default")
 * @returns Promise with deployment and service details
 */
export async function createDeploymentAndServiceForBaseImage(
  name?: string,
  image: string = "cryptocal/react_base_img:latest",
  replicas: number = 1,
  namespace: string = "default"
) {
  const deploymentName = name || `image-${Date.now()}`;

  const deploymentManifest = {
    metadata: {
      name: deploymentName,
      namespace: namespace,
      labels: {
        app: deploymentName,
      },
    },
    spec: {
      replicas: replicas,
      selector: {
        matchLabels: {
          app: deploymentName,
        },
      },
      template: {
        metadata: {
          labels: {
            app: deploymentName,
          },
        },
        spec: {
          containers: [
            {
              name: "react-container",
              image: image,
              ports: [
                {
                  containerPort: 5173,
                },
              ],
            },
          ],
        },
      },
    },
  };

  const deploymentResponse = await k8sAppsApi.createNamespacedDeployment({
    namespace: namespace,
    body: deploymentManifest as V1Deployment,
  });
  console.log("Deployment created:", deploymentResponse);

  // Create service for the deployment
  const serviceManifest = {
    metadata: {
      name: `service-${deploymentName}`,
      namespace: namespace,
    },
    spec: {
      selector: {
        app: deploymentName,
      },
      ports: [
        {
          port: 5173,
          targetPort: 5173,
        },
      ],
    },
  };

  const serviceResponse = await k8sCoreApi.createNamespacedService({
    namespace: namespace,
    body: serviceManifest as V1Service,
  });

  console.log("Service created:", serviceResponse);

  return {
    success: true,
    deployment: deploymentResponse.metadata?.name,
    service: serviceResponse.metadata?.name,
    namespace: namespace,
  };
}

