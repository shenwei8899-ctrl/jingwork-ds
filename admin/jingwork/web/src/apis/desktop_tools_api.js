import { apiGet, apiPut } from './base'
const base = '/api/system/desktop-tools'
export const desktopToolsApi = {
  members: () => apiGet(`${base}/members`),
  read: (uid) => apiGet(`${base}/members/${encodeURIComponent(uid)}`),
  save: (uid, policy) => apiPut(`${base}/members/${encodeURIComponent(uid)}`, policy)
}
