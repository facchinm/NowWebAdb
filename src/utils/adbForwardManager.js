/**
 * ADB Port Forwarding Utilities
 * Provides helper functions to manage port forwarding via ADB
 */

import { ElMessage } from 'element-plus';

class AdbForwardManager {
  constructor() {
    this.forwardedPorts = new Map();
  }

  /**
   * Create a port forward from Android device to localhost
   * @param {Object} adb - ADB instance
   * @param {number} devicePort - Port on Android device
   * @param {number} localPort - Local port to forward to
   * @returns {Promise<Object>} Forward configuration
   */
  async createForward(adb, devicePort, localPort) {
    try {
      if (!adb) {
        throw new Error('ADB instance not available');
      }

      // Create socket connection to device port
      const socket = await adb.createSocket(`tcp:${devicePort}`);
      
      if (!socket) {
        throw new Error(`Failed to create socket to device port ${devicePort}`);
      }

      // Store forward configuration
      const forwardConfig = {
        devicePort,
        localPort,
        socket,
        createdAt: new Date(),
        status: 'active'
      };

      const forwardKey = `${devicePort}`;
      this.forwardedPorts.set(forwardKey, forwardConfig);

      return forwardConfig;
    } catch (error) {
      console.error('Forward creation error:', error);
      throw error;
    }
  }

  /**
   * Close a forwarded port
   * @param {number} devicePort - Device port to close
   */
  closeForward(devicePort) {
    const forwardKey = `${devicePort}`;
    const config = this.forwardedPorts.get(forwardKey);
    
    if (config && config.socket) {
      try {
        config.socket.close?.();
        config.status = 'closed';
        this.forwardedPorts.delete(forwardKey);
      } catch (error) {
        console.error('Error closing forward:', error);
      }
    }
  }

  /**
   * Close all active forwards
   */
  closeAllForwards() {
    for (const [key, config] of this.forwardedPorts) {
      this.closeForward(config.devicePort);
    }
  }

  /**
   * Get forward configuration
   * @param {number} devicePort - Device port
   * @returns {Object|null}
   */
  getForward(devicePort) {
    return this.forwardedPorts.get(`${devicePort}`) || null;
  }

  /**
   * Get all active forwards
   * @returns {Array}
   */
  getAllForwards() {
    return Array.from(this.forwardedPorts.values());
  }

  /**
   * Create a simple TCP proxy that reads from socket and can be consumed
   * @param {Object} socket - Socket from adbForward
   * @param {Function} onData - Callback when data is received
   * @param {Function} onError - Callback when error occurs
   */
  setupSocketListener(socket, onData, onError) {
    try {
      if (socket.readable) {
        const reader = socket.readable.getReader();

        const readData = async () => {
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              
              // Convert ArrayBuffer to string
              const decoder = new TextDecoder();
              const data = decoder.decode(value);
              onData?.(data);
            }
          } catch (error) {
            onError?.(error);
          }
        };

        readData();
      }
    } catch (error) {
      console.error('Socket listener setup error:', error);
      onError?.(error);
    }
  }

  /**
   * Send data through socket
   * @param {number} devicePort - Device port
   * @param {string} data - Data to send
   */
  async sendData(devicePort, data) {
    const config = this.getForward(devicePort);
    if (!config || !config.socket?.writable) {
      throw new Error('Socket not available for writing');
    }

    const writer = config.socket.writable.getWriter();
    const encoder = new TextEncoder();
    await writer.write(encoder.encode(data));
    writer.releaseLock();
  }

  /**
   * Perform a real HTTP request over a fresh ADB socket (one socket per request,
   * mirroring a plain HTTP/1.1 client) and return the parsed response.
   * @param {Object} adb - ADB instance
   * @param {number} devicePort - Port on Android device the HTTP server listens on
   * @param {string} path - Request path, e.g. "/" or "/style.css"
   * @param {Object} [options]
   * @param {string} [options.method='GET']
   * @param {Object} [options.headers]
   * @param {string} [options.body] - Text body (mutually exclusive with bodyBytes)
   * @param {Uint8Array|ArrayBuffer} [options.bodyBytes] - Binary body, takes precedence over body
   * @param {number} [options.timeout=10000]
   * @returns {Promise<{status:number, statusText:string, headers:Object, bodyBytes:Uint8Array, bodyText:string}>}
   */
  async httpRequest(adb, devicePort, path = '/', options = {}) {
    const { method = 'GET', headers = {}, body = '', bodyBytes: rawBodyBytes, timeout = 10000, onLog } = options;

    if (!adb) {
      throw new Error('ADB instance not available');
    }

    const socket = await adb.createSocket(`tcp:${devicePort}`);
    if (!socket) {
      throw new Error(`Failed to create socket to device port ${devicePort}`);
    }

    try {
      let requestText = `${method} ${path} HTTP/1.1\r\n`;
      requestText += `Host: 127.0.0.1:${devicePort}\r\n`;
      requestText += `Connection: close\r\n`;
      requestText += `User-Agent: Mozilla/5.0 (NowWebAdb-Proxy)\r\n`;
      requestText += `Accept: */*\r\n`;

      for (const [key, value] of Object.entries(headers)) {
        if (!/^(host|connection|content-length)$/i.test(key)) {
          requestText += `${key}: ${value}\r\n`;
        }
      }

      const bodyBytes = rawBodyBytes
        ? (rawBodyBytes instanceof Uint8Array ? rawBodyBytes : new Uint8Array(rawBodyBytes))
        : (body ? new TextEncoder().encode(body) : null);
      if (bodyBytes && bodyBytes.length > 0) {
        requestText += `Content-Length: ${bodyBytes.length}\r\n`;
      }
      requestText += '\r\n';

      onLog?.({ type: 'request', path, text: requestText });

      const writer = socket.writable.getWriter();
      await writer.write(new TextEncoder().encode(requestText));
      if (bodyBytes && bodyBytes.length > 0) {
        await writer.write(bodyBytes);
      }
      writer.releaseLock();

      const raw = await this._readAll(socket, timeout);
      onLog?.({ type: 'response', path, text: this._previewBytes(raw), byteLength: raw.length });

      return this._parseHttpResponse(raw);
    } catch (error) {
      onLog?.({ type: 'error', path, text: error.message });
      throw error;
    } finally {
      try {
        socket.close?.();
      } catch (e) {
        // socket already closed by remote, ignore
      }
    }
  }

  /** Decode up to maxBytes of a raw byte response as text, for log previews. */
  _previewBytes(bytes, maxBytes = 4096) {
    const slice = bytes.length > maxBytes ? bytes.slice(0, maxBytes) : bytes;
    const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    return bytes.length > maxBytes ? `${text}\n... [truncated, ${bytes.length} bytes total]` : text;
  }



  /**
   * Read every byte the socket sends until it closes or a timeout elapses.
   * @param {Object} socket
   * @param {number} timeout
   * @returns {Promise<Uint8Array>}
   */
  async _readAll(socket, timeout) {
    const reader = socket.readable.getReader();
    const chunks = [];
    let total = 0;

    const timer = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Request timed out')), timeout)
    );

    const readLoop = (async () => {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        total += value.length;
      }
    })();

    try {
      await Promise.race([readLoop, timer]);
    } catch (error) {
      // Timed out or errored - fall through and return what we have
    } finally {
      reader.releaseLock();
    }

    const merged = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) {
      merged.set(chunk, offset);
      offset += chunk.length;
    }
    return merged;
  }

  /**
   * Parse a raw HTTP/1.x response (status line + headers + body) from bytes.
   * @param {Uint8Array} raw
   */
  _parseHttpResponse(raw) {
    const headerBoundary = this._findHeaderBoundary(raw);
    const headerBytes = headerBoundary === -1 ? raw : raw.slice(0, headerBoundary);
    const bodyBytes = headerBoundary === -1 ? new Uint8Array(0) : raw.slice(headerBoundary);

    const headerText = new TextDecoder('utf-8').decode(headerBytes);
    const lines = headerText.split('\r\n').filter((l) => l.length > 0);
    const statusLine = lines[0] || 'HTTP/1.1 0 Unknown';
    const statusMatch = statusLine.match(/HTTP\/\d\.\d\s+(\d+)\s*(.*)/);
    const status = statusMatch ? parseInt(statusMatch[1], 10) : 0;
    const statusText = statusMatch ? statusMatch[2] : 'Unknown';

    const responseHeaders = {};
    for (const line of lines.slice(1)) {
      const idx = line.indexOf(':');
      if (idx > -1) {
        const key = line.slice(0, idx).trim().toLowerCase();
        const value = line.slice(idx + 1).trim();
        responseHeaders[key] = value;
      }
    }

    let finalBody = bodyBytes;
    if (responseHeaders['transfer-encoding']?.includes('chunked')) {
      finalBody = this._decodeChunkedBody(bodyBytes);
    }

    return {
      status,
      statusText,
      headers: responseHeaders,
      bodyBytes: finalBody,
      bodyText: new TextDecoder('utf-8').decode(finalBody)
    };
  }

  /** Find the index right after the blank line separating headers from body. */
  _findHeaderBoundary(raw) {
    for (let i = 0; i < raw.length - 3; i++) {
      if (raw[i] === 13 && raw[i + 1] === 10 && raw[i + 2] === 13 && raw[i + 3] === 10) {
        return i + 4;
      }
    }
    return -1;
  }

  /** Decode an HTTP chunked-transfer-encoded body into plain bytes. */
  _decodeChunkedBody(bytes) {
    const chunks = [];
    let offset = 0;
    const decoder = new TextDecoder('utf-8');

    while (offset < bytes.length) {
      let lineEnd = offset;
      while (lineEnd < bytes.length - 1 && !(bytes[lineEnd] === 13 && bytes[lineEnd + 1] === 10)) {
        lineEnd++;
      }
      if (lineEnd >= bytes.length - 1) break;

      const sizeLine = decoder.decode(bytes.slice(offset, lineEnd)).trim();
      const chunkSize = parseInt(sizeLine, 16);
      if (!chunkSize || Number.isNaN(chunkSize)) break;

      const chunkStart = lineEnd + 2;
      const chunkEnd = chunkStart + chunkSize;
      chunks.push(bytes.slice(chunkStart, chunkEnd));
      offset = chunkEnd + 2; // skip trailing \r\n after chunk data
    }

    const total = chunks.reduce((sum, c) => sum + c.length, 0);
    const merged = new Uint8Array(total);
    let pos = 0;
    for (const chunk of chunks) {
      merged.set(chunk, pos);
      pos += chunk.length;
    }
    return merged;
  }
}

// Export singleton instance
export const adbForwardManager = new AdbForwardManager();

export default adbForwardManager;
