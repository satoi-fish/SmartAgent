export const READ_ONLY_TOOL_NAMES = [
  "search_project_docs",
  "search_knowledge_base",
  "search_long_term_memory",
  "list_workspace_files",
  "read_workspace_file",
  "inspect_local_web_page",
  "browser_open_local_page",
  "browser_snapshot_local_page",
  "browser_close_local_session",
] as const;

export const APPROVABLE_TOOL_NAMES = [
  "remember_project_fact",
  "forget_project_memory",
  "browser_click_local_element",
  "browser_type_local_element",
  "browser_screenshot_local_page",
  "run_workspace_command",
  "draft_action_item",
] as const;

export const ALL_TOOL_NAMES = [...READ_ONLY_TOOL_NAMES, ...APPROVABLE_TOOL_NAMES] as const;

export type ToolName = (typeof ALL_TOOL_NAMES)[number];
export type ApprovableToolName = (typeof APPROVABLE_TOOL_NAMES)[number];

const READ_ONLY_TOOL_NAME_SET = new Set<string>(READ_ONLY_TOOL_NAMES);
const APPROVABLE_TOOL_NAME_SET = new Set<string>(APPROVABLE_TOOL_NAMES);

export function isReadOnlyToolName(toolName: string): boolean {
  return READ_ONLY_TOOL_NAME_SET.has(toolName);
}

export function isApprovableToolName(toolName: string): toolName is ApprovableToolName {
  return APPROVABLE_TOOL_NAME_SET.has(toolName);
}
