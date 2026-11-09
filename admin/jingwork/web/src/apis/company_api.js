import { apiAdminGet, apiSuperAdminPut } from './base'
export const companyApi = {
  get: () => apiAdminGet('/api/system/company'),
  save: (body) => apiSuperAdminPut('/api/system/company', body)
}
