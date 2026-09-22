<template>
  <el-card class="device-logcat">
    <div class="header d-flex align-center justify-between">
      <div class="d-flex align-center flex-grow-1">
        <el-select
          v-model="selectedPriority"
          placeholder="Log Level"
          style="width: 150px"
        >
          <el-option
            v-for="item in priorityOptions"
            :key="item.value"
            :label="item.label"
            :value="item.value"
          />
        </el-select>
        <el-input
          v-model="tagFilter"
          placeholder="Tag Filter"
          class="mx-3"
          style="width: 150px"
        />
        <el-input
          v-model="searchQuery"
          placeholder="Search Logs"
          class="flex-grow-1"
          style="max-width: 450px"
        />
      </div>
      <div class="d-flex align-center">
        <el-button
          :type="isRunning ? 'danger' : 'primary'"
          @click="toggleLogcat"
        >
          <el-icon class="mx-1">
            <VideoPlay v-if="!isRunning" />
            <VideoPause v-else />
          </el-icon>
          {{ isRunning ? 'Stop' : 'Start' }}
        </el-button>
        <el-button
          type="info"
          class="ml-2"
          @click="clearLogs"
        >
          <el-icon class="mx-1"><Delete /></el-icon>
          Clear
        </el-button>
        <el-button
          :disabled="filteredLogs.length === 0"
          type="success"
          class="ml-2"
          @click="exportLogs"
        >
          <el-icon class="mx-1"><Download /></el-icon>
          Export
        </el-button>
      </div>
    </div>

    <div class="log-container">
      <div class="log-header">
        <div class="log-cell time">Time</div>
        <div class="log-cell priority">Level</div>
        <div class="log-cell tag">Tag</div>
        <div class="log-cell message">Message</div>
      </div>
      <el-scrollbar ref="scrollbarRef" height="calc(100vh - 240px)" @scroll="handleScroll">
        <div v-if="filteredLogs.length > 0" class="log-entries">
          <div class="virtual-padding-top" :style="{ height: `${topPadding}px` }"></div>
          <div
            v-for="item in visibleLogs"
            :key="item.id"
            :class="[
              'log-entry',
              `priority-${LogPriorityToCharacter[item.priority]?.toLowerCase()}`
            ]"
            @click="toggleRowExpansion(item.id)"
          >
            <div class="log-cell time">{{ formatTime(item) }}</div>
            <div class="log-cell priority">
              <el-tag
                :type="getPriorityType(item.priority)"
                size="small"
                effect="dark"
                class="priority-tag"
              >
                {{ LogPriorityToCharacter[item.priority] }}
              </el-tag>
            </div>
            <div class="log-cell tag">{{ item.tag }}</div>
            <div
              class="log-cell message"
              :class="{ 'expanded': expandedRowId === item.id }"
            >
              {{ item.message }}
            </div>
          </div>
          <div class="virtual-padding-bottom" :style="{ height: `${bottomPadding}px` }"></div>
        </div>
        <div v-else class="no-logs-message">
          {{ isRunning ? 'Waiting for logs...' : 'No logs to display' }}
        </div>
      </el-scrollbar>
      <div class="auto-scroll-indicator" v-if="!isNearBottom && isRunning">
        <el-button size="small" type="info" circle @click="scrollToBottom">
          <el-icon><ArrowDown /></el-icon>
        </el-button>
      </div>
    </div>
  </el-card>
</template>

<script setup>
import { ref, onUnmounted, shallowRef, computed, nextTick, onMounted, watch } from 'vue'
import { useDeviceStore } from '@/stores/device'
import { ElMessage } from 'element-plus'
import { getAdbInstance, spawnLogStream } from '@/utils/adbManager'
import { Delete, Download, VideoPlay, VideoPause, ArrowDown } from '@element-plus/icons-vue'

// Generic Linux log severity levels (replaces Android's V/D/I/W/E/F logcat priorities).
// Numerically ordered low-to-high so the existing "priority >= selected" filter still works.
const LogPriority = { Verbose: 0, Debug: 1, Info: 2, Warn: 3, Error: 4, Fatal: 5 }
const LogPriorityToCharacter = { 0: 'V', 1: 'D', 2: 'I', 3: 'W', 4: 'E', 5: 'F' }

// syslog/journald PRIORITY field (0=emerg..7=debug) -> our internal levels
const syslogPriorityToLevel = (priority) => {
  const p = Number(priority)
  if (Number.isNaN(p)) return LogPriority.Info
  if (p <= 2) return LogPriority.Fatal
  if (p === 3) return LogPriority.Error
  if (p === 4) return LogPriority.Warn
  if (p === 5 || p === 6) return LogPriority.Info
  return LogPriority.Debug
}

// 状态变量
const deviceStore = useDeviceStore()
const isRunning = ref(false)
const logs = shallowRef([])
const selectedPriority = ref(LogPriority.Verbose)
const tagFilter = ref('')
const searchQuery = ref('')
const scrollbarRef = ref(null)
const isNearBottom = ref(true)
const expandedRowId = ref(null)

// 虚拟滚动相关变量
const itemHeight = 46 // 每个日志项的高度
const bufferSize = 20 // 增加上下缓冲区大小以避免空白
const visibleLogs = ref([]) // 可见日志
const topPadding = ref(0) // 顶部填充高度
const bottomPadding = ref(0) // 底部填充高度
const scrollTop = ref(0) // 滚动位置

// Logcat 实例
let journalStream = null
let journalReader = null
let dmesgStream = null
let dmesgReader = null
let shouldStopLogcat = false

// 日志队列和处理相关变量
const MAX_LOGS = 10000 // 最大日志数量
const logQueue = []
let isProcessingQueue = false
let lastUpdateTime = 0
const UPDATE_INTERVAL = 200 // 更新间隔
let logIdCounter = 0 // 用于生成唯一ID

// 优先级选项
const priorityOptions = [
  { label: 'Verbose (V)', value: LogPriority.Verbose },
  { label: 'Debug (D)', value: LogPriority.Debug },
  { label: 'Info (I)', value: LogPriority.Info },
  { label: 'Warn (W)', value: LogPriority.Warn },
  { label: 'Error (E)', value: LogPriority.Error },
  { label: 'Fatal (F)', value: LogPriority.Fatal }
]

// 使用计算属性来过滤日志
const filteredLogs = computed(() => {
  const priority = selectedPriority.value
  const tag = tagFilter.value.toLowerCase()
  const query = searchQuery.value.toLowerCase()

  return logs.value.filter((log) => {
    if (log.priority < priority) return false
    if (tag && !log.tag.toLowerCase().includes(tag)) return false
    if (query && !log.message.toLowerCase().includes(query)) return false
    return true
  })
})

// 监听过滤条件变化，当条件变化时重置滚动位置
watch([selectedPriority, tagFilter, searchQuery], () => {
  nextTick(() => {
    if (scrollbarRef.value) {
      scrollbarRef.value.setScrollTop(0)
      updateVisibleLogs(0)
    }
  })
})

// 监听filteredLogs变化，更新虚拟滚动
watch(filteredLogs, () => {
  updateVisibleLogs(scrollTop.value)
})

// 更新可见日志 - 修复虚拟滚动计算
const updateVisibleLogs = (scrollPosition) => {
  if (!scrollbarRef.value || !scrollbarRef.value.wrapRef) return

  const containerHeight = scrollbarRef.value.wrapRef.clientHeight
  const totalItems = filteredLogs.value.length
  
  // 计算可见项的起始索引和结束索引
  const startIndex = Math.max(0, Math.floor(scrollPosition / itemHeight) - bufferSize)
  const visibleCount = Math.ceil(containerHeight / itemHeight) + bufferSize * 2
  const endIndex = Math.min(totalItems, startIndex + visibleCount)
  
  // 更新可见日志
  visibleLogs.value = filteredLogs.value.slice(startIndex, endIndex)
  
  // 更新顶部和底部填充
  topPadding.value = startIndex * itemHeight
  bottomPadding.value = (totalItems - endIndex) * itemHeight
}

// 切换 Logcat 状态
const toggleLogcat = async () => {
  if (isRunning.value) {
    await stopLogcat()
  } else {
    await startLogcat()
  }
}

// 解析一行 `journalctl -o json` 输出为统一的日志条目
const parseJournalLine = (line) => {
  let obj
  try {
    obj = JSON.parse(line)
  } catch {
    return null
  }
  const microseconds = parseInt(obj.__REALTIME_TIMESTAMP || '0', 10)
  const message = typeof obj.MESSAGE === 'string' ? obj.MESSAGE : JSON.stringify(obj.MESSAGE ?? '')
  return {
    id: logIdCounter++,
    timestampMs: microseconds ? microseconds / 1000 : Date.now(),
    priority: syslogPriorityToLevel(obj.PRIORITY),
    tag: obj.SYSLOG_IDENTIFIER || obj._COMM || 'journal',
    message
  }
}

// 解析一行 dmesg 输出 (内核环形缓冲区消息，格式因内核/util-linux版本而异，
// 这里只做尽力而为的解析：剥离开头的 [uptime] 时间戳，标记为 kernel 来源)
const KERNEL_TS_REGEX = /^\[\s*\d+\.\d+\]\s*(.*)$/
const parseDmesgLine = (line) => {
  if (!line.trim()) return null
  const match = line.match(KERNEL_TS_REGEX)
  return {
    id: logIdCounter++,
    timestampMs: Date.now(),
    priority: LogPriority.Info,
    tag: 'kernel',
    message: match ? match[1] : line
  }
}

/** Continuously read lines from a stdout stream and hand each parsed entry to the queue. */
const pumpLogStream = async (stdout, parseLine) => {
  const reader = stdout.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  try {
    while (!shouldStopLogcat) {
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })

      let newlineIndex
      while ((newlineIndex = buffer.indexOf('\n')) !== -1) {
        const line = buffer.slice(0, newlineIndex)
        buffer = buffer.slice(newlineIndex + 1)
        const entry = parseLine(line)
        if (entry) {
          logQueue.push(entry)
          if (!isProcessingQueue) processLogQueue()
        }
      }
    }
  } catch (err) {
    if (!shouldStopLogcat) {
      console.error('读取日志流时出错:', err)
    }
  } finally {
    try { reader.releaseLock() } catch { /* already released */ }
  }
}

// 启动日志流 (journalctl 覆盖系统服务日志，dmesg 覆盖内核环形缓冲区日志)
const startLogcat = async () => {
  const adb = getAdbInstance()
  if (!adb) {
    ElMessage.error('Please connect device first')
    return
  }

  isRunning.value = true
  shouldStopLogcat = false
  logs.value = []
  logIdCounter = 0

  try {
    journalStream = await spawnLogStream('journalctl -f -o json --no-pager -n 200 2>/dev/null')
    pumpLogStream(journalStream.stdout, parseJournalLine)
  } catch (error) {
    console.warn('journalctl not available:', error)
  }

  try {
    dmesgStream = await spawnLogStream('dmesg --follow 2>/dev/null')
    pumpLogStream(dmesgStream.stdout, parseDmesgLine)
  } catch (error) {
    console.warn('dmesg not available:', error)
  }

  if (!journalStream && !dmesgStream) {
    ElMessage.error('Neither journalctl nor dmesg is available on this device')
    isRunning.value = false
  }
}

// 异步处理日志队列
const processLogQueue = async () => {
  isProcessingQueue = true
  while (logQueue.length > 0 && !shouldStopLogcat) {
    const now = Date.now()
    if (now - lastUpdateTime >= UPDATE_INTERVAL) {
      await new Promise((resolve) => requestAnimationFrame(resolve))
      
      // 增加批处理大小
      const batchSize = Math.min(500, logQueue.length)
      const batch = logQueue.splice(0, batchSize)
      
      // 使用不可变更新方式
      logs.value = [...logs.value, ...batch].slice(-MAX_LOGS)
      lastUpdateTime = now
      
      // 如果用户在底部，则自动滚动
      if (isNearBottom.value) {
        await nextTick()
        scrollToBottom()
      }
    } else {
      await new Promise((resolve) =>
        setTimeout(resolve, UPDATE_INTERVAL - (now - lastUpdateTime))
      )
    }
  }
  isProcessingQueue = false
}

// 停止日志流
const stopLogcat = async () => {
  shouldStopLogcat = true
  isRunning.value = false

  if (journalStream) {
    journalStream.kill()
    journalStream = null
  }
  if (dmesgStream) {
    dmesgStream.kill()
    dmesgStream = null
  }

  logQueue.length = 0
}

// 清除日志 (只清空本地显示，不会破坏性地清除设备自身的 journal/内核缓冲区)
const clearLogs = () => {
  logs.value = []
  logQueue.length = 0
  logIdCounter = 0
  ElMessage.success('日志已清除')
}

// 导出日志
const exportLogs = () => {
  const logText = filteredLogs.value
    .map((log) => `${formatTime(log)} ${log.tag} ${log.message}`)
    .join('\n')
  const blob = new Blob([logText], { type: 'text/plain' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `logcat_export_${new Date().toISOString().replace(/:/g, '-')}.txt`
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  URL.revokeObjectURL(url)
  ElMessage.success('日志导出成功')
}

// 格式化时间
const formatTime = (log) => {
  const date = new Date(log.timestampMs)
  return date.toLocaleTimeString('zh-CN', { hour12: false }) + '.' +
    String(date.getMilliseconds()).padStart(3, '0')
}

// 获取优先级对应的类型
const getPriorityType = (priority) => {
  switch (priority) {
    case LogPriority.Verbose: return 'info'
    case LogPriority.Debug: return 'primary'
    case LogPriority.Info: return 'success'
    case LogPriority.Warn: return 'warning'
    case LogPriority.Error: return 'danger'
    case LogPriority.Fatal: return 'danger'
    default: return 'info'
  }
}

// 滚动到底部
const scrollToBottom = () => {
  if (!scrollbarRef.value) return;
  
  nextTick(() => {
    try {
      const scrollbar = scrollbarRef.value;
      if (scrollbar && scrollbar.wrapRef) {
        scrollbar.wrapRef.scrollTop = scrollbar.wrapRef.scrollHeight;
      }
    } catch (error) {
      console.error('滚动到底部时出错:', error);
    }
  });
}

// 处理滚动事件
const handleScroll = (event) => {
  if (!scrollbarRef.value || !scrollbarRef.value.wrapRef) return;
  
  const { scrollTop: newScrollTop, scrollHeight, clientHeight } = scrollbarRef.value.wrapRef;
  scrollTop.value = newScrollTop;
  
  // 当滚动条距离底部小于50px时，我们认为用户在底部
  isNearBottom.value = scrollHeight - newScrollTop - clientHeight < 50;
  
  // 更新可见日志
  updateVisibleLogs(newScrollTop);
}

// 点击行时展开/折叠
const toggleRowExpansion = (id) => {
  if (expandedRowId.value === id) {
    expandedRowId.value = null;
  } else {
    expandedRowId.value = id;
  }
}

// 组件卸载时清理资源
onUnmounted(() => {
  stopLogcat()
})

// 组件挂载时初始化
onMounted(() => {
  // 检查设备连接状态
  const adb = getAdbInstance()
  if (!adb) {
    ElMessage.warning('请先连接设备才能查看日志')
  }
  
  // 初始化虚拟滚动
  nextTick(() => {
    if (scrollbarRef.value && scrollbarRef.value.wrapRef) {
      updateVisibleLogs(0);
    }
    scrollToBottom();
  });
})
</script>

<style scoped>
.device-logcat {
  height: 100%;
  display: flex;
  flex-direction: column;
  border-radius: 12px;
}

.header {
  padding: 16px;
  border-bottom: 1px solid var(--el-border-color-light);
  margin-bottom: 10px;
  margin-top: -10px;
}

.log-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
}

.log-header {
  display: flex;
  font-weight: bold;
  padding: 10px 6px;
  position: sticky;
  top: 0;
  z-index: 1;
  background-color: var(--el-bg-color);
  border-bottom: 1px solid var(--el-border-color);
  width: 100%;
  align-items: center;
  height: 35px;
}

.log-entries {
  width: 100%;
  position: relative;
}

.log-entry {
  display: flex;
  padding: 10px 5px;
  font-size: 0.9rem;
  border-bottom: 1px solid var(--el-border-color-light);
  cursor: pointer;
  transition: background-color 0.2s;
  width: 100%;
  align-items: center;
  min-height: 46px;
}

.log-entry:hover {
  background-color: var(--el-fill-color-light);
}

.log-cell {
  padding: 0 10px;
  overflow: hidden;
  text-overflow: ellipsis;
  margin-bottom: 7px;
}

.log-cell.time {
  flex: 0 0 120px;
  white-space: nowrap;
}

.log-cell.priority {
  flex: 0 0 60px;
  text-align: center;
}

.log-cell.tag {
  flex: 0 0 180px;
  white-space: nowrap;
}

.log-cell.message {
  flex: 1;
  min-width: 0;
  max-width: calc(100% - 360px);
  white-space: nowrap;
  transition: all 0.3s;
}

.log-cell.message.expanded {
  white-space: pre-wrap;
  word-break: break-word;
  overflow: visible;
  text-overflow: clip;
  background-color: var(--el-fill-color);
  padding: 8px 10px;
  border-radius: 4px;
  position: relative;
  z-index: 2;
  max-width: none;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.priority-tag {
  width: 24px;
  height: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 0 8px;
}

.no-logs-message {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: var(--el-text-color-secondary);
}

.auto-scroll-indicator {
  position: absolute;
  bottom: 20px;
  right: 20px;
  z-index: 10;
}

/* 优先级颜色 */
.priority-v {
  border-left: 3px solid var(--el-color-info);
}

.priority-d {
  border-left: 3px solid var(--el-color-primary);
}

.priority-i {
  border-left: 3px solid var(--el-color-success);
}

.priority-w {
  border-left: 3px solid var(--el-color-warning);
}

.priority-e, .priority-f {
  border-left: 3px solid var(--el-color-danger);
}

@media (max-width: 600px) {
  .log-cell.time {
    flex: 0 0 100px;
  }

  .log-cell.tag {
    flex: 0 0 100px;
  }
  
  .log-cell.message {
    max-width: calc(100% - 260px);
  }
}
</style> 