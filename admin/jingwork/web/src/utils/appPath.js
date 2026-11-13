/** 将同源根路径映射到当前应用前缀，外部 URL 保持原值。 */
export function appPath(path, base = import.meta.env?.BASE_URL || '/') {
  if (typeof path !== 'string' || !path.startsWith('/') || path.startsWith('//')) return path
  if (base === '/' || path.startsWith(base)) return path
  return base.replace(/\/$/, '') + path
}

/** 按应用前缀隔离同一平台域名上的登录标记。 */
export const userTokenKey = (import.meta.env?.BASE_URL || '/') === '/'
  ? 'user_token'
  : `jingwork:${import.meta.env.BASE_URL}:user_token`
