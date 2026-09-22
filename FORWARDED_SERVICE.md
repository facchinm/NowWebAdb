# Forwarded Service Feature Documentation

## Overview

The **Forwarded Service** feature allows you to use ADB port forwarding from the ya-webadb library to expose Android device services directly to your web browser without any backend involvement. This is a powerful way to access services running on your connected Android device.

## Features

### 1. **HTTP/Web Mode**
Forward an HTTP/HTTPS service from your Android device and view it in an embedded iframe or open it in a new tab.

**Use Cases:**
- Access a local web server running on Android
- View web interfaces of Android services (like network analyzers, system monitors)
- Access web dashboards or admin panels running on the device

**How to Use:**
1. Start your web service on Android (e.g., port 8080)
2. Set "Android Port" to the port your service is running on
3. Set "Local Port" to any available port (e.g., 8888)
4. Select "HTTP/Web" mode
5. Click "Start Forwarding"
6. The iframe will load your service, or click "Open in New Tab" to open in a browser

### 2. **WebSocket Mode**
Connect to a WebSocket service running on Android and send/receive messages in real-time.

**Use Cases:**
- Real-time data streaming from Android
- Device control interfaces
- Live monitoring and diagnostics
- Chat or notification systems

**How to Use:**
1. Ensure your Android service is running a WebSocket server
2. Set the appropriate ports (Android and Local)
3. Select "WebSocket" mode
4. Click "Start Forwarding"
5. Messages will display in the message view
6. Type messages and press Enter to send

### 3. **Raw TCP Mode**
Forward raw TCP sockets for custom protocol applications.

**Use Cases:**
- Database connections (MySQL, Redis, MongoDB, etc.)
- Custom protocol applications
- Binary protocol services
- Any TCP-based service

**How to Use:**
1. Configure the ports
2. Select "Raw TCP" mode
3. Click "Start Forwarding"
4. Use any TCP client (telnet, netcat, curl) to connect to `localhost:LOCALPORT`

## Architecture

```
┌─────────────────┐
│   Web Browser   │
│  (NowWebAdb)    │
└────────┬────────┘
         │
         │ HTTP/WebSocket
         │
┌────────▼────────────────────┐
│  adbForwardManager Utility   │
│  (Socket Management)         │
└────────┬─────────────────────┘
         │
         │ ADB createSocket()
         │
┌────────▼──────────────────┐
│   Android Device (ADB)     │
│   ┌──────────────────────┐ │
│   │  Service/Application │ │
│   │  (HTTP/WS/TCP)       │ │
│   └──────────────────────┘ │
└───────────────────────────┘
```

## Code Examples

### Example 1: Starting HTTP Forwarding

```javascript
// In your component
const startForwarding = async () => {
  const adb = getAdbInstance();
  
  const forward = await adbForwardManager.createForward(
    adb,
    8080,  // Android port where service runs
    8888   // Local port for browser access
  );
  
  // Now access via http://localhost:8888
};
```

### Example 2: WebSocket Communication

```javascript
// The component automatically handles WebSocket connection
// After starting forwarding in WebSocket mode, you can:

// Send a message
wsSocket.send('Hello from browser');

// Messages received will display in the message view
// Each message shows: timestamp, type (send/receive), and content
```

### Example 3: Raw TCP with netcat

```bash
# After starting forwarding on port 8888 to Android port 3306 (MySQL):
nc localhost 8888

# Or with telnet:
telnet localhost 8888

# Or with curl (for HTTP-like services):
curl http://localhost:8888
```

## Setup on Android Device

### Running an HTTP Server

**Using Python:**
```bash
# On Android device via ADB shell
python -m http.server 8080

# Or with SimpleHTTPServer (Python 2)
python -m SimpleHTTPServer 8080
```

**Using Node.js:**
```javascript
// Create a simple server
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Hello from Android!');
});
server.listen(8080);
```

### Running a WebSocket Server

```javascript
// Node.js WebSocket server
const WebSocket = require('ws');
const wss = new WebSocket.Server({ port: 8080 });

wss.on('connection', (ws) => {
  console.log('Client connected');
  
  ws.on('message', (message) => {
    console.log('Received:', message);
    ws.send(`Echo: ${message}`);
  });
  
  ws.on('close', () => {
    console.log('Client disconnected');
  });
});
```

## Advanced Features

### Port Configuration
- **Android Port**: The port on which your service listens on the Android device
- **Local Port**: The port exposed on your computer (must be available)
- **Mode**: Type of service (HTTP, WebSocket, or Raw TCP)

### Socket Management
The `adbForwardManager` utility provides:

```javascript
// Create a forward
await adbForwardManager.createForward(adb, devicePort, localPort);

// Close a specific forward
adbForwardManager.closeForward(devicePort);

// Close all forwards
adbForwardManager.closeAllForwards();

// Get forward details
const forward = adbForwardManager.getForward(devicePort);

// Get all active forwards
const forwards = adbForwardManager.getAllForwards();

// Set up socket listener for raw data
adbForwardManager.setupSocketListener(socket, 
  (data) => { /* handle data */ },
  (error) => { /* handle error */ }
);

// Send data through socket
await adbForwardManager.sendData(devicePort, 'your data');
```

## Troubleshooting

### "Failed to create socket" Error
- Ensure the Android device is properly connected
- Verify the port number is correct
- Check that your service is actually running on that port

### Iframe won't load (HTTP mode)
- Ensure the service is running on Android
- Check port forwarding is active
- Try accessing directly: `http://localhost:8888` in a new tab
- Look at browser console for CORS or connection errors

### WebSocket connection timeout
- Verify the WebSocket server is running on Android
- Check firewall rules
- Ensure correct port is specified

### Raw TCP connection refused
- Ensure the service is running on the correct port
- Verify no other applications are using the local port
- Try a different local port number

## Limitations & Considerations

1. **No Backend Required**: This implementation uses ADB's native socket functionality, so no intermediate server is needed
2. **Performance**: Socket forwarding performance depends on USB/network speed
3. **Persistence**: Forwarding connections are per-session and reset on browser refresh
4. **Security**: Services are exposed to localhost only by default; be cautious with external access
5. **Firewall**: Some ports may be restricted by operating system firewalls

## Security Notes

⚠️ **Important**: Be aware of security implications when forwarding services:
- Forwarded services are accessible to any process on your computer
- Use strong authentication if exposing sensitive services
- Don't expose critical services on shared computers
- Consider VPN/firewall when forwarding over networks

## Related Files

- `src/utils/adbForwardManager.js` - Core forwarding utility
- `src/pages/forwardedService/ForwardedService.vue` - UI component
- `src/layouts/MainLayout.vue` - Navigation integration
