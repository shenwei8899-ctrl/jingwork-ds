/** Example content drawn inside the introductory workbench illustrations. */
export const onboardingArtworkEn = {
  newTask: 'New task',
  workspace: 'My workspace',
  files: 'Project files',
  tasks: ['Prepare a quarterly report', 'Organize meeting notes', 'Analyze sales data'],
  prompt: 'What would you like to work on?',
  ready: 'Ready to help',
  account: 'Personal workspace',
  activity: 'Usage overview',
  sampleBalance: '¥188.00',
} as const

/** Chinese artwork content; other interface languages use the English illustration. */
export const onboardingArtworkZh: { [K in keyof typeof onboardingArtworkEn]: K extends 'tasks' ? readonly [string, string, string] : string } = {
  newTask: '新建任务',
  workspace: '我的工作区',
  files: '项目文件',
  tasks: ['生成季度汇报', '整理会议纪要', '分析销售数据'],
  prompt: '今天想完成什么工作？',
  ready: '随时为你效劳',
  account: '个人工作区',
  activity: '用量概览',
  sampleBalance: '¥188.00',
}
