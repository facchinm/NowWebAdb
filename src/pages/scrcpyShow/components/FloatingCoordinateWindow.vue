<template>
  <div
    v-if="visible"
    class="floating-coordinate-window"
    :style="windowStyle"
  >
    <div class="coordinate-content">
      <div class="absolute-coords">
        X: {{ absoluteX }}, Y: {{ absoluteY }}
      </div>
      <div class="device-info">
        Device: {{ deviceWidth }}×{{ deviceHeight }} ({{ relativeX.toFixed(3) }}, {{ relativeY.toFixed(3) }})
      </div>
      <div class="instruction">
        Right-click anywhere on screen to copy relative coordinates🖱
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue';

const props = defineProps({
  visible: {
    type: Boolean,
    default: false
  },
  mouseX: {
    type: Number,
    default: 0
  },
  mouseY: {
    type: Number,
    default: 0
  },
  absoluteX: {
    type: Number,
    default: 0
  },
  absoluteY: {
    type: Number,
    default: 0
  },
  deviceWidth: {
    type: Number,
    default: 1080
  },
  deviceHeight: {
    type: Number,
    default: 1920
  }
});

// 计算相对坐标 - 基于设备真实分辨率
const relativeX = computed(() => {
  return props.deviceWidth > 0 ? props.absoluteX / props.deviceWidth : 0;
});

const relativeY = computed(() => {
  return props.deviceHeight > 0 ? props.absoluteY / props.deviceHeight : 0;
});

// 计算窗口位置样式
const windowStyle = computed(() => {
  const offsetX = 20; // 向右偏移
  const offsetY = 20; // 向下偏移
  
  // 确保窗口不会超出视口边界
  const maxX = window.innerWidth - 300; // 窗口宽度约为300px
  const maxY = window.innerHeight - 120; // 窗口高度约为120px
  
  const left = Math.min(props.mouseX + offsetX, maxX);
  const top = Math.min(props.mouseY + offsetY, maxY);
  
  return {
    left: `${Math.max(0, left)}px`,
    top: `${Math.max(0, top)}px`,
  };
});

// 不再需要事件处理函数，右键复制功能已移到父组件
</script>

<style lang="scss" scoped>
.floating-coordinate-window {
  position: fixed;
  z-index: 99999; /* 更高的 z-index 确保在最顶层 */
  background: rgba(0, 0, 0, 0.9);
  color: #00ff88;
  padding: 12px 16px;
  border-radius: 8px;
  font-family: 'Courier New', monospace;
  font-size: 14px;
  line-height: 1.4;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.5);
  border: 1px solid rgba(0, 255, 136, 0.5);
  pointer-events: none; /* 不拦截鼠标事件，让事件穿透到底层 */
  user-select: none;
  min-width: 280px;
  backdrop-filter: blur(4px);
}

.coordinate-content {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.absolute-coords {
  font-weight: bold;
  color: #00ff88;
  font-size: 15px;
}

.device-info {
  color: #ffaa00;
  font-size: 13px;
}

.instruction {
  color: #888;
  font-size: 11px;
  margin-top: 4px;
  font-style: italic;
}

.floating-coordinate-window:hover {
  background: rgba(0, 0, 0, 0.9);
  border-color: rgba(0, 255, 136, 0.5);
}
</style>
