<script setup>
import { ArrowLeft, Clock3, Sparkles } from '@lucide/vue'
defineProps({ title: { type: String, required: true } })
const descriptions = {
  Runtimes: '集中查看和管理智能体运行环境，让企业运行资源更清晰。',
  'Session 列表': '统一查看智能体会话，帮助团队追踪任务与协作进展。',
  凭据管理: '集中管理智能体使用的服务凭据，让配置与维护更便捷。'
}
</script>

<template>
  <section class="coming-soon-page">
    <div class="page-heading"><h1>{{ title }}</h1><span>建设中</span></div>
    <div class="preview-card">
      <div class="illustration" aria-hidden="true">
        <div class="halo"></div>
        <img src="/home/jing-work-icon.png" alt="" />
        <span class="spark"><Sparkles :size="22" /></span>
      </div>
      <span class="status"><Clock3 :size="14" /> 正在建设中</span>
      <h2>让智能工作，再进一步</h2>
      <p>{{ descriptions[title] || `${title}正在完善中，为团队带来更完整的企业管理体验。` }}</p>
      <div class="notice">此功能暂未开放，准备就绪后将在这里与你见面。</div>
      <router-link to="/extensions" class="home-link"><ArrowLeft :size="16" /> 返回首页</router-link>
    </div>
  </section>
</template>

<style scoped>
.coming-soon-page { max-width: 1120px; margin: 0 auto; padding: 16px 24px 32px; }
.page-heading { display: flex; align-items: center; gap: 12px; margin-bottom: 28px; }
.page-heading h1 { margin: 0; font-size: 24px; font-weight: 600; }
.page-heading > span { font-size: 12px; padding: 4px 8px; border-radius: 6px; color: var(--color-text-secondary); background: var(--gray-100); }
.preview-card { position: relative; overflow: hidden; display: flex; flex-direction: column; align-items: center; text-align: center; padding: clamp(32px, 6vh, 64px) 24px; border: 1px solid var(--gray-150); border-radius: 24px; background: radial-gradient(ellipse at 50% 0%, #268cf21a, transparent 70%), var(--gray-0); }
.illustration { position: relative; width: 220px; height: 200px; margin-bottom: 24px; display: grid; place-items: center; }
.halo { position: absolute; width: 190px; height: 190px; border-radius: 50%; background: #2c94f010; border: 1px solid #2c94f020; }
.illustration img { position: relative; width: 170px; height: 170px; object-fit: contain; }
.spark { position: absolute; right: 8px; top: 25px; display: grid; place-items: center; width: 44px; height: 44px; color: #3283d3; background: var(--gray-0); border: 1px solid #3283d320; border-radius: 14px; transform: rotate(8deg); }
.status { display: inline-flex; align-items: center; gap: 6px; color: #3283d3; font-size: 12px; background: #3283d310; padding: 6px 12px; border-radius: 20px; }
h2 { font-size: clamp(24px, 3vw, 32px); margin: 20px 0 12px; letter-spacing: 1px; }
p { max-width: 460px; margin: 0; color: var(--color-text-secondary); font-size: 15px; line-height: 1.8; }
.notice { margin-top: 24px; color: var(--color-text-secondary); font-size: 13px; line-height: 1.8; }
.home-link { display: inline-flex; align-items: center; gap: 8px; margin-top: 28px; padding: 11px 20px; border-radius: 10px; background: var(--gray-1000); color: var(--gray-0); text-decoration: none; font-size: 14px; }
.home-link:hover { opacity: .85; }
.home-link:focus-visible { outline: 2px solid var(--main-color); outline-offset: 4px; }
@media (max-width: 640px) { .coming-soon-page { padding: 4px 0; } .preview-card { border-radius: 16px; } .illustration { height: 160px; margin-bottom: 16px; } .illustration img { width: 140px; height: 140px; } .halo { width: 150px; height: 150px; } }
</style>
