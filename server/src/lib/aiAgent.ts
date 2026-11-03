// The id of the "AI" system user, created by migrations/20261103120000_add_ai_agent. New tickets
// are assigned to it while the AI tries to answer them; it authors the AI's replies, and is
// unassigned when it hands a ticket to the agents. It has no password, so it can't sign in, and
// it's left out of the Users page and the assignee picker.
export const AI_AGENT_ID = "ai-agent";
