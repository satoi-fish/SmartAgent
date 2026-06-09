export const READ_ONLY_TOOL_NAMES = [
  "search_project_docs",
  "search_knowledge_base",
  "search_long_term_memory",
  "query_seq_logs",
  "list_knowledge_entries",
  "query_git_repository",
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
  "upsert_knowledge_entry",
  "delete_knowledge_entry",
  "stage_git_changes",
  "create_git_commit",
  "browser_click_local_element",
  "browser_type_local_element",
  "browser_screenshot_local_page",
  "run_workspace_command",
  "install_workspace_dependencies",
  "run_workspace_tests",
  "write_workspace_file",
  "apply_workspace_patch",
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
