<template>
  <div class="info-section">
    <div class="section-header">
      <SvgIcon icon="wifiIcon" :color="'#FF9800'" :style="{ width: 18 + 'px', height: 18 + 'px'}"/>
      <span class="section-title">Connect to WiFi</span>
    </div>

    <div class="wifi-connect-content">
      <el-button
        :loading="scanning"
        size="small"
        @click="scanNetworks"
      >
        {{ scanning ? 'Scanning...' : 'Scan Networks' }}
      </el-button>

      <el-select
        v-if="networks.length > 0"
        v-model="selectedSsid"
        placeholder="Select a network"
        class="network-select"
        size="small"
      >
        <el-option
          v-for="net in networks"
          :key="net.ssid"
          :label="`${net.ssid} (${net.signal}%)${net.security ? '' : ' - Open'}`"
          :value="net.ssid"
        />
      </el-select>
      <div v-else-if="hasScanned && !scanning" class="empty-hint">No networks found</div>

      <el-input
        v-if="selectedSsid && selectedNetworkNeedsPassword"
        v-model="password"
        type="password"
        placeholder="WiFi password"
        size="small"
        show-password
        class="password-input"
        @keyup.enter="connect"
      />

      <el-button
        v-if="selectedSsid"
        type="primary"
        size="small"
        :loading="connecting"
        :disabled="selectedNetworkNeedsPassword && !password"
        @click="connect"
      >
        Connect
      </el-button>

      <div v-if="statusMessage" class="status-message" :class="{ 'status-error': !statusSuccess }">
        {{ statusMessage }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed } from 'vue';
import { ElMessage } from 'element-plus';
import SvgIcon from "@/components/SvgIcon.vue";
import { scanWifiNetworks, connectWifiNetwork } from "@/utils/deviceInfoService.js";

const scanning = ref(false);
const connecting = ref(false);
const hasScanned = ref(false);
const networks = ref([]);
const selectedSsid = ref('');
const password = ref('');
const statusMessage = ref('');
const statusSuccess = ref(true);

const selectedNetworkNeedsPassword = computed(() => {
  const net = networks.value.find((n) => n.ssid === selectedSsid.value);
  return !!net?.security;
});

const scanNetworks = async () => {
  scanning.value = true;
  statusMessage.value = '';
  selectedSsid.value = '';
  password.value = '';
  try {
    networks.value = await scanWifiNetworks();
    hasScanned.value = true;
    if (networks.value.length === 0) {
      ElMessage.warning('No WiFi networks found');
    }
  } catch (error) {
    ElMessage.error('Failed to scan WiFi networks');
  } finally {
    scanning.value = false;
  }
};

const connect = async () => {
  if (!selectedSsid.value) return;

  connecting.value = true;
  statusMessage.value = '';
  try {
    const result = await connectWifiNetwork(selectedSsid.value, password.value);
    statusSuccess.value = result.success;
    statusMessage.value = result.success
      ? `Connected to ${selectedSsid.value}`
      : result.message;

    if (result.success) {
      ElMessage.success(`Connected to ${selectedSsid.value}`);
      password.value = '';
    } else {
      ElMessage.error(result.message || 'Failed to connect');
    }
  } catch (error) {
    statusSuccess.value = false;
    statusMessage.value = error.message || 'Failed to connect';
    ElMessage.error('Failed to connect');
  } finally {
    connecting.value = false;
  }
};
</script>

<style scoped>
.info-section {
  background-color: #ffffff;
  border-radius: 8px;
  padding: 15px 20px;
  margin-bottom: 20px;
  box-shadow: 0 1px 4px rgba(0, 0, 0, 0.05);
  border: 1px solid #f0f0f0;
  height: calc(100% - 20px);
  box-sizing: border-box;
}

.section-header {
  display: flex;
  align-items: center;
  margin-bottom: 16px;
  padding-bottom: 10px;
  border-bottom: 1px solid #f0f0f0;
}

.section-title {
  font-size: 16px;
  font-weight: 600;
  color: #303133;
  margin-left: 8px;
}

.wifi-connect-content {
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.network-select {
  width: 100%;
}

.password-input {
  width: 100%;
}

.empty-hint {
  color: #909399;
  font-size: 13px;
}

.status-message {
  font-size: 13px;
  color: #67c23a;
  word-break: break-word;
}

.status-message.status-error {
  color: #f56c6c;
}
</style>
