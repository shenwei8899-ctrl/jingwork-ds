# 企业 Skill 管理复用原技能界面

状态：implemented
类型：feature
Owner：web/src/views/EnterpriseSkillManageView.vue

## 问题
企业菜单 Skill 管理没有页面内容。

## 决策
在企业入口复用 SkillCardList，保留原搜索、刷新、上传、远程安装、批量管理和技能详情操作。

## 替代方案
复制列表和请求逻辑会形成独立维护来源，容易造成权限和操作行为不一致。

## 后果
继续共享原技能数据及权限约束；技能详情沿用原 Yuxi 路由。

## 验证
前端 lint 和 build，以及真实企业页面验证列表与操作入口。
