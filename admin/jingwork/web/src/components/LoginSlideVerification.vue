<template>
  <div ref="track" class="slide-track" :class="{ verified }">
    <span class="slide-label" aria-live="polite">{{ verified ? '验证通过' : '拖动滑块到最右侧完成验证' }}</span>
    <button
      type="button"
      class="slide-thumb"
      role="slider"
      aria-label="滑块验证"
      :aria-valuenow="Math.round(progress)"
      :aria-valuetext="verified ? '验证通过' : `${Math.round(progress)}%`"
      :aria-disabled="verified"
      aria-valuemin="0"
      aria-valuemax="100"
      :style="{ left: `calc((100% - 40px) * ${progress / 100})` }"
      @pointerdown="start"
      @pointermove="move"
      @pointerup="finish"
      @pointercancel="cancel"
      @lostpointercapture="cancel"
      @keydown="handleKey"
    >
      <Check v-if="verified" :size="18" />
      <ChevronRight v-else :size="18" />
    </button>
  </div>
</template>

<script setup>
import { ref } from 'vue'
import { Check, ChevronRight } from '@lucide/vue'

const emit = defineEmits(['verified'])
const track = ref(null)
const progress = ref(0)
const verified = ref(false)
let dragging = false
let startX = 0

function start(event) {
  if (verified.value || event.button !== 0) return
  dragging = true
  startX = event.clientX
  event.currentTarget.setPointerCapture(event.pointerId)
  event.preventDefault()
}

function move(event) {
  if (!dragging) return
  const distance = Math.max(1, track.value.getBoundingClientRect().width - 40)
  progress.value = Math.min(100, Math.max(0, (event.clientX - startX) / distance * 100))
}

function finish(event) {
  if (!dragging) return
  move(event)
  dragging = false
  if (progress.value >= 92) {
    progress.value = 100
    verified.value = true
    emit('verified')
  } else {
    progress.value = 0
  }
}

function cancel() {
  dragging = false
  if (!verified.value) progress.value = 0
}

function handleKey(event) {
  if (verified.value) return
  const offsets = { ArrowRight: 10, ArrowUp: 10, ArrowLeft: -10, ArrowDown: -10 }
  if (event.key === 'End') progress.value = 100
  else if (event.key === 'Home') progress.value = 0
  else if (event.key in offsets) progress.value = Math.min(100, Math.max(0, progress.value + offsets[event.key]))
  else return
  event.preventDefault()
  if (progress.value === 100) {
    verified.value = true
    emit('verified')
  }
}
</script>

<style scoped>
.slide-track {
  position: relative;
  height: 40px;
  border: 1px solid rgba(139, 166, 203, .2);
  border-radius: 13px;
  background: var(--login-slide-bg, rgba(227, 237, 249, .6));
  color: var(--glass-muted, #66758d);
  user-select: none;
}
.slide-label { display: flex; align-items: center; justify-content: center; height: 100%; font-size: 13px; padding-left: 24px; }
.slide-thumb {
  position: absolute;
  top: 0;
  width: 40px;
  height: 40px;
  display: grid;
  place-items: center;
  padding: 0;
  border: 1px solid rgba(139, 166, 203, .2);
  border-radius: 12px;
  color: #4484d2;
  background: var(--login-slide-thumb-bg, rgba(255, 255, 255, .85));
  box-shadow: 0 2px 4px rgba(64, 90, 135, .1);
  touch-action: none;
  cursor: grab;
}
.slide-thumb:active { cursor: grabbing; }
.slide-thumb:focus-visible { outline: 2px solid #428ce9; outline-offset: 2px; }
.verified { color: #23835c; background: rgba(220, 242, 232, .65); }
.verified .slide-thumb { color: #23835c; cursor: default; }
</style>
