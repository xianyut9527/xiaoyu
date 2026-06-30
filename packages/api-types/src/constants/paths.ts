export const API_VERSION = '/api/v1' as const;
export const HEALTH_ENDPOINT = `${API_VERSION}/health` as const;
export const CONVERSATIONS_ENDPOINT = `${API_VERSION}/conversations` as const;
export const MESSAGES_ENDPOINT = (conversationId: string) =>
  `${CONVERSATIONS_ENDPOINT}/${conversationId}/messages` as const;
export const TEMPLATES_ENDPOINT = `${API_VERSION}/analysis/templates` as const;
export const ANALYSIS_ENDPOINT = `${API_VERSION}/analysis` as const;
