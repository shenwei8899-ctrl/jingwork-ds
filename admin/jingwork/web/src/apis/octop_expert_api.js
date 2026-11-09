import { apiGet, apiPost } from './base'

export const octopExpertApi = {
  personal: () => apiGet('/api/octop/experts/personal/catalog'),
  prepareSkills: (id) =>
    apiPost(`/api/octop/experts/market/${encodeURIComponent(id)}/skill-drafts`, {}),
  list: (source) => apiGet(`/api/octop/experts/${source}`),
  detail: (source, id) => apiGet(`/api/octop/experts/${source}/${encodeURIComponent(id)}`),
  create: (source, id, body) =>
    apiPost(`/api/octop/experts/${source}/${encodeURIComponent(id)}/import`, body)
}
