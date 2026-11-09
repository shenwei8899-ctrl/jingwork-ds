import { apiGet, apiPut, apiPost } from './base'
const root = '/api/model-credits'
export const modelCreditApi = {
  admin: () => apiGet(`${root}/admin`),
  policy: (scope, data) => apiPut(`${root}/policies/${encodeURIComponent(scope)}`, data),
  relayModels: (data) => apiPut(`${root}/relay/models`, data),
  relay: () => apiGet(`${root}/relay`),
  connect: (data) => apiPut(`${root}/relay`, data),
  relayUsers: () => apiGet(`${root}/relay/users`),
  relayKeys: (id) => apiGet(`${root}/relay/users/${id}/keys`),
  bind: (uid, data) => apiPut(`${root}/relay/members/${encodeURIComponent(uid)}`, data),
  settle: (id, data) => apiPost(`${root}/admin/calls/${id}/settle`, data)
}
