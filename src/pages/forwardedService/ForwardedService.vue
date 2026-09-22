<template>
  <div class="forwarded-service-container">
    <div class="config-panel">
      <div class="config-group">
        <div class="config-section">
          <label>Android Port:</label>
          <el-input-number 
            v-model="androidPort" 
            :min="1" 
            :max="65535"
            @change="onConfigChange"
            style="width: 180px"
          />
        </div>

        <div class="config-section">
          <label>Mode:</label>
          <el-select v-model="forwardMode" @change="onConfigChange" style="width: 150px">
            <el-option label="HTTP/Web" value="http" />
            <el-option label="WebSocket" value="websocket" />
            <el-option label="Raw TCP" value="raw" />
          </el-select>
        </div>
      </div>

      <div class="button-group">
        <el-button 
          v-if="!isForwarding" 
          type="primary" 
          @click="startForwarding"
          :loading="isConnecting"
          size="default"
        >
          Start Forwarding
        </el-button>
        <el-button 
          v-else 
          type="danger" 
          @click="stopForwarding"
          size="default"
        >
          Stop Forwarding
        </el-button>
      </div>

      <div class="info-banner" v-if="infoMessage">
        <span>{{ infoMessage }}</span>
      </div>
    </div>

    <!-- HTTP/Web Mode -->
    <div v-if="forwardMode === 'http' && isForwarding" class="viewer-container http-viewer">
      <div class="viewer-header">
        <div class="header-content">
          <span class="label">Socket-based HTTP Proxy</span>
          <span class="status-badge">Android Port {{ androidPort }}</span>
        </div>
        <div class="header-status">
          <el-button text size="small" @click="showLogs = !showLogs">{{ showLogs ? 'Hide' : 'Show' }} Log</el-button>
          <el-button text size="small" @click="reloadHttpProxy">Reload</el-button>
          <span class="status-indicator active"></span>
          Connected via Socket
        </div>
      </div>
      <div v-if="proxyError" class="proxy-init-status">
        <p class="error-text">Failed to load page</p>
        <p class="info">{{ proxyError }}</p>
        <el-button size="small" @click="startForwarding">Retry</el-button>
      </div>
      <div v-else-if="httpProxyReady" class="iframe-container">
        <!-- No sandbox: Chromium does not let Service Workers control sandboxed
             iframes even with allow-same-origin, which would silently bypass
             the whole proxy (request goes straight to the real network). -->
        <iframe 
          :key="iframeKey"
          :src="PROXY_SCOPE"
          class="service-iframe"
          @load="onIframeLoad"
        ></iframe>
      </div>
      <div v-else class="proxy-init-status">
        <div class="spinner"></div>
        <p>Loading service from Android device...</p>
        <p class="info">Fetching {{ currentPath }} from port {{ androidPort }}</p>
      </div>

      <div v-if="showLogs" class="log-panel">
        <div class="log-panel-header">
          <span>Traffic Log ({{ proxyLogs.length }})</span>
          <el-button text size="small" @click="clearLogs">Clear</el-button>
        </div>
        <div class="log-panel-body">
          <div v-for="(log, idx) in proxyLogs" :key="idx" class="log-entry" :class="`log-${log.type}`">
            <span class="log-time">{{ log.time }}</span>
            <span class="log-badge" :class="`log-badge-${log.type}`">{{ log.type }}</span>
            <span class="log-path" v-if="log.path">{{ log.path }}</span>
            <pre class="log-text">{{ log.text }}</pre>
          </div>
          <div v-if="proxyLogs.length === 0" class="log-empty">No traffic yet</div>
        </div>
      </div>
    </div>

    <!-- WebSocket Mode -->
    <div v-else-if="forwardMode === 'websocket' && isForwarding" class="viewer-container ws-viewer">
      <div class="viewer-header">
        <div class="header-content">
          <span class="label">WebSocket Raw Socket</span>
          <span class="status-badge">Android Port {{ androidPort }}</span>
        </div>
        <div class="header-status">
          <span class="status-indicator" :class="{ active: wsConnected }"></span>
          {{ wsConnected ? 'Connected' : 'Disconnected' }}
        </div>
      </div>

      <div class="message-display">
        <div v-for="(msg, idx) in wsMessages" :key="idx" class="message-item" :class="`msg-${msg.type}`">
          <span class="message-time">{{ msg.time }}</span>
          <span class="message-badge" :class="`badge-${msg.type}`">{{ msg.type }}</span>
          <span class="message-content">{{ msg.data }}</span>
        </div>
        <div v-if="wsMessages.length === 0" class="empty-messages">
          <el-empty description="No messages" />
        </div>
      </div>

      <div class="message-input-area">
        <el-input 
          v-model="wsMessageInput" 
          placeholder="Enter message and press Enter to send"
          @keyup.enter="sendWebSocketMessage"
          clearable
        />
        <el-button 
          @click="sendWebSocketMessage"
          :disabled="!wsConnected"
          style="margin-left: 10px;"
        >
          Send
        </el-button>
      </div>
    </div>

    <!-- Raw TCP Mode -->
    <div v-else-if="forwardMode === 'raw' && isForwarding" class="viewer-container raw-viewer">
      <div class="viewer-header">
        <div class="header-content">
          <span class="label">Raw TCP Socket</span>
          <span class="status-badge">Android Port {{ androidPort }}</span>
        </div>
        <div class="header-status">
          <span class="status-indicator active"></span>
          Ready
        </div>
      </div>

      <div class="raw-content">
        <div class="raw-section">
          <h4>Socket Connection Information</h4>
          <div class="info-box">
            <p><strong>Target Device Port:</strong> <code>{{ androidPort }}</code></p>
            <p><strong>Socket Status:</strong> <span class="status-ok">Active</span></p>
            <p><strong>Type:</strong> <code>Raw TCP via ADB</code></p>
          </div>

          <h4>Raw Socket Access</h4>
          <div class="method-box">
            <div class="method">
              <span class="method-title">The socket is available for raw byte communication.</span>
              <p class="info-text">Use the following in your code to read/write data:</p>
              <code class="copyable">
const forward = adbForwardManager.getForward({{ androidPort }});
const data = await adbForwardManager.readFromSocket(forward.socket);
await adbForwardManager.writeToSocket(forward.socket, 'your data');
              </code>
            </div>
          </div>

          <div class="socket-info" v-if="socketInfo">
            <h4>Socket Details</h4>
            <div class="info-grid">
              <div class="info-item">
                <span class="label">Connected Since:</span>
                <span class="value">{{ socketInfo.connectedSince }}</span>
              </div>
              <div class="info-item">
                <span class="label">Status:</span>
                <span class="value" :class="socketInfo.status">{{ socketInfo.status }}</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- No Service View -->
    <div v-else class="empty-state">
      <el-empty description="Start forwarding to access service">
        <template #default>
          <p>Configure Android port and select mode to start forwarding</p>
        </template>
      </el-empty>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onUnmounted } from 'vue';
import { ElMessage } from 'element-plus';
import { getAdbInstance } from '@/utils/adbManager.js';
import { adbForwardManager } from '@/utils/adbForwardManager.js';

// Configuration
const androidPort = ref(8080);
const forwardMode = ref('http');

// State
const isForwarding = ref(false);
const isConnecting = ref(false);
const iframeKey = ref(0);
const infoMessage = ref('');
const httpProxyReady = ref(false);
const proxyError = ref('');
const proxyLogs = ref([]);
const showLogs = ref(false);

// Socket references
let currentSocket = null;
let currentForward = null;
let adbInstance = null;
let currentPath = '/';

/** Append an entry to the traffic log window, keeping only the most recent 200. */
const addLog = ({ type, path, text, byteLength }) => {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  proxyLogs.value.push({ time, type, path, text, byteLength });
  if (proxyLogs.value.length > 200) {
    proxyLogs.value.shift();
  }
};

const clearLogs = () => {
  proxyLogs.value = [];
};

// --- HTTP mode: Service Worker-based transparent proxy ---
// Every request the loaded page makes (document, CSS, JS, XHR/fetch, dynamic
// imports) is intercepted by the SW and relayed here to run over the ADB
// socket, so full bundled SPAs work without any manual HTML rewriting.
// A BroadcastChannel (not the SW's Clients API) carries the request/response,
// since the main app page lives outside the SW's scope and is therefore
// never visible to self.clients.matchAll()/get() inside the worker.
const PROXY_SCOPE = '/adb-proxy/';
let swRegistration = null;
let proxyChannel = null;

/** Wait for this specific registration's worker to activate. navigator.serviceWorker.ready
 *  can't be used here - it resolves based on whether the *current page* is controlled, and
 *  our page lives outside PROXY_SCOPE so it never will be, causing that promise to hang forever. */
const waitForActivation = (registration) => new Promise((resolve, reject) => {
  if (registration.active) return resolve();
  const worker = registration.installing || registration.waiting;
  if (!worker) return resolve();
  const timeout = setTimeout(() => reject(new Error('Timed out waiting for the proxy service worker to activate')), 10000);
  worker.addEventListener('statechange', function handler() {
    if (worker.state === 'activated') {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', handler);
      resolve();
    } else if (worker.state === 'redundant') {
      clearTimeout(timeout);
      worker.removeEventListener('statechange', handler);
      reject(new Error('Proxy service worker installation failed'));
    }
  });
});

const ensureServiceWorker = async () => {
  if (!('serviceWorker' in navigator)) {
    throw new Error('Service Workers are not available in this browser context (requires a secure context / localhost).');
  }

  if (!swRegistration) {
    swRegistration = await navigator.serviceWorker.register('/adb-proxy-sw.js', { scope: PROXY_SCOPE });
  }
  await waitForActivation(swRegistration);
  addLog({ type: 'info', text: `Proxy service worker active (scope: ${PROXY_SCOPE})` });

  if (!proxyChannel) {
    proxyChannel = new BroadcastChannel('adb-proxy-channel');
    proxyChannel.onmessage = handleProxyChannelMessage;
  }
};

const handleProxyChannelMessage = async (event) => {
  const { type, id, method, path, headers, body } = event.data || {};
  if (type !== 'ADB_PROXY_REQUEST') return;

  try {
    const response = await adbForwardManager.httpRequest(adbInstance, androidPort.value, path, {
      method,
      headers,
      bodyBytes: body ? new Uint8Array(body) : undefined,
      onLog: addLog
    });

    proxyChannel.postMessage({
      type: 'ADB_PROXY_RESPONSE',
      id,
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
      bodyBytes: response.bodyBytes
    });
  } catch (error) {
    proxyChannel.postMessage({ type: 'ADB_PROXY_RESPONSE', id, error: error.message });
  }
};

// WebSocket state
const wsConnected = ref(false);
let wsSocket = null;
const wsMessages = ref([]);
const wsMessageInput = ref('');

// Raw TCP state
const socketInfo = ref(null);

const onConfigChange = () => {
  if (isForwarding.value) {
    stopForwarding();
  }
};

const startForwarding = async () => {
  try {
    isConnecting.value = true;
    clearLogs();
    const adb = getAdbInstance();
    
    if (!adb) {
      ElMessage.error('ADB instance not available. Please connect a device first.');
      return;
    }

    adbInstance = adb;

    // HTTP mode routes every request through the Service Worker proxy on demand
    // (see ensureServiceWorker/handleProxyChannelMessage), so no persistent
    // socket is held open here - that would block single-connection servers
    // from accepting the real request.
    if (forwardMode.value !== 'http') {
      currentForward = await adbForwardManager.createForward(adb, androidPort.value, 0);
      currentSocket = currentForward.socket;
    }

    isForwarding.value = true;
    infoMessage.value = `Forwarding Android port ${androidPort.value} via direct socket connection`;

    if (forwardMode.value === 'http') {
      proxyError.value = '';
      httpProxyReady.value = false;
      await ensureServiceWorker();
      currentPath = '/';
      httpProxyReady.value = true;
      iframeKey.value++;
    } else if (forwardMode.value === 'websocket') {
      await initializeRawSocketMessaging();
    } else if (forwardMode.value === 'raw') {
      initializeRawSocketInfo();
    }

    ElMessage.success(`Forwarding started successfully`);
  } catch (error) {
    console.error('Forwarding error:', error);
    ElMessage.error(`Failed to start forwarding: ${error.message}`);
    proxyError.value = error.message;
    isForwarding.value = false;
    currentSocket = null;
    currentForward = null;
  } finally {
    isConnecting.value = false;
  }
};

const reloadHttpProxy = () => {
  iframeKey.value++;
};

const initializeRawSocketMessaging = async () => {
  try {
    if (!currentSocket) {
      throw new Error('Socket not available');
    }

    // Create a WebSocket-like interface over the raw socket
    wsConnected.value = true;
    wsMessages.value = [];
    addMessage('Connected to raw socket', 'system');

    // Start reading from socket
    const reader = currentSocket.readable.getReader();
    
    (async () => {
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) {
            wsConnected.value = false;
            addMessage('Connection closed', 'system');
            break;
          }

          const data = new TextDecoder().decode(value);
          addMessage(data, 'receive');
        }
      } catch (error) {
        console.error('Socket read error:', error);
        wsConnected.value = false;
        addMessage(`Error: ${error.message}`, 'error');
      }
    })();
  } catch (error) {
    console.error('WebSocket initialization error:', error);
    ElMessage.error('Failed to initialize raw socket messaging');
  }
};

const sendWebSocketMessage = async () => {
  if (!wsMessageInput.value.trim()) return;

  try {
    const message = wsMessageInput.value;
    await adbForwardManager.sendData(androidPort.value, message);
    addMessage(message, 'send');
    wsMessageInput.value = '';
  } catch (error) {
    console.error('Send error:', error);
    ElMessage.error('Failed to send message');
    addMessage(`Send error: ${error.message}`, 'error');
  }
};

const addMessage = (data, type = 'receive') => {
  const now = new Date();
  const time = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}`;
  
  wsMessages.value.push({
    time,
    data: String(data).substring(0, 500),
    type
  });
  
  if (wsMessages.value.length > 100) {
    wsMessages.value.shift();
  }
};

const initializeRawSocketInfo = () => {
  socketInfo.value = {
    connectedSince: new Date().toLocaleTimeString(),
    status: 'active'
  };
};

const stopForwarding = () => {
  try {
    if (currentForward) {
      adbForwardManager.closeForward(androidPort.value);
    }

    currentSocket = null;
    currentForward = null;
    adbInstance = null;
    currentPath = '/';
    wsConnected.value = false;
    wsMessages.value = [];
    isForwarding.value = false;
    infoMessage.value = '';
    socketInfo.value = null;
    httpProxyReady.value = false;
    proxyError.value = '';

    ElMessage.success('Forwarding stopped');
  } catch (error) {
    console.error('Error stopping forward:', error);
  }
};

const onIframeLoad = () => {
  console.log('Iframe proxy loaded');
};

onUnmounted(() => {
  proxyChannel?.close();
  if (isForwarding.value) {
    stopForwarding();
  }
});
</script>

<style scoped>
.forwarded-service-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  overflow: hidden;
  background-color: #f5f7fa;
}

.config-panel {
  padding: 16px;
  background-color: #fff;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  align-items: center;
}

.config-group {
  display: flex;
  gap: 20px;
  flex-wrap: wrap;
  align-items: center;
  flex: 1;
}

.config-section {
  display: flex;
  align-items: center;
  gap: 8px;
}

.config-section label {
  font-weight: 500;
  color: #303133;
  min-width: 100px;
}

.button-group {
  display: flex;
  gap: 8px;
}

.info-banner {
  flex-basis: 100%;
  padding: 8px 12px;
  background-color: #f0f9ff;
  border-left: 3px solid #409eff;
  color: #0a5cff;
  font-size: 12px;
  border-radius: 2px;
}

.viewer-container {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
  margin: 16px;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}

.viewer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  border-bottom: 1px solid #e4e7ed;
  background-color: #f5f7fa;
}

.header-content {
  display: flex;
  align-items: center;
  gap: 12px;
}

.label {
  font-weight: 600;
  color: #303133;
}

.status-badge {
  font-size: 12px;
  padding: 2px 8px;
  background-color: #e6f7ff;
  color: #0050b3;
  border-radius: 3px;
}

.header-status {
  display: flex;
  align-items: center;
  gap: 8px;
  color: #606266;
  font-size: 12px;
}

.status-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background-color: #d4d4d5;
  transition: background-color 0.3s;
}

.status-indicator.active {
  background-color: #67c23a;
  box-shadow: 0 0 6px rgba(103, 194, 58, 0.5);
}

/* HTTP Viewer */
.http-viewer {
  gap: 0;
}

.iframe-container {
  flex: 1;
  overflow: hidden;
  min-height: 0;
}

.log-panel {
  flex-shrink: 0;
  height: 120px;
  resize: vertical;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  border-top: 1px solid #e4e7ed;
  background-color: #1e1e1e;
}

.log-panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 6px 12px;
  background-color: #2d2d2d;
  color: #ccc;
  font-size: 12px;
  flex-shrink: 0;
}

.log-panel-body {
  flex: 1;
  overflow-y: auto;
  padding: 8px 12px;
  font-family: 'Courier New', monospace;
  font-size: 11px;
}

.log-entry {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 6px;
  padding: 4px 0;
  border-bottom: 1px solid #333;
}

.log-time {
  color: #808080;
  flex-shrink: 0;
}

.log-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 2px;
  font-weight: bold;
  text-transform: uppercase;
  font-size: 10px;
}

.log-badge-request { background-color: #264f78; color: #9cdcfe; }
.log-badge-response { background-color: #1e4620; color: #6a9955; }
.log-badge-error { background-color: #5a1d1d; color: #f48771; }
.log-badge-info { background-color: #4a4a1e; color: #dcdcaa; }

.log-path {
  color: #dcdcaa;
  flex-shrink: 0;
}

.log-text {
  flex-basis: 100%;
  margin: 4px 0 0 0;
  padding: 6px 8px;
  background-color: #252525;
  color: #d4d4d4;
  white-space: pre-wrap;
  word-break: break-all;
  border-radius: 3px;
  max-height: 150px;
  overflow-y: auto;
}

.log-empty {
  color: #808080;
  text-align: center;
  padding: 20px 0;
}

.service-iframe {
  width: 100%;
  height: 100%;
  border: none;
  background-color: #fff;
}

.proxy-init-status {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  padding: 20px;
  color: #606266;
}

.spinner {
  width: 40px;
  height: 40px;
  border: 3px solid #f0f0f0;
  border-top-color: #409eff;
  border-radius: 50%;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  to { transform: rotate(360deg); }
}

.proxy-init-status p {
  margin: 0;
  font-size: 14px;
}

.proxy-init-status .info {
  font-size: 12px;
  color: #909399;
}

.proxy-init-status .error-text {
  font-size: 15px;
  font-weight: 600;
  color: #f56c6c;
}

/* WebSocket Viewer */
.ws-viewer {
  gap: 0;
}

.message-display {
  flex: 1;
  overflow-y: auto;
  padding: 12px;
  background-color: #fafafa;
  font-family: 'Courier New', monospace;
  font-size: 12px;
}

.message-item {
  display: flex;
  gap: 8px;
  padding: 6px;
  margin-bottom: 4px;
  border-radius: 3px;
  align-items: flex-start;
}

.message-time {
  color: #909399;
  flex-shrink: 0;
  font-weight: bold;
  min-width: 70px;
  text-align: right;
}

.message-badge {
  flex-shrink: 0;
  padding: 1px 6px;
  border-radius: 2px;
  font-size: 10px;
  font-weight: bold;
  text-transform: uppercase;
}

.badge-send {
  background-color: #f0f9ff;
  color: #0a5cff;
}

.badge-receive {
  background-color: #f0f9ff;
  color: #0a5cff;
}

.badge-system {
  background-color: #fef0f0;
  color: #f56c6c;
}

.badge-error {
  background-color: #fef0f0;
  color: #f56c6c;
}

.message-content {
  color: #303133;
  flex: 1;
  word-break: break-all;
}

.empty-messages {
  display: flex;
  align-items: center;
  justify-content: center;
  height: 100px;
}

.message-input-area {
  display: flex;
  padding: 12px;
  border-top: 1px solid #e4e7ed;
  background-color: #fafafa;
  gap: 8px;
}

.message-input-area :deep(.el-input) {
  font-family: 'Courier New', monospace;
  font-size: 12px;
}

/* Raw TCP Viewer */
.raw-viewer {
  gap: 0;
}

.raw-content {
  flex: 1;
  overflow-y: auto;
  padding: 20px;
}

.raw-section {
  display: flex;
  flex-direction: column;
  gap: 24px;
}

.raw-section h4 {
  margin: 0 0 12px 0;
  color: #303133;
  font-size: 14px;
  font-weight: 600;
}

.info-box {
  background-color: #f0f9ff;
  border: 1px solid #b3d8ff;
  border-radius: 4px;
  padding: 16px;
}

.info-box p {
  margin: 8px 0;
  line-height: 1.8;
  color: #303133;
}

.info-box code {
  background-color: #fff;
  padding: 2px 6px;
  border-radius: 2px;
  font-family: 'Courier New', monospace;
  color: #f56c6c;
  font-size: 12px;
}

.status-ok {
  color: #67c23a;
  font-weight: bold;
}

.method-box {
  display: flex;
  flex-direction: column;
  gap: 12px;
  background-color: #fafafa;
  border-radius: 4px;
  padding: 16px;
}

.method {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.method-title {
  color: #606266;
  font-size: 12px;
  font-weight: 500;
}

.info-text {
  color: #909399;
  font-size: 12px;
  margin: 8px 0;
}

.copyable {
  background-color: #fff;
  padding: 12px;
  border-radius: 3px;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  border: 1px solid #e4e7ed;
  cursor: pointer;
  transition: all 0.3s;
  display: block;
  word-break: break-all;
  color: #0a5cff;
  overflow-x: auto;
}

.copyable:hover {
  background-color: #ecf5ff;
  border-color: #409eff;
}

.socket-info {
  background-color: #f9f9f9;
  border: 1px solid #e4e7ed;
  border-radius: 4px;
  padding: 16px;
}

.socket-info h4 {
  margin-bottom: 12px;
}

.info-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
  gap: 12px;
}

.info-item {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.info-item .label {
  color: #606266;
  font-size: 12px;
  font-weight: normal;
}

.info-item .value {
  color: #303133;
  font-weight: 500;
  font-size: 13px;
}

.info-item .value.active {
  color: #67c23a;
}

.empty-state {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: 1;
  margin: 16px;
  background-color: #fff;
  border-radius: 8px;
  box-shadow: 0 2px 12px rgba(0, 0, 0, 0.08);
}
</style>
