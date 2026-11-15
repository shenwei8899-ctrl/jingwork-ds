# CVM Doctor — AI System Diagnosis and Repair Skill

English | [中文](README.zh.md)

> A structured Markdown knowledge system that gives AI agents professional system diagnosis and repair capabilities.
> Supports Linux / macOS / Windows, covers 60+ scenarios, and includes 126 concrete operation commands.

## What It Is

CVM Doctor is an **AI Agent Skill**, not a traditional script or program. It uses Markdown files organized in layers and modules to guide an AI agent through:

1. **Quick triage** (Quick, ~3 seconds) — scan component status and report OK / WARNING / CRITICAL
2. **Deep diagnosis** (Deep, 20–60 seconds) — analyze root causes for abnormal components
3. **Safe repair** — recommend a repair plan and **require user confirmation before execution**

## Core Design

### Two-stage Quick/Deep Architecture

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

### Three-tier Scenario Matching

```
Tier 1: 10 core scenarios in SKILL.md       → covers 80% of common issues
  ↓ no match
Tier 2: references/00-scenario-index.md    → 60+ scenarios in 20 categories
  ↓ repair needed
Tier 3: commands/*.md                      → 126 concrete operation commands
```

### Cross-platform Support

Every diagnostic workflow and command has a **Linux / macOS / Windows** comparison so the same diagnostic method can run on each operating system. The AI agent selects commands based on the current system.

## Project Structure

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

## Scenario Coverage

| Category | Example scenarios | Priority |
|------|---------|--------|
| **Performance issues** | Slow/frozen system, high CPU, low memory, slow disk I/O, slow network | High |
| **Health checks** | Full system check, regular maintenance | High |
| **Error investigation** | Crashes/restarts, service failures, error logs | High |
| **Hardware diagnosis** | Disk failure, overheating, GPU issues, RAID | High |
| **Time synchronization** | NTP offset, inaccurate clock | High |
| **Network** | LAN connection, firewall, SSH | Medium |
| **Security** | Security audit, permission issues, antivirus | Medium |
| **Development environment** | Docker, Python/conda, Node.js, SDK | Medium |
| **Configuration** | Git, SSH, PATH, Bash | Medium |
| **Display/desktop** | Multiple displays, KDE Plasma, audio, Bluetooth | Low |
| **Advanced storage** | NFS/SMB mounts, BTRFS snapshots | Low |
| **Local AI** | Ollama, ComfyUI, MCP, speech recognition | Low |

## How to Use

### Prerequisites

- **Linux/macOS**: `bash` and `ps`
- **Windows**: PowerShell 5.1+
- Supported systems: Linux (full), macOS (full), Windows (full)

### Use as an AI Agent Skill

CVM Doctor is designed for direct use by AI agents such as WorkBuddy and Claude Code:

1. **Install the Skill**: configure the `cvm-ai-doctor/` directory as an agent Skill directory
2. **Start a diagnosis**: describe the issue in natural language, for example:
   - "The server is slow. Please investigate."
   - "CPU is at 100%; why?"
   - "Run a full system health check."
   - "The disk reported an error. How do I check SMART?"
3. **Automatic diagnosis**: the agent loads SKILL.md → matches a scenario → runs Quick triage → performs Deep root-cause analysis → recommends a repair
4. **Safety gate**: the agent executes repair operations only after user confirmation

### Extend Scenarios

Add a `.md` file to extend the scenario library:

1. Add a Quick/Deep diagnostic module under `references/`
2. Add a repair command file under `commands/`
3. Register the scenario in `references/00-scenario-index.md`

## Remote Diagnosis

The Skill's knowledge can be transferred. Use tools such as SSH and SCP to extend diagnosis to a remote server:

```bash
# Copy the Skill to the remote host
scp -r cvm-ai-doctor/ user@remote:/tmp/

# Connect over SSH, then let the AI agent diagnose the remote system using the local Skill
ssh user@remote
# Agent: "Check system health" → use /tmp/cvm-ai-doctor/SKILL.md to diagnose the remote machine
```

A Skill ConfigMap can also be mounted in a Kubernetes environment for batch diagnosis at the container level.

## Documentation

- [Architecture](docs/architecture.md) — modular design, Quick/Deep architecture, and cross-platform approach
- [Scenario decision guide](docs/scenario-decision-guide.md) — complete workflows for 60+ scenarios
- [Scenario index maintenance](docs/scenario-index-maintenance.md) — maintaining and extending the scenario library

## Version Information

- **Current version**: v1.1
- **Coverage**: 20 categories, 60+ scenarios, 126 operation commands
- **Runtime dependencies**: bash / PowerShell
- **Platform support**: Linux (full) / macOS (full) / Windows (full)

**Recent updates** (2026-03-27):
- ✅ Added a Windows PowerShell quick diagnostic script (`scripts/quick_scan.ps1`)
- ✅ Added the Skill collaboration guide (`references/skill-collaboration.md`)
- ✅ Improved Quick Mode performance from 10s to 3s by using scripts instead of independent commands
- ✅ Added a public API specification (`API.md`) for cross-Skill references
