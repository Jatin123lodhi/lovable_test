// ============================================================================
// Types for AI Tool Calls
// ============================================================================

export type ToolCallType = "create_file" | "update_file" | "delete_file" | "read_file";

export interface ToolCall {
  type: ToolCallType;
  file_path: string;
  content?: string; // Required for create_file and update_file
}

export interface AIResponse {
  thinking?: string;
  tool_calls: ToolCall[];
}

export interface ToolCallResult {
  success: boolean;
  output?: string;
  error?: string;
}

