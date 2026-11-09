import { apiGet, buildQuery } from './base'
export const runtimeLogApi = {
  list: (filters) => apiGet(`/api/system/runtime-logs?${buildQuery(filters)}`)
}
