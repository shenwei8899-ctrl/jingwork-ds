# CVM Doctor — AI 智能系统诊断与修复 Skill

[English](README.md) | 中文

> 一套结构化的 Markdown 知识体系，让 AI Agent 具备专业级的系统诊断和修复能力。
> 支持 Linux / macOS / Windows，覆盖 60+ 场景，包含 126 个具体操作命令。

## 它是什么

CVM Doctor 是一个 **AI Agent Skill**（技能包），不是传统的脚本或程序。它以 Markdown 文件为载体,通过分层、模块化的知识组织方式,指导 AI Agent 完成:

1. **快速分诊**（Quick,~3 秒）— 扫描各组件状态,返回 OK / WARNING / CRITICAL
2. **深度诊断**（Deep,20-60 秒）— 对异常组件进行根因分析
3. **安全修复** — 推荐修复方案,**必须经用户确认后才执行**

## 核心设计

### Quick/Deep 两阶段架构

```
User: "The server is slow"
  │
  ▼
Quick Mode (3s) ──→ CPU OK / Memory WARNING / Disk OK / Network OK
  │
  ▼ (an issue is found)
Deep Mode (20s) ──→ Cause: Java process memory leak, using 8GB
  │
  ▼
Repair plan ──→ Restart Java service + tune JVM options (user confirmation required)
```

### 三层场景匹配

```
Tier 1: 10 core scenarios in SKILL.md       → covers 80% of common issues
  ↓ no match
Tier 2: references/00-scenario-index.md    → 60+ scenarios in 20 categories
  ↓ repair needed
Tier 3: commands/*.md                      → 126 concrete operation commands
```

### 跨平台支持

所有诊断流程和命令都提供 **Linux / macOS / Windows** 三平台对照表，确保同一诊断逻辑在不同操作系统上都能执行。AI Agent 会根据当前系统自动选择对应命令。

## 项目结构

```
cvm-ai-doctor/
├── SKILL.md                          # Entry point — always loaded by the AI agent
├── API.md                            # Public API — cross-Skill reference contract
│
├── scripts/                          # Quick diagnostic scripts — 3-second scan
│   ├── quick_scan.sh                 #   Linux/macOS quick check
│   ├── quick_scan.ps1                #   Windows quick check
│   └── README.md                     #   Script usage
│
├── references/                       # Diagnostic modules — loaded as needed
│   ├── 00-scenario-index.md          #   Scenario routing table (60+ scenarios)
│   ├── skill-collaboration.md        #   Skill collaboration guide
│   ├── resource-saturation-*.md      #   Resource diagnosis (Quick 1 + Deep 5)
│   ├── system-logs-*.md              #   Log diagnosis (Quick 1 + Deep 5)
│   ├── disk-smart-*.md               #   Disk SMART (Quick 1 + Deep 1)
│   ├── hardware-health-*.md          #   Hardware health (Quick 1 + Deep 1)
│   └── time-sync.md                  #   Time synchronization (Quick + Deep)
│
├── commands/                         # Operation library — loaded as needed for repairs
│   ├── debugging/                    #   Crash diagnosis, slow system investigation
│   ├── system-health/                #   System checks, service startup, upgrades
│   ├── network/                      #   LAN diagnosis, SSH
│   ├── security/                     #   Firewall, auditing, permissions
│   ├── hardware/                     #   CPU/GPU/RAM/motherboard profiling
│   ├── storage/                      #   Disk health, RAID, NFS/SMB
│   ├── installation/                 #   CLI/GUI tool installation
│   ├── dev-tools/                    #   Docker/Python/Node/SDK
│   └── ... (29 categories, 126 command files)
│
└── docs/                             # Developer documentation for maintainers
    ├── architecture.md               #   Architecture
    ├── scenario-decision-guide.md    #   Scenario decision guide
    └── scenario-index-maintenance.md #   Scenario index maintenance
```

## 覆盖场景

| 分类 | 场景示例 | 优先级 |
|------|---------|--------|
| **性能问题** | 系统慢/卡、CPU 高、内存不足、磁盘 I/O 慢、网络慢 | 高频 |
| **健康检查** | 综合体检、定期维护 | 高频 |
| **错误排查** | 崩溃/重启、服务失败、错误日志 | 高频 |
| **硬件诊断** | 磁盘故障、温度过高、GPU 问题、RAID | 高频 |
| **时间同步** | NTP 偏移、时钟不准 | 高频 |
| **网络** | LAN 连接、防火墙、SSH | 中频 |
| **安全** | 安全审计、权限问题、防病毒 | 中频 |
| **开发环境** | Docker、Python/conda、Node.js、SDK | 中频 |
| **配置** | Git、SSH、PATH、Bash | 中频 |
| **显示/桌面** | 多显示器、KDE Plasma、音频、蓝牙 | 低频 |
| **存储高级** | NFS/SMB 挂载、BTRFS 快照 | 低频 |
| **本地 AI** | Ollama、ComfyUI、MCP、语音识别 | 低频 |

## 使用方式

### 前置依赖

- **Linux/macOS**: `bash` 和 `ps`
- **Windows**: PowerShell 5.1+
- 支持系统: Linux (完整)、macOS (完整)、Windows (完整)

### 作为 AI Agent Skill 使用

CVM Doctor 的设计目标是让 AI Agent（如 WorkBuddy、Claude Code 等）直接使用：

1. **安装 Skill**：将 `cvm-ai-doctor/` 目录配置为 Agent 的 Skill 目录
2. **触发诊断**：用自然语言描述问题，例如：
   - "服务器很慢，帮我看看"
   - "CPU 100%，为什么"
   - "帮我做一次系统体检"
   - "磁盘报错了，SMART 怎么看"
3. **AI 自动执行**：Agent 加载 SKILL.md → 匹配场景 → Quick 分诊 → Deep 根因分析 → 推荐修复
4. **安全门控**：所有修复操作需用户确认后才执行

### 扩展场景

只需添加一个 `.md` 文件即可扩展新场景：

1. 在 `references/` 中添加 Quick/Deep 诊断模块
2. 在 `commands/` 中添加修复命令文件
3. 在 `references/00-scenario-index.md` 中注册新场景

## 远程诊断

Skill 的知识体系天然可传输。搭配 SSH、SCP 等工具，可以将诊断能力扩展到远程服务器：

```bash
# Copy the Skill to the remote host
scp -r cvm-ai-doctor/ user@remote:/tmp/

# Connect over SSH, then let the AI agent diagnose the remote system using the local Skill
ssh user@remote
# Agent: "Check system health" → use /tmp/cvm-ai-doctor/SKILL.md to diagnose the remote machine
```

也可以在 K8s 环境中通过 Pod 挂载 Skill ConfigMap，实现容器级别的批量诊断。

## 文档

- [架构设计](docs/architecture.md) — 模块化设计、Quick/Deep 架构、跨平台方案
- [场景决策指南](docs/scenario-decision-guide.md) — 60+ 场景的完整工作流
- [场景索引维护](docs/scenario-index-maintenance.md) — 如何维护和扩展场景库

## 版本信息

- **当前版本**: v1.1
- **覆盖范围**: 20 大类、60+ 细分场景、126 个操作命令
- **运行依赖**: bash / PowerShell
- **平台支持**: Linux (完整) / macOS (完整) / Windows (完整)

**最近更新** (2026-03-27):
- ✅ 新增 Windows PowerShell 快速诊断脚本 (`scripts/quick_scan.ps1`)
- ✅ 新增 Skill 协作指南 (`references/skill-collaboration.md`)
- ✅ Quick Mode 性能优化: 10s → 3s (使用 scripts 替代独立命令)
- ✅ 公开 API 规范 (`API.md`),支持跨 Skill 引用
