/** 将每日核对结果投影成趋势图，缺失 Token 保持空缺。
 * @param {Array<object>} rows 北京时间每日统计。
 * @param {string} metric 当前指标。
 * @param {object} colors 当前主题颜色。
 * @returns {object} ECharts 选项。
 */
export function enterpriseProductivityTrendOption(rows, metric, colors) {
  const labels = {
    questions: '对话次数',
    sessions: '活跃会话',
    active_users: '活跃成员',
    tokens: '已记录 Token'
  }
  return {
    color: [colors.main],
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => (value == null ? '未采集' : Number(value).toLocaleString('zh-CN'))
    },
    grid: { left: 64, right: 20, top: 24, bottom: 40 },
    xAxis: {
      type: 'category',
      data: rows.map((row) => row.date),
      axisLabel: { color: colors.text, formatter: (value) => value.slice(5) },
      axisLine: { lineStyle: { color: colors.border } }
    },
    yAxis: {
      type: 'value',
      minInterval: 1,
      axisLabel: { color: colors.text },
      splitLine: { lineStyle: { color: colors.border } }
    },
    series: [
      {
        name: labels[metric],
        type: 'line',
        data: rows.map((row) => row[metric]),
        connectNulls: false,
        showSymbol: true,
        showAllSymbol: true,
        symbolSize: 6
      }
    ]
  }
}
