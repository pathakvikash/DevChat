"use client";

import { createContext, useContext } from "react";

export interface ApprovalAnswer {
  approvalId: string;
  toolName: string;
  approved: boolean;
  /** Allow this tool for the rest of this chat (only with approved). */
  allowForChat?: boolean;
}

export interface PlanAnswer {
  toolCallId: string;
  approve: boolean;
  /** Mode the plan runs in once approved. */
  mode?: "ask" | "agent";
  feedback?: string;
}

export interface ToolAnswers {
  answerApproval: (answer: ApprovalAnswer) => void;
  answerPlan: (answer: PlanAnswer) => void;
}

/** Lets the approval and plan cards answer without threading callbacks through every message. */
const ToolAnswersContext = createContext<ToolAnswers | null>(null);

export const ToolAnswersProvider = ToolAnswersContext.Provider;

export function useToolAnswers(): ToolAnswers | null {
  return useContext(ToolAnswersContext);
}
