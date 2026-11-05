/** Bundled Jingwork connector metadata. Secrets live in the DSH credential store. */
export const CONNECTOR_CATALOG = [
  {
    kind: 'tencent-docs',
    nameKey: 'connectorTencentDocs',
    descriptionKey: 'connectorTencentDocsDescription',
    category: 'office',
    authorizationUrl: 'https://docs.qq.com/open/auth/mcp.html',
    fields: ['token'],
  },
  {
    kind: 'tencent-ima',
    nameKey: 'connectorTencentIma',
    descriptionKey: 'connectorTencentImaDescription',
    category: 'knowledge',
    authorizationUrl: 'https://ima.qq.com/agent-interface',
    fields: ['api_key', 'client_id'],
  },
  {
    kind: 'tencent-meeting',
    nameKey: 'connectorTencentMeeting',
    descriptionKey: 'connectorTencentMeetingDescription',
    category: 'office',
    authorizationUrl: 'https://meeting.tencent.com/ai-skill.html',
    fields: ['token'],
  },
  {
    kind: 'tencent-news',
    nameKey: 'connectorTencentNews',
    descriptionKey: 'connectorTencentNewsDescription',
    category: 'media',
    authorizationUrl: 'https://news.qq.com/exchange?scene=appkey',
    fields: ['api_key'],
  },
  {
    kind: 'wechat-reading',
    nameKey: 'connectorWechatReading',
    descriptionKey: 'connectorWechatReadingDescription',
    category: 'media',
    authorizationUrl: 'https://weread.qq.com/r/weread-skills',
    fields: ['api_key'],
  },
  {
    kind: 'tencent-lexiang',
    nameKey: 'connectorTencentLexiang',
    descriptionKey: 'connectorTencentLexiangDescription',
    category: 'office',
    authorizationUrl: 'https://lexiangla.com/ai/claw',
    fields: ['api_key', 'client_id'],
  },
  {
    kind: 'tencent-weiyun',
    nameKey: 'connectorTencentWeiyun',
    descriptionKey: 'connectorTencentWeiyunDescription',
    category: 'office',
    authorizationUrl: 'https://www.weiyun.com/act/openclaw',
    fields: ['token'],
  },
  {
    kind: 'qq-mail',
    nameKey: 'connectorMail',
    descriptionKey: 'connectorMailDescription',
    category: 'productivity',
    authorizationUrl: 'https://mail.qq.com/',
    fields: ['email', 'password', 'imap_host', 'imap_port', 'smtp_host', 'smtp_port'],
  },
  {
    kind: 'qq-music',
    nameKey: 'connectorQqMusic',
    descriptionKey: 'connectorQqMusicDescription',
    category: 'media',
    authorizationUrl: 'https://y.qq.com/n/ryqq_v2/qqmusic_skills',
    fields: ['api_key'],
  },
] as const
/** Supported connector identity from the bundled catalog. */
export type BuiltinConnectorKind = (typeof CONNECTOR_CATALOG)[number]['kind']
/** Resolve a configured built-in without accepting arbitrary adapter names.
 * @param kind Persisted catalog key.
 * @returns The matching definition, or undefined for custom MCP servers.
 */
export function builtinConnector(kind: string | undefined): (typeof CONNECTOR_CATALOG)[number] | undefined {
  return CONNECTOR_CATALOG.find(entry => entry.kind === kind)
}
/** Stable credential-store reference for one configured connector.
 * @param slug Workbench configuration key.
 * @returns An environment-compatible credential reference.
 */
export function connectorCredentialRef(slug: string): string {
  return `DSH_CONNECTOR_${Array.from(slug, char => char.charCodeAt(0).toString(16))
    .join('')
    .toUpperCase()}`
}
