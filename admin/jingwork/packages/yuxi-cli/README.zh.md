# yuxi-cli

[English](README.md) | 中文

Yuxi 命令行客户端。

首阶段范围：

- 通过 `~/.yuxi/config.toml` 远程管理
- 浏览器登录
- 使用 `--api-key` 导入 API Key
- `whoami`、`status` 和 `logout`
- 发现服务器并检查与 Yuxi `>=0.7.1` 的兼容性
- `yuxi chat` 在本地浏览器中临时聊天并流式显示 Agent 输出；`/state` 读取线程状态，`/approve` 恢复待审批的工具调用
- `yuxi agent list` 和 `yuxi agent show <slug>` 用于查看已登录用户可见的智能体
- `yuxi kb upload` 用于上传知识库文件
- `yuxi agent eval` 用于通过已登录的远程服务运行现有 Langfuse 数据集实验
