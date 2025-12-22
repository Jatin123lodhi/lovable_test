export const baseImageMap: Record<string, string> = {
  "react": "cryptocal/react_base_img:latest",
  "react-native": "cryptocal/react-native_base_img:latest",
  "flutter": "cryptocal/flutter_base_img:latest",
  "vue": "cryptocal/vue_base_img:latest",
  "angular": "cryptocal/angular_base_img:latest",
  "svelte": "cryptocal/svelte_base_img:latest",
  "nextjs": "cryptocal/nextjs_base_img:latest",
  "nuxtjs": "cryptocal/nuxtjs_base_img:latest",
};

export const MODEL = "gpt-4-0613";
export const PORT = process.env.PORT || 3000;
export const DEFAULT_NAMESPACE = process.env.NAMESPACE || "default";
export const DEFAULT_LABEL_SELECTOR = process.env.LABEL_SELECTOR || "app=react-app";

