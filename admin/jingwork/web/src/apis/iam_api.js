import { apiAdminGet, apiGet, apiPost, buildQuery } from './base'

/** 企业 IAM 的公开配置、会话和只读目录请求。 */
export const iamApi = {
  config: () => apiGet('/api/auth/iam/config', {}, false),
  session: () => apiGet('/api/auth/iam/session', {}, false),
  logout: () => apiPost('/api/auth/iam/logout', {}, {}, false),
  directory: (resource, { page, size, signal }) =>
    apiAdminGet(`/api/auth/iam/directory/${resource}?${buildQuery({ page, size })}`, { signal }),
  tenant: () => apiAdminGet('/api/auth/iam/tenant')
}
