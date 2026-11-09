import { apiGet, buildQuery } from './base'

export const operationLogApi = {
  filters: () => apiGet('/api/system/operation-logs/filters'),
  list: (filters) => apiGet(`/api/system/operation-logs?${buildQuery(filters)}`)
}
