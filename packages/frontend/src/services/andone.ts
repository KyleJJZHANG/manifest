import type { StageDef } from './providers.js';

/**
 * Reserved header key for AndONE harness routing. Each harness "mode" the
 * AndONE/BrowserOS client runs in (chat, agent, frozen workflow, …) sends
 * `x-hycore-mode: <stage>`; an AndONE-Specific tier with this key + value
 * force-routes that mode to its own model. Backed by the header-tier engine,
 * so resolution is unchanged — this is just a curated header_key.
 */
export const ANDONE_HEADER_KEY = 'x-hycore-mode';

/**
 * Built-in AndONE harness stages, always shown so a fresh agent can wire a
 * model per mode in one click. Adding a new harness adds a stage (any
 * lowercase header value the client sends).
 */
export const ANDONE_STAGES: StageDef[] = [
  { id: 'chat', step: 1, label: 'Chat', desc: 'Interactive chat-mode requests.' },
  { id: 'agent', step: 2, label: 'Agent', desc: 'Autonomous agent-mode runs.' },
  {
    id: 'workflow_frozen',
    step: 3,
    label: 'Workflow (frozen)',
    desc: 'Frozen / compiled workflow LLM passes.',
  },
];
