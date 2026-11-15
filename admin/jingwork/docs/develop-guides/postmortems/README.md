# Engineering Postmortems

English | [中文](README.zh.md)

Use a postmortem only for an escaped defect with high impact, systemic reach, or high rediscovery cost. Ordinary bugs, issues found promptly by development tests, and local errors without user, data, security, or availability impact do not require one; they still need regression evidence proportional to risk.

A fix owner and reviewer decide whether an incident meets the bar if it has any of these conditions:

- It creates risk to security, authorization, data integrity, data loss, or external side effects.
- It significantly affects a critical user flow or production availability.
- The same mechanism can cause repeated failures across multiple modules, entry points, or deployments.
- Existing tests, gates, or review all passed while a high-value defect escaped, and the cause is not obvious or would be costly to rediscover.

A postmortem turns an escaped incident into an earlier and clearer future failure. It does not assign blame or preserve reasoning transcripts. Each postmortem must name a real owner, link the fix or decision, retain a verifiable timeline and causal chain, describe how safeguards failed, provide a reproducer and direct oracle, list the gates actually run, and state unresolved risks. A checklist, training reminder, or request to “improve review” cannot close a postmortem by itself.

Use [TEMPLATE.md](./TEMPLATE.md) to create `YYYY-MM-DD-topic.md`. When later facts supersede a postmortem, preserve its history and link the current owner; do not rewrite an incident record as a current operating contract.
