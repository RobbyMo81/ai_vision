/**
 * Workflow definition schema.
 *
 * A WorkflowDefinition is a named, reusable automation script with typed
 * parameters and ordered steps.  Steps are engine-agnostic — the workflow
 * engine's router picks the right browser automation engine per step.
 *
 * Parameter substitution: any string value in a step can contain {{param_name}}
 * placeholders which are replaced with the caller-supplied params at runtime.
 */

import { z } from 'zod';

// ---------------------------------------------------------------------------
// Step schemas
// ---------------------------------------------------------------------------

export const NavigateStepSchema = z.object({
  type: z.literal('navigate'),
  id: z.string(),
  description: z.string().optional(),
  url: z.string(),
  waitUntil: z.enum(['load', 'domcontentloaded', 'networkidle']).optional(),
});

export const ClickStepSchema = z.object({
  type: z.literal('click'),
  id: z.string(),
  description: z.string().optional(),
  selector: z.string(),
});

export const TypeStepSchema = z.object({
  type: z.literal('type'),
  id: z.string(),
  description: z.string().optional(),
  selector: z.string(),
  text: z.string(),
  clearFirst: z.boolean().optional(),
});

export const ScreenshotStepSchema = z.object({
  type: z.literal('screenshot'),
  id: z.string(),
  description: z.string().optional(),
  outputKey: z.string().optional(),
});

export const ExtractStepSchema = z.object({
  type: z.literal('extract'),
  id: z.string(),
  description: z.string().optional(),
  /** Natural language hint about what to extract (returned as context in the output) */
  instruction: z.string(),
  /** Key in the workflow result outputs map to store extracted value */
  outputKey: z.string(),
});

export const AgentTaskStepSchema = z.object({
  type: z.literal('agent_task'),
  id: z.string(),
  description: z.string().optional(),
  prompt: z.string(),
  /**
   * 'auto' (default) lets the router pick based on heuristics.
   * Override to force a specific engine.
   */
  engine: z.enum(['auto', 'browser-use', 'stagehand', 'skyvern']).optional(),
});

export const HumanTakeoverStepSchema = z.object({
  type: z.literal('human_takeover'),
  id: z.string(),
  reason: z.string(),
  instructions: z.string().optional(),
});

export const WorkflowStepSchema = z.discriminatedUnion('type', [
  NavigateStepSchema,
  ClickStepSchema,
  TypeStepSchema,
  ScreenshotStepSchema,
  ExtractStepSchema,
  AgentTaskStepSchema,
  HumanTakeoverStepSchema,
]);

// ---------------------------------------------------------------------------
// Param schema
// ---------------------------------------------------------------------------

export const ParamDefinitionSchema = z.object({
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string().optional(),
  /** If false, the param is optional (default: true) */
  required: z.boolean().optional(),
  default: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

export const WorkflowDefinitionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  params: z.record(ParamDefinitionSchema).optional().default({}),
  steps: z.array(WorkflowStepSchema),
});

// ---------------------------------------------------------------------------
// TypeScript types
// ---------------------------------------------------------------------------

export type NavigateStep = z.infer<typeof NavigateStepSchema>;
export type ClickStep = z.infer<typeof ClickStepSchema>;
export type TypeStep = z.infer<typeof TypeStepSchema>;
export type ScreenshotStep = z.infer<typeof ScreenshotStepSchema>;
export type ExtractStep = z.infer<typeof ExtractStepSchema>;
export type AgentTaskStep = z.infer<typeof AgentTaskStepSchema>;
export type HumanTakeoverStep = z.infer<typeof HumanTakeoverStepSchema>;

export type WorkflowStep = z.infer<typeof WorkflowStepSchema>;
export type ParamDefinition = z.infer<typeof ParamDefinitionSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ---------------------------------------------------------------------------
// Workflow result
// ---------------------------------------------------------------------------

export interface StepResult {
  stepId: string;
  success: boolean;
  durationMs: number;
  output?: string;
  screenshotPath?: string;
  screenshotBase64?: string;
  error?: string;
}

export interface WorkflowResult {
  workflowId: string;
  success: boolean;
  stepResults: StepResult[];
  /** Named outputs from extract steps, keyed by outputKey */
  outputs: Record<string, string>;
  /** All screenshots taken during the workflow */
  screenshots: Array<{ path: string; base64: string; stepId: string }>;
  durationMs: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// Built-in workflow templates
// ---------------------------------------------------------------------------

export const BUILTIN_WORKFLOWS: WorkflowDefinition[] = [
  {
    id: 'dispute_charge',
    name: 'Credit Card Charge Dispute',
    description: 'Navigate to a credit card portal, let the user authenticate, then autonomously find and dispute a charge.',
    params: {
      portal_url: { type: 'string', description: 'URL of the credit card portal login page' },
      charge_amount: { type: 'string', description: 'Amount of the charge to dispute (e.g. "$47.99")' },
      charge_date: { type: 'string', description: 'Date of the charge (e.g. "April 10, 2026")', required: false, default: '' },
      dispute_reason: { type: 'string', description: 'Reason for the dispute', required: false, default: 'Unauthorized charge' },
    },
    steps: [
      {
        type: 'navigate',
        id: 'open_portal',
        description: 'Navigate to the credit card portal',
        url: '{{portal_url}}',
        waitUntil: 'domcontentloaded',
      },
      {
        type: 'human_takeover',
        id: 'user_login',
        reason: 'Please log in to your credit card account',
        instructions: 'Once you are logged in and can see your account dashboard, click "Return Control to Claude" below.',
      },
      {
        type: 'agent_task',
        id: 'find_and_dispute',
        description: 'Find the charge and initiate dispute',
        prompt: 'Find the transaction for {{charge_amount}}{{charge_date}} and initiate a dispute. Reason for dispute: {{dispute_reason}}. Complete the dispute form and submit it.',
        engine: 'auto',
      },
      {
        type: 'extract',
        id: 'get_confirmation',
        description: 'Extract dispute confirmation details',
        instruction: 'Extract the dispute case number or confirmation number',
        outputKey: 'confirmation',
      },
      {
        type: 'screenshot',
        id: 'final_screenshot',
        description: 'Capture the dispute confirmation screen',
        outputKey: 'confirmation_screenshot',
      },
    ],
  },

  {
    id: 'authenticated_task',
    name: 'Authenticated Web Task',
    description: 'Generic pattern: navigate to any portal, let the user log in, then run an autonomous task with the authenticated session.',
    params: {
      url: { type: 'string', description: 'URL to navigate to' },
      task: { type: 'string', description: 'What to do after authentication' },
      login_instructions: { type: 'string', description: 'Instructions shown during login', required: false, default: 'Please log in and click Return Control when ready.' },
    },
    steps: [
      {
        type: 'navigate',
        id: 'navigate',
        url: '{{url}}',
        waitUntil: 'domcontentloaded',
      },
      {
        type: 'human_takeover',
        id: 'authenticate',
        reason: 'Authentication required',
        instructions: '{{login_instructions}}',
      },
      {
        type: 'agent_task',
        id: 'run_task',
        prompt: '{{task}}',
        engine: 'auto',
      },
      {
        type: 'screenshot',
        id: 'result_screenshot',
        description: 'Capture the final state',
      },
    ],
  },
];
