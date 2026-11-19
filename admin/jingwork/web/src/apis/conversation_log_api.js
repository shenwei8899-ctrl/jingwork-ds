import { apiGet, buildQuery } from './base'

export const conversationLogApi = {
  overview: () => apiGet('/api/system/conversation-logs/overview'),
  catalog: () => apiGet('/api/system/conversation-logs/catalog'),
  sessions: (filters) => apiGet('/api/system/conversation-logs/sessions?' + buildQuery(filters)),
  messages: (filters) => apiGet('/api/system/conversation-logs/messages?' + buildQuery(filters)),
  files: (filters) => apiGet('/api/system/conversation-logs/files?' + buildQuery(filters)),
  downloadFile: async (id) => {
    const response = await apiGet(
      `/api/system/conversation-logs/files/${encodeURIComponent(id)}/download`,
      {},
      true,
      'blob'
    )
    return response.blob()
  }
}
