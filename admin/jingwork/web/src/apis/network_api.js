import { apiAdminGet, apiSuperAdminPut } from './base'
export const networkApi = {
  get: () => apiAdminGet('/api/system/network'),
  save: (allowed_ips) => apiSuperAdminPut('/api/system/network', { allowed_ips })
}
