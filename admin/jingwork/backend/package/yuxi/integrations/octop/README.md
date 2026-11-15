# Public Octop expert templates

English | [中文](README.zh.md)

This fixed snapshot comes from `src/octop/library` in the sibling Octop repository. See LICENSE for its license. The `default` template is excluded because it is the desktop default agent, not a public expert template.

The marketplace catalog and skill packages use Octop's public SkillHub API at runtime. Imports preserve prompts, Skill bodies, and resource files, and add only the slug metadata required by Yuxi. They do not copy desktop personal settings, model keys, or account credentials.
