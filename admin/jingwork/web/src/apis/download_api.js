export async function isReleaseAvailable(release, { signal, fetcher = fetch } = {}) {
  if (!release.url || !Number.isSafeInteger(release.bytes) || release.bytes <= 0) return false
  const response = await fetcher(release.url, { method: 'HEAD', cache: 'no-store', signal })
  return (
    response.ok &&
    !response.headers.get('content-type')?.includes('text/html') &&
    Number(response.headers.get('content-length')) === release.bytes
  )
}
