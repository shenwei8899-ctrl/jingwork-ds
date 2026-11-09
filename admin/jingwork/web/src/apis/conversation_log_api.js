import { apiGet, buildQuery } from './base'

export const conversationLogApi = {
  catalog: () => apiGet('/api/system/conversation-logs/catalog'),
  sessions: (filters) => apiGet('/api/system/conversation-logs/sessions?' + buildQuery(filters)),
  messages: (filters) => apiGet('/api/system/conversation-logs/messages?' + buildQuery(filters))
}
