# 智能体配置草稿按 JSON 契约克隆

状态：implemented
类型：bug-fix
Owner：web/src/utils/agentEditorConfig.js

## 问题
编辑导入专家时，配置 Schema 已进入 Vue ref，数组或对象默认值成为响应式代理，structuredClone 因不能克隆 Proxy 而中止编辑页加载。

## 决策
保存配置和默认值通过 JSON 序列化创建独立草稿，与后端 config_json 契约一致，解除嵌套代理并保留数组、对象、空选择和全资源 null。

## 替代方案
仅对顶层 toRaw 不保证移除嵌套代理；捕获异常返回空配置会丢失导入专家设定。

## 后果
配置草稿不与 Schema 或服务器配置共享对象。此边界只支持 JSON 配置，不承诺克隆函数或其他非 JSON 对象。

## 验证
回归测试使用 Vue reactive Schema、响应式保存值和嵌套代理，验证加载结果与修改隔离；真实编辑导入专家页面验证。
