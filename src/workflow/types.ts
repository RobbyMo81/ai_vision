/**
 * Workflow definition schema.
 *
 * A WorkflowDefinition is a named, reusable automation script with typed
 * parameters and ordered steps.  Steps are engine-agnostic — the workflow
 * engine's router picks the right browser automation engine per step.
 *
 * Parameter substitution:  any string value in a step can contain {{param_name}}
 * placeholders which are replaced with the caller-supplied params at runtime.
 *
 * Example (credit card dispute):
 *
 *   {
 *     id: 'dispute_charge',
 *     name: 'Credit Card Charge Dispute',
 *     params: {
 *       portal_url: { type: 'string' },
 *       charge_amount: { type: 'string' },
 *       dispute_reason: { type: 'string' },
 *     },
 *     steps: [
 *       { id: 'go', type: 'navigate', url: '{{portal_url}}' },
 *       { id: 'login', type: 'human_takeover', reason: 'Please log in to your account' },
 *       { id: 'dispute', type: 'agent_task',
 *         prompt: 'Find the charge for {{charge_amount}} and dispute it. Reason: {{dispute_reason}}' },
 *       { id: 'confirm', type: 'extract',
 *         instruction: 'Extract the dispute confirmation number',
 *         outputKey: 'confirmation_number' },
 *       { id: 'shot', type: 'screenshot' },
 *     ]
 *   }
 */

import { z } from 'zod';
import { EngineId } from '../engines/interface';

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
  /** CSS/XPath selector OR natural language description of the element */
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
  outputKey: z.string().optional(), // key in workflow result to store path
});

export const ExtractStepSchema = z.object({
  type: z.literal('extract'),
  id: z.string(),
  description: z.string().optional(),
  /** Natural language instruction describing what to extract */
  instruction: z.string(),
  /** Key in the workflow result outputs map to store extracted value */
  outputKey: z.string(),
});

export const AgentTaskStepSchema = z.object({
  type: z.literal('agent_task'),
  id: z.string(),
  description: z.string().optional(),
  /** Natural language task prompt — may include {{param}} substitutions */
  prompt: z.string(),
  /**
   * Engine override.  'auto' (default) lets the router pick based on heuristics:
   *   - Long exploratory tasks          → browser-use (agent loop)
   *   - Precision UI interactions       → stagehand (page.act)
   *   - SOP / structured processes      → skyvern (workflow)
   */
  engine: z.enum(['auto', 'browser-use', 'stagehand', 'skyvern']).optional(),
});

export const HumanTakeoverStepSchema = z.object({
  type: z.literal('human_takeover'),
  id: z.string(),
  /** Message shown prominently in the HITL UI */
  reason: z.string(),
  /** Additional guidance shown below the reason */
  instructions: z.string().optional(),
});

export const ConditionalStepSchema = z.object({
  type: z.literal('conditional'),
  id: z.string(),
  description: z.string().optional(),
  /**
   * Natural language condition evaluated against the current page state.
   * e.g. "Is the user logged in?" — evaluated by Stagehand page.extract()
   */
  condition: z.string(),
  /** Steps to run if condition is true */
  ifTrue: z.array(z.lazy(() => WorkflowStepSchema)),
  /** Steps to run if condition is false (optional) */
  ifFalse: z.array(z.lazy(() => WorkflowStepSchema)).optional(),
});

export const WorkflowStepSchema: z.ZodType<WorkflowStep> = z.discriminatedUnion('type', [
  NavigateStepSchema,
  ClickStepSchema,
  TypeStepSchema,
  ScreenshotStepSchema,
  ExtractStepSchema,
  AgentTaskStepSchema,
  HumanTakeoverStepSchema,
  ConditionalStepSchema,
]);

// ---------------------------------------------------------------------------
// Param schema
// ---------------------------------------------------------------------------

export const ParamDefinitionSchema = z.object({
  type: z.enum(['string', 'number', 'boolean']),
  description: z.string().optional(),
  required: z.boolean().optional().default(true),
  default: z.unknown().optional(),
});

// ---------------------------------------------------------------------------
// Workflow definition
// ---------------------------------------------------------------------------

export const WorkflowDefinitionSchema = z.object({
  /** Unique identifier used to look up the workflow by name */
  id: z.string(),
  name: z.string(),
  description: z.string().optional(),
  /** Declared parameters — validated before execution starts */
  params: z.record(ParamDefinitionSchema).optional().default({}),
  steps: z.array(WorkflowStepSchema),
});

// ---------------------------------------------------------------------------
// TypeScript types (inferred from schemas)
// ---------------------------------------------------------------------------

export type NavigateStep = z.infer<typeof NavigateStepSchema>;
export type ClickStep = z.infer<typeof ClickStepSchema>;
export type TypeStep = z.infer<typeof TypeStepSchema>;
export type ScreenshotStep = z.infer<typeof ScreenshotStepSchema>;
export type ExtractStep = z.infer<typeof ExtractStepSchema>;
export type AgentTaskStep = z.infer<typeof AgentTaskStepSchema>;
export type HumanTakeoverStep = z.infer<typeof HumanTakeoverStepSchema>;
export type ConditionalStep = z.infer<typeof ConditionalStepSchema>;

export type WorkflowStep =
  | NavigateStep
  | ClickStep
  | TypeStep
  | ScreenshotStep
  | ExtractStep
  | AgentTaskStep
  | HumanTakeoverStep
  | ConditionalStep;

export type ParamDefinition = z.infer<typeof ParamDefinitionSchema>;
export type WorkflowDefinition = z.infer<typeof WorkflowDefinitionSchema>;

// ---------------------------------------------------------------------------
// Workflow result
// ---------------------------------------------------------------------------

export interface StepResult {
  stepId: string;
  success: boolean;
  durationMs: number;
  /** Extracted values from 'extract' steps */
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

/**
 * Registry of built-in workflow templates.
 * Users can also pass inline WorkflowDefinitions to run_workflow.
 */
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
        instruction: 'Extract the dispute case number or confirmation number from the page. Also extract the estimated resolution timeframe if visible.',
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
      login_instructions: { type: 'string', description: 'Instructions to show the user during login', required: false, default: 'Please log in and click Return Control when ready.' },
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
