/** Vendor API tool declarations migrated from Jingwork connector adapters. */
export const CONNECTOR_TOOL_SCHEMAS: Record<
  string,
  { name: string; description: string; inputSchema: import('zod').core.JSONSchema.JSONSchema }[]
> = {
  'tencent-ima': [
    {
      name: 'list_notebooks',
      description: 'List IMA notebooks (folders). First page uses cursor "0".',
      inputSchema: {
        type: 'object',
        properties: {
          cursor: {
            type: 'string',
            description: 'Pagination cursor; use "0" for the first page',
          },
          limit: {
            type: 'integer',
            description: 'Max results per page (1-20), default 20',
          },
        },
      },
    },
    {
      name: 'list_notes',
      description: 'List recent IMA notes (no search keyword required)',
      inputSchema: {
        type: 'object',
        properties: {
          folder_id: {
            type: 'string',
            description: 'Optional notebook ID; omit to list across all notebooks',
          },
          cursor: {
            type: 'string',
            description: 'Pagination cursor; use "" for the first page',
          },
          limit: {
            type: 'integer',
            description: 'Max results per page (1-20), default 20',
          },
        },
      },
    },
    {
      name: 'get_note',
      description: 'Read IMA note content as plaintext by note_id',
      inputSchema: {
        type: 'object',
        properties: {
          note_id: {
            type: 'string',
            description: 'Note ID',
            minLength: 1,
          },
        },
        required: ['note_id'],
      },
    },
    {
      name: 'search_notes',
      description: 'Search notes by title (search_type=0) or body content (search_type=1)',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Search keyword',
            minLength: 1,
          },
          search_type: {
            type: 'integer',
            description: '0=title (default), 1=content',
          },
          start: {
            type: 'integer',
            description: 'Start offset, default 0',
          },
          end: {
            type: 'integer',
            description: 'End offset, default 20',
          },
        },
        required: ['query'],
      },
    },
    {
      name: 'create_note',
      description: 'Create a new IMA note from Markdown content',
      inputSchema: {
        type: 'object',
        properties: {
          content: {
            type: 'string',
            description: 'Markdown body (required, non-empty)',
            minLength: 1,
          },
          folder_id: {
            type: 'string',
            description: 'Optional notebook ID',
          },
        },
        required: ['content'],
      },
    },
    {
      name: 'append_note',
      description:
        'Append Markdown to an existing note. Requires an explicit note_id; do not guess the target note.',
      inputSchema: {
        type: 'object',
        properties: {
          note_id: {
            type: 'string',
            description: 'Target note ID',
            minLength: 1,
          },
          content: {
            type: 'string',
            description: 'Markdown to append (required, non-empty)',
            minLength: 1,
          },
        },
        required: ['note_id', 'content'],
      },
    },
    {
      name: 'list_knowledge_bases',
      description: 'List or search IMA knowledge bases. Empty query lists all bases.',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Name keyword; omit or "" to list all',
          },
          cursor: {
            type: 'string',
            description: 'Pagination cursor; use "" for the first page',
          },
          limit: {
            type: 'integer',
            description: 'Max results (1-20), default 20',
          },
        },
      },
    },
    {
      name: 'list_addable_knowledge_bases',
      description: 'List knowledge bases the user can add content to (when the target KB is unspecified)',
      inputSchema: {
        type: 'object',
        properties: {
          cursor: {
            type: 'string',
            description: 'Pagination cursor; use "" for the first page',
          },
          limit: {
            type: 'integer',
            description: 'Max results (1-50), default 20',
          },
        },
      },
    },
    {
      name: 'get_knowledge_base',
      description: 'Get knowledge base details by IDs (1-20)',
      inputSchema: {
        type: 'object',
        properties: {
          ids: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: 'Knowledge base IDs',
          },
        },
        required: ['ids'],
      },
    },
    {
      name: 'list_knowledge',
      description: 'List contents (files/folders) inside a knowledge base',
      inputSchema: {
        type: 'object',
        properties: {
          knowledge_base_id: {
            type: 'string',
            minLength: 1,
          },
          folder_id: {
            type: 'string',
            description: 'Optional folder ID; omit for root',
          },
          cursor: {
            type: 'string',
            description: 'Pagination cursor; use "" for the first page',
          },
          limit: {
            type: 'integer',
            description: 'Max results (1-50), default 20',
          },
        },
        required: ['knowledge_base_id'],
      },
    },
    {
      name: 'search_knowledge',
      description: 'Search content inside a knowledge base (requires knowledge_base_id)',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            minLength: 1,
          },
          knowledge_base_id: {
            type: 'string',
            minLength: 1,
          },
          cursor: {
            type: 'string',
            description: 'Pagination cursor; use "" for the first page',
          },
        },
        required: ['query', 'knowledge_base_id'],
      },
    },
    {
      name: 'import_urls',
      description:
        'Import web or WeChat article URLs into a knowledge base (1-10 URLs). Root folder_id defaults to knowledge_base_id.',
      inputSchema: {
        type: 'object',
        properties: {
          knowledge_base_id: {
            type: 'string',
            minLength: 1,
          },
          urls: {
            type: 'array',
            items: {
              type: 'string',
            },
            description: '1-10 http(s) URLs',
          },
          folder_id: {
            type: 'string',
            description: 'Optional folder; omit to use knowledge_base_id (root)',
          },
        },
        required: ['knowledge_base_id', 'urls'],
      },
    },
    {
      name: 'add_note_to_knowledge',
      description: 'Attach an existing IMA note to a knowledge base (media_type=11)',
      inputSchema: {
        type: 'object',
        properties: {
          knowledge_base_id: {
            type: 'string',
            minLength: 1,
          },
          note_id: {
            type: 'string',
            minLength: 1,
          },
          title: {
            type: 'string',
            minLength: 1,
          },
          folder_id: {
            type: 'string',
            description: 'Optional folder ID',
          },
        },
        required: ['knowledge_base_id', 'note_id', 'title'],
      },
    },
    {
      name: 'get_media',
      description: 'Get knowledge-base media info (file/web links) by media_id',
      inputSchema: {
        type: 'object',
        properties: {
          media_id: {
            type: 'string',
            minLength: 1,
          },
        },
        required: ['media_id'],
      },
    },
  ],
  'tencent-news': [
    {
      name: 'search_news',
      description: 'Search Tencent News articles by keyword',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            minLength: 1,
          },
          limit: {
            type: 'integer',
            description: 'Max results, default 10',
          },
          max_results: {
            type: 'integer',
            description: 'Alias of limit, default 10',
          },
        },
        required: ['query'],
      },
    },
  ],
  'wechat-reading': [
    {
      name: 'list_bookshelf',
      description: 'List books on WeRead shelf',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_book_notes',
      description: 'Get highlights/notes for a book by bookId',
      inputSchema: {
        type: 'object',
        properties: {
          book_id: {
            type: 'string',
            minLength: 1,
          },
        },
        required: ['book_id'],
      },
    },
  ],
  'qq-music': [
    {
      name: 'search_music',
      description: 'Search QQ Music for songs, albums, playlists, singers, MVs',
      inputSchema: {
        type: 'object',
        properties: {
          keyword: {
            type: 'string',
            description: 'Search keyword',
            minLength: 1,
          },
          type: {
            type: 'string',
            description: 'Search type, default 0 (songs)',
          },
        },
        required: ['keyword'],
      },
    },
    {
      name: 'list_charts',
      description: 'List QQ Music charts / toplists',
      inputSchema: {
        type: 'object',
        properties: {},
      },
    },
    {
      name: 'get_chart_detail',
      description: 'Get songs on a chart by topId',
      inputSchema: {
        type: 'object',
        properties: {
          top_id: {
            type: 'integer',
            description: 'Chart topId',
          },
        },
        required: ['top_id'],
      },
    },
    {
      name: 'get_playlist_detail',
      description: 'Get playlist songs by dissId',
      inputSchema: {
        type: 'object',
        properties: {
          diss_id: {
            type: 'integer',
            description: 'Playlist dissId',
          },
        },
        required: ['diss_id'],
      },
    },
    {
      name: 'listening_report',
      description: "Get the user's QQ Music listening report (day / week / month)",
      inputSchema: {
        type: 'object',
        properties: {
          type: {
            type: 'string',
            description: 'Report range hint, e.g. day / week / month',
          },
        },
      },
    },
  ],
  'qq-mail': [
    {
      name: 'search_emails',
      description: 'Search recent emails in INBOX (IMAP)',
      inputSchema: {
        type: 'object',
        properties: {
          query: {
            type: 'string',
            description: 'Text to search in message bodies; ALL returns all messages',
          },
          limit: {
            type: 'integer',
            description: 'Max messages, default 10',
          },
        },
      },
    },
    {
      name: 'read_email',
      description: 'Read a single email body by UID',
      inputSchema: {
        type: 'object',
        properties: {
          uid: {
            type: 'string',
            description: 'IMAP UID',
            minLength: 1,
          },
        },
        required: ['uid'],
      },
    },
    {
      name: 'send_email',
      description: 'Send a plain-text email via SMTP',
      inputSchema: {
        type: 'object',
        properties: {
          to: {
            type: 'string',
            minLength: 1,
          },
          subject: {
            type: 'string',
            minLength: 1,
          },
          body: {
            type: 'string',
            minLength: 1,
          },
        },
        required: ['to', 'subject', 'body'],
      },
    },
  ],
}
