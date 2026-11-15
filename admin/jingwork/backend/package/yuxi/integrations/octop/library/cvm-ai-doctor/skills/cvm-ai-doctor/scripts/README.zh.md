# CVM Doctor 脚本

[English](README.md) | 中文

用于快速检查系统健康状况的可执行诊断脚本。

## 可用脚本

### `quick_scan.sh`

**用途**：快速检查 CPU、内存、磁盘和网络负载。

**平台**：Linux、macOS

**用法：**
```bash
bash scripts/quick_scan.sh
```

**耗时**：约 3 秒\
**输出**：结构化文本（每个组件为 OK/WARNING/CRITICAL）

---

### `quick_scan.ps1`

**用途**：快速检查 CPU、内存、磁盘和网络负载。

**Platforms**: Windows (PowerShell 5.1+)

**用法：**
```powershell
powershell -ExecutionPolicy Bypass -File scripts/quick_scan.ps1
```

**耗时**：约 3 秒\
**输出**：结构化文本（每个组件为 OK/WARNING/CRITICAL）

---

## 集群脚本（通过 TAT 远程执行）

这些脚本通过腾讯云自动化工具（TAT）在**远程 CVM 实例**上运行。
Agent 在本地 LightClaw 机器上编码脚本，并将其作为
`tccli tat RunCommand` 的 `--Content` 参数发送；远程 CVM 解码并运行脚本。

**编码方式（本地机器）：**
```bash
# Linux / macOS
CONTENT=$(base64 -w 0 < scripts/<script>.sh)
```
```powershell
# Windows PowerShell
$CONTENT = [Convert]::ToBase64String([IO.File]::ReadAllBytes("scripts\<script>.sh"))
```

---

### `cluster_os_snapshot.sh`

**用途**：为集群快速检查的第 2B 层收集每个节点的单行操作系统快照。\
**平台**：通过 TAT 运行于远程 CVM（Linux）\
**超时**：30 秒\
**输出**：`HOST=xxx LOAD=x.x NCPU=x MEM_MB=used/total DISK_ROOT_PCT=nn SSH=active`

---

### `cluster_deep_cpu.sh`

**用途**：深入诊断 CPU，包括主要占用进程、负载详情、cgroup 限流和 IO 等待。\
**平台**：通过 TAT 运行于远程 CVM（Linux）\
**超时**：60 秒\
**输出**：包含标题的结构化分节，供 LLM 解析

---

### `cluster_deep_memory.sh`

**用途**：深入诊断内存，包括主要占用进程、meminfo、OOM 历史和交换空间使用。\
**平台**：通过 TAT 运行于远程 CVM（Linux）\
**超时**：60 秒\
**输出**：包含标题的结构化分节，供 LLM 解析

---

### `cluster_deep_disk.sh`

**用途**：深入诊断磁盘，包括使用量、inode、大文件（≥500MB，受 30 秒超时限制）、IO 统计和 logrotate 状态。\
**平台**：通过 TAT 运行于远程 CVM（Linux）\
**超时**：90 秒\
**输出**：包含标题的结构化分节，供 LLM 解析

---

### `cluster_deep_ssh.sh`

**用途**：深入诊断 SSH，包括 sshd 服务状态、监听端口、近期日志、配置关键行和失败尝试。\
**平台**：通过 TAT 运行于远程 CVM（Linux）\
**超时**：30 秒\
**输出**：包含标题的结构化分节，供 LLM 解析

---

### `cluster_deep_network.sh`

**用途**：深入诊断网络，包括连接摘要、状态计数、主要远程主机、接口统计、错误和 DNS 解析测试。\
**平台**：通过 TAT 运行于远程 CVM（Linux）\
**超时**：30 秒\
**输出**：包含标题的结构化分节，供 LLM 解析

---

## 使用时机

**本地脚本**（`quick_scan.sh` / `quick_scan.ps1`）：
- 用户反馈“慢”/“卡”/“slow”/“系统检查”
- Quick Mode 已启动（参见 `references/resource-saturation-quick.md`）

**集群脚本**（`cluster_*.sh`）：
- 集群健康检查（`cluster-quick-check.md` 第 2B 层）
- 对标记为异常的集群节点进行深入分析（`cluster-deep-analysis.md`）
- 始终在本地编码 → 通过 TAT 发送 → 在远程 CVM 解码并运行

**回退方式**：脚本缺失或失败时，使用对应 `references/cluster-*.md` 文件中的内联命令。

---

## 设计原则

**脚本提供：**
- ✅ 执行速度（3 秒，相比单条命令约 10 秒）
- ✅ 跨平台支持（本地支持 Linux/macOS/Windows；远程 CVM 始终为 Linux）
- ✅ 适合 AI 解析的结构化输出
- ✅ 可独立测试和版本控制

**与参考资料的配合：**
- 脚本 = 快速执行路径
- 参考文件 = 回退方案 + 详细说明

---

**最近更新**：2026-05-12\
**版本**：1.2
