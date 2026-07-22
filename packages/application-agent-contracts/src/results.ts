import { safeReasonCode } from './models/common';
export const applicationAgentFailureCodes = safeReasonCode.options;
export type ApplicationAgentFailureCode = (typeof applicationAgentFailureCodes)[number];
