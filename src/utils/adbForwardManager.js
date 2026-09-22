/**
 * ADB Port Forwarding Utilities
 * Provides helper functions to manage port forwarding via ADB
 */

import { ElMessage } from 'element-plus';
import { withAdbLock } from './adbManager.js';

class AdbForwardManager {
  constructor() {
    this.forwardedPorts = new Map();
    // One persistent, keep-alive HTTP connection per device port, reused across
    // requests instead of opening/closing a fresh socket every time - repeatedly
    // opening sockets was overwhelming the ADB/WebUSB transport.
    this.persistentConnections = new Map();
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
    for (const devicePort of Array.from(this.persistentConnections.keys())) {
      this._closeConnection(devicePort);
    }
  }

  /** Close the reusable HTTP connection for a device port, if one is open. */
  closeHttpConnection(devicePort) {
    this._closeConnection(devicePort);
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
   * Perform a real HTTP request, reusing one persistent keep-alive socket per
   * device port instead of opening a fresh one each time.
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

    const bodyBytes = rawBodyBytes
      ? (rawBodyBytes instanceof Uint8Array ? rawBodyBytes : new Uint8Array(rawBodyBytes))
      : (body ? new TextEncoder().encode(body) : null);

    let requestText = `${method} ${path} HTTP/1.1\r\n`;
    requestText += `Host: 127.0.0.1:${devicePort}\r\n`;
    requestText += `Connection: keep-alive\r\n`;
    requestText += `User-Agent: Mozilla/5.0 (NowWebAdb-Proxy)\r\n`;
    requestText += `Accept: */*\r\n`;
    for (const [key, value] of Object.entries(headers)) {
      if (!/^(host|connection|content-length)$/i.test(key)) {
        requestText += `${key}: ${value}\r\n`;
      }
    }
    if (bodyBytes && bodyBytes.length > 0) {
      requestText += `Content-Length: ${bodyBytes.length}\r\n`;
    }
    requestText += '\r\n';

    // One retry with a brand new connection if the reused one turns out to be
    // dead (device/idle timeout closed it since our last request).
    for (let attempt = 1; attempt <= 2; attempt++) {
      const conn = await this._getPersistentConnection(adb, devicePort, onLog, path);
      try {
        onLog?.({ type: 'request', path, text: requestText });

        await conn.writer.write(new TextEncoder().encode(requestText));
        if (bodyBytes && bodyBytes.length > 0) {
          await conn.writer.write(bodyBytes);
        }

        const raw = await this._readOneHttpMessage(conn, timeout);
        onLog?.({ type: 'response', path, text: this._previewBytes(raw), byteLength: raw.length });

        if (conn.closed) {
          this._closeConnection(devicePort);
        }

        return this._parseHttpResponse(raw);
      } catch (error) {
        this._closeConnection(devicePort);
        if (attempt === 2) {
          onLog?.({ type: 'error', path, text: error.message });
          throw error;
        }
        onLog?.({ type: 'info', path, text: `Reused connection failed, reconnecting: ${error.message}` });
      }
    }
  }

  /** Get the existing open persistent connection for a device port, or open a new one. */
  async _getPersistentConnection(adb, devicePort, onLog, path) {
    const key = `${devicePort}`;
    const existing = this.persistentConnections.get(key);
    if (existing && !existing.closed) {
      return existing;
    }

    const socket = await this._createSocketWithRetry(adb, devicePort, onLog, path);
    const conn = {
      socket,
      reader: socket.readable.getReader(),
      writer: socket.writable.getWriter(),
      buffer: new Uint8Array(0),
      closed: false
    };
    this.persistentConnections.set(key, conn);
    return conn;
  }

  /** Tear down and forget the persistent connection for a device port, if any. */
  _closeConnection(devicePort) {
    const key = `${devicePort}`;
    const conn = this.persistentConnections.get(key);
    if (!conn) return;
    this.persistentConnections.delete(key);
    try { conn.reader.releaseLock(); } catch { /* already released/errored */ }
    try { conn.writer.releaseLock(); } catch { /* already released/errored */ }
    try { conn.socket.close?.(); } catch { /* already closed */ }
  }

  /**
   * Read exactly one HTTP response off a persistent connection's reader, using
   * Content-Length/chunked framing to find the message boundary (we can't just
   * "read until close" anymore since the socket stays open for reuse). Leftover
   * bytes belonging to the next response are kept in conn.buffer.
   */
  async _readOneHttpMessage(conn, timeoutMs) {
    const deadline = Date.now() + timeoutMs;
    const readMore = async () => {
      const remaining = deadline - Date.now();
      if (remaining <= 0) throw new Error('Timed out waiting for response');
      const timer = new Promise((_, reject) => setTimeout(() => reject(new Error('Timed out waiting for response')), remaining));
      const { done, value } = await Promise.race([conn.reader.read(), timer]);
      if (done) {
        conn.closed = true;
        return null;
      }
      return value;
    };

    let buf = conn.buffer;
    let headerEnd = this._findHeaderBoundary(buf);
    while (headerEnd === -1) {
      const chunk = await readMore();
      if (!chunk) break;
      buf = this._concatBytes(buf, chunk);
      headerEnd = this._findHeaderBoundary(buf);
    }
    if (headerEnd === -1) {
      conn.buffer = new Uint8Array(0);
      return buf;
    }

    const headerText = new TextDecoder('utf-8').decode(buf.slice(0, headerEnd));
    if (/Connection:\s*close/i.test(headerText)) {
      conn.closed = true;
    }

    if (/Transfer-Encoding:\s*chunked/i.test(headerText)) {
      while (!this._chunkedTerminatorEnd(buf, headerEnd)) {
        const chunk = await readMore();
        if (!chunk) break;
        buf = this._concatBytes(buf, chunk);
      }
      const msgEnd = this._chunkedTerminatorEnd(buf, headerEnd) || buf.length;
      conn.buffer = msgEnd < buf.length ? buf.slice(msgEnd) : new Uint8Array(0);
      return buf.slice(0, msgEnd);
    }

    const lengthMatch = headerText.match(/Content-Length:\s*(\d+)/i);
    if (lengthMatch) {
      const totalLength = headerEnd + parseInt(lengthMatch[1], 10);
      while (buf.length < totalLength) {
        const chunk = await readMore();
        if (!chunk) break;
        buf = this._concatBytes(buf, chunk);
      }
      conn.buffer = buf.length > totalLength ? buf.slice(totalLength) : new Uint8Array(0);
      return buf.slice(0, Math.min(totalLength, buf.length));
    }

    // Neither Content-Length nor chunked: the only valid boundary left is the
    // connection closing, so drain until then and don't reuse this socket again.
    conn.closed = true;
    while (true) {
      const chunk = await readMore().catch(() => null);
      if (!chunk) break;
      buf = this._concatBytes(buf, chunk);
    }
    conn.buffer = new Uint8Array(0);
    return buf;
  }

  /** Concatenate two Uint8Arrays. */
  _concatBytes(a, b) {
    if (a.length === 0) return b;
    if (b.length === 0) return a;
    const merged = new Uint8Array(a.length + b.length);
    merged.set(a, 0);
    merged.set(b, a.length);
    return merged;
  }

  /** Return the index right after a chunked body's terminating "0\r\n\r\n", or 0 if not found yet. */
  _chunkedTerminatorEnd(buf, bodyStart) {
    // A minimal, correctness-over-speed scan: look for "0\r\n\r\n" from bodyStart onward.
    for (let i = bodyStart; i < buf.length - 4; i++) {
      if (buf[i] === 48 && buf[i + 1] === 13 && buf[i + 2] === 10 && buf[i + 3] === 13 && buf[i + 4] === 10) {
        return i + 5;
      }
    }
    return 0;
  }

  /** Open a socket, retrying with backoff since "Socket open failed" often isn't
   *  purely concurrency (it can still happen on the very first, fully serialized
   *  attempt) - the device's server or the WebUSB transport itself seems to need
   *  a moment to settle between one connection closing and the next opening.
   *  Also goes through the app-wide ADB lock so it doesn't race with other
   *  ADB operations elsewhere in the app at least. */
  async _createSocketWithRetry(adb, devicePort, onLog, path, attempts = 5, baseDelayMs = 150) {
    let lastError;
    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        const socket = await withAdbLock(async () => {
          const s = await adb.createSocket(`tcp:${devicePort}`);
          if (!s) {
            throw new Error(`Failed to create socket to device port ${devicePort}`);
          }
          return s;
        });
        return socket;
      } catch (error) {
        lastError = error;
        if (attempt < attempts) {
          const delay = baseDelayMs * 2 ** (attempt - 1);
          onLog?.({ type: 'info', path, text: `Socket open failed (attempt ${attempt}/${attempts}), retrying in ${delay}ms: ${error.message}` });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }
    throw lastError;
  }

  /** Decode up to maxBytes of a raw byte response as text, for log previews. */
  _previewBytes(bytes, maxBytes = 4096) {
    const slice = bytes.length > maxBytes ? bytes.slice(0, maxBytes) : bytes;
    const text = new TextDecoder('utf-8', { fatal: false }).decode(slice);
    return bytes.length > maxBytes ? `${text}\n... [truncated, ${bytes.length} bytes total]` : text;
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
