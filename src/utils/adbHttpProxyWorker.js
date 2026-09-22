/**
 * HTTP Proxy Service Worker
 * Intercepts HTTP requests and routes them through ADB socket
 * This file is a service worker that bridges iframe requests to ADB socket
 */

let adbSocket = null;
let isReady = false;

// Listen for messages from the main thread
self.onmessage = async (event) => {
  const { type, data } = event.data;

  if (type === 'INIT_SOCKET') {
    adbSocket = data.socket;
    isReady = true;
    self.postMessage({ type: 'READY' });
  } else if (type === 'FETCH_REQUEST') {
    handleFetchRequest(data);
  }
};

async function handleFetchRequest(data) {
  const { id, method, path, headers, body } = data;

  try {
    if (!adbSocket) {
      throw new Error('Socket not initialized');
    }

    // Build HTTP request
    let request = `${method} ${path} HTTP/1.1\r\n`;
    request += `Host: localhost\r\n`;
    request += `Connection: close\r\n`;

    // Add headers
    const headersObj = headers || {};
    for (const [key, value] of Object.entries(headersObj)) {
      if (key.toLowerCase() !== 'host' && key.toLowerCase() !== 'connection') {
        request += `${key}: ${value}\r\n`;
      }
    }

    if (body) {
      const bodyBytes = new TextEncoder().encode(body);
      request += `Content-Length: ${bodyBytes.length}\r\n`;
    }

    request += '\r\n';

    // Send request through socket
    const writer = adbSocket.writable.getWriter();
    const encoder = new TextEncoder();
    
    await writer.write(encoder.encode(request));
    if (body) {
      await writer.write(encoder.encode(body));
    }
    
    writer.releaseLock();

    // Read response
    const reader = adbSocket.readable.getReader();
    let response = '';
    let responseComplete = false;

    try {
      while (!responseComplete) {
        const { done, value } = await reader.read();
        if (done) {
          responseComplete = true;
          break;
        }

        const chunk = new TextDecoder().decode(value, { stream: true });
        response += chunk;

        // Check if we have the full response (simple heuristic)
        if (response.includes('\r\n\r\n')) {
          // Parse headers to check if we have full body
          const headerEnd = response.indexOf('\r\n\r\n');
          const headers = response.substring(0, headerEnd);
          
          // Check for Content-Length
          const lengthMatch = headers.match(/Content-Length:\s*(\d+)/i);
          if (lengthMatch) {
            const contentLength = parseInt(lengthMatch[1]);
            const bodyStart = headerEnd + 4;
            const receivedBodyLength = response.length - bodyStart;
            
            if (receivedBodyLength >= contentLength) {
              responseComplete = true;
            }
          } else {
            // No content-length, wait for connection close
            // This is handled by done flag
          }
        }
      }
    } finally {
      reader.releaseLock();
    }

    self.postMessage({
      type: 'FETCH_RESPONSE',
      id,
      response,
      success: true
    });
  } catch (error) {
    console.error('Proxy error:', error);
    self.postMessage({
      type: 'FETCH_ERROR',
      id,
      error: error.message
    });
  }
}
