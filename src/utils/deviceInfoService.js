import { executeCommand, getAdbInstance } from "@/utils/adbManager.js";

/**
 * 从设备获取完整信息
 */
export const getDeviceInfo = async () => {
  try {
    const adb = getAdbInstance();
    if (!adb) {
      console.warn('ADB实例不可用');
      return null;
    }

    // 同步执行所有信息获取，提高效率
    const [
      deviceModel,
      manufacturer,
      androidVersion,
      sdkVersionCode,
      resolution,
      screenDensity,
      ipAddress,
      totalMemory,
      usedMemory,
      serialNumber,
      cpuInfo,
      cpuCore,
      cpuMin,
      cpuMax,
      cpuCur,
      brand,
      product,
      board,
      display,
      id,
      fingerPrint,
      host,
      hardware,
      device,
      user,
      radioVersion,
      tags,
      type,
      cpuAbi,
      abis,
      wifiName,
      batteryInfo,
      bootloader,
      abPartition,
      uptime,
      storageInfo,
      storageType,
      kernelVersion
    ] = await Promise.all([
      // Device model: prefer the ARM/embedded device-tree model, fall back to hostname
      executeShellCommand(adb, "cat /proc/device-tree/model 2>/dev/null | tr -d '\\0'").then((v) => v || executeShellCommand(adb, 'hostname')).catch(() => 'Unknown'),
      executeShellCommand(adb, "cat /sys/devices/virtual/dmi/id/sys_vendor 2>/dev/null").catch(() => 'Unknown'),
      // OS name/version instead of Android version
      executeShellCommand(adb, ". /etc/os-release 2>/dev/null; echo \"$PRETTY_NAME\"").catch(() => 'Unknown'),
      executeShellCommand(adb, 'uname -r').catch(() => 'Unknown'),
      executeShellCommand(adb, "cat /sys/class/graphics/fb0/virtual_size 2>/dev/null").catch(() => ''),
      // No generic Linux equivalent to LCD density for a headless/embedded box
      Promise.resolve('Unknown'),
      executeShellCommand(adb, "ip addr show wlan0 | grep 'inet ' | cut -d' ' -f6 | cut -d/ -f1").catch(() => 'Unknown'),
      executeShellCommand(adb, "free -m | awk '/Mem:/ {print $2}'").catch(() => '0'),
      executeShellCommand(adb, "free -m | awk '/Mem:/ {print $3}'").catch(() => '0'),
      executeShellCommand(adb, "cat /proc/cpuinfo | grep -i serial | head -1 | cut -d: -f2 | tr -d ' \\t'").then((v) => v || adb.serial).catch(() => adb.serial || 'Unknown'),
      executeShellCommand(adb, 'uname -m').catch(() => 'Unknown'),
      executeShellCommand(adb, 'cat /proc/cpuinfo | grep processor | wc -l').catch(() => '0'),
      executeShellCommand(adb, 'cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_min_freq').catch(() => 'Unknown'),
      executeShellCommand(adb, 'cat /sys/devices/system/cpu/cpu0/cpufreq/cpuinfo_max_freq').catch(() => 'Unknown'),
      executeShellCommand(adb, 'cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq').catch(() => 'Unknown'),
      executeShellCommand(adb, ". /etc/os-release 2>/dev/null; echo \"$ID\"").catch(() => 'Unknown'),
      executeShellCommand(adb, ". /etc/os-release 2>/dev/null; echo \"$NAME\"").catch(() => 'Unknown'),
      executeShellCommand(adb, "cat /proc/device-tree/compatible 2>/dev/null | tr -d '\\0' | cut -d, -f1").catch(() => 'Unknown'),
      executeShellCommand(adb, ". /etc/os-release 2>/dev/null; echo \"$VERSION_ID\"").catch(() => 'Unknown'),
      executeShellCommand(adb, ". /etc/os-release 2>/dev/null; echo \"$VERSION\"").catch(() => 'Unknown'),
      executeShellCommand(adb, 'uname -a').catch(() => 'Unknown'),
      executeShellCommand(adb, 'hostname').catch(() => 'Unknown'),
      executeShellCommand(adb, "cat /proc/device-tree/compatible 2>/dev/null | tr -d '\\0'").catch(() => 'Unknown'),
      executeShellCommand(adb, 'cat /etc/machine-id 2>/dev/null').catch(() => 'Unknown'),
      executeShellCommand(adb, 'whoami').catch(() => 'Unknown'),
      Promise.resolve('N/A'), // no cellular baseband on a generic Linux box
      executeShellCommand(adb, 'uname -v').catch(() => 'Unknown'),
      Promise.resolve('Unknown'), // no Android build type concept on generic Linux
      executeShellCommand(adb, 'uname -m').catch(() => 'Unknown'),
      executeShellCommand(adb, "cat /proc/cpuinfo | grep -m1 -E 'flags|Features' | cut -d: -f2").catch(() => 'Unknown'),
      getWifiInfo().catch(() => 'Unknown'),
      getBatteryInfo().catch(() => ({ percentage: 0, voltage: 0, temperature: 0 })),
      executeShellCommand(adb, "cat /sys/class/dmi/id/bios_vendor 2>/dev/null").catch(() => 'Unknown'),
      Promise.resolve('N/A'), // no A/B partition slots on generic Linux
      executeShellCommand(adb, 'cat /proc/uptime | cut -d. -f1').catch(() => '0'),
      getStorageInfo().catch(() => ({ total: '0G', used: '0G', usedRate: 0 })),
      executeShellCommand(adb, 'findmnt -no FSTYPE /').catch(() => 'Unknown'),
      executeShellCommand(adb, 'uname -r').catch(() => 'Unknown')
    ]);

    // 处理分辨率 (fb0 virtual_size reports "WIDTH,HEIGHT")
    let formattedResolution = 'Unknown';
    if (resolution) {
      const match = resolution.trim().match(/(\d+),(\d+)/);
      formattedResolution = match ? `${match[1]}x${match[2]}` : 'Unknown';
    }

    // 处理CPU频率
    const formatCpuFreq = (freq) => {
      if (!freq || freq === 'Unknown') return 'Unknown';
      const freqNum = parseInt(freq.trim(), 10);
      return freqNum ? `${(freqNum / 1000).toFixed(0)} MHz` : 'Unknown';
    };

    // 处理上电时间
    const formatUptime = (seconds) => {
      if (!seconds || isNaN(parseInt(seconds, 10))) return 'Unknown';
      const uptimeSec = parseInt(seconds.trim(), 10);
      const days = Math.floor(uptimeSec / 86400);
      const hours = Math.floor((uptimeSec % 86400) / 3600);
      const minutes = Math.floor((uptimeSec % 3600) / 60);
      return `${days} days ${hours} hours ${minutes} minutes`;
    };

    // 更新设备信息
    return {
      // 系统信息
      deviceModel: deviceModel || 'Unknown',
      manufacturer: manufacturer || 'Unknown',
      androidVersion: androidVersion || 'Unknown',
      sdkVersionCode: sdkVersionCode || 'Unknown',
      resolution: formattedResolution,
      screenDensity: `${screenDensity || 'Unknown'} dpi`,
      serialNumber: serialNumber || 'Unknown',
      brand: brand || 'Unknown',
      product: product || 'Unknown',
      board: board || 'Unknown',
      display: display || 'Unknown',
      id: id || 'Unknown',
      fingerPrint: fingerPrint || 'Unknown',
      host: host || 'Unknown',
      hardware: hardware || 'Unknown',
      device: device || 'Unknown',
      user: user || 'Unknown',
      radioVersion: radioVersion || 'Unknown',
      tags: tags || 'Unknown',
      type: type || 'Unknown',
      bootloader: bootloader || 'Unknown',
      abPartition: abPartition || '无',
      kernelVersion: kernelVersion || 'Unknown',
      
      // 网络信息
      ipAddress: ipAddress || 'Unknown',
      wifiName: wifiName || 'Not Connected',
      
      // 硬件信息
      cpuInfo: cpuInfo || 'Unknown',
      cpuCore: cpuCore ? `${cpuCore.trim()} cores` : 'Unknown',
      cpuMin: formatCpuFreq(cpuMin),
      cpuMax: formatCpuFreq(cpuMax),
      cpuCur: formatCpuFreq(cpuCur),
      cpuAbi: cpuAbi || 'Unknown',
      abis: abis || 'Unknown',
      
      // 电池信息
      batteryPercentage: batteryInfo.percentage || 0,
      voltage: batteryInfo.voltage || 0,
      temperature: batteryInfo.temperature || 0,
      
      // 存储信息
      totalMemory: `${totalMemory.trim() || 0} MB`,
      usedMemory: `${usedMemory.trim() || 0} MB`,
      memoryUsedRate: parseInt(usedMemory || 0, 10) / parseInt(totalMemory || 1, 10) * 100 || 0,
      totalStorage: storageInfo.total || '0G',
      usedStorage: storageInfo.used || '0G',
      storageUsedRate: storageInfo.usedRate || 0,
      storageType: storageType || 'Unknown',
      
      // 运行信息
      uptime: formatUptime(uptime)
    };

  } catch (e) {
    console.error('获取设备信息出错:', e);
    return null;
  }
};

/**
 * 执行shell命令并返回结果
 * @param {Object} device - ADB设备实例
 * @param {string} command - 要执行的shell命令
 * @returns {Promise<string>} 命令执行结果
 */
export const executeShellCommand = async (device, command) => {
  if (!device) return '';
  try {
    return await executeCommand(command);
  } catch (error) {
    console.error(`执行命令 ${command} 出错:`, error);
    return '';
  }
};

/**
 * 获取WiFi信息
 * @returns {Promise<string>} WiFi名称
 */
export const getWifiInfo = async () => {
  // 尝试多种WiFi信息获取方式 (generic Linux wireless tools/NetworkManager, no Android services)
  const methods = [
    // 方法1: wireless-tools (iwgetid)
    async () => {
      const res = await executeCommand('iwgetid -r 2>/dev/null');
      return res ? res.trim() : null;
    },
    // 方法2: NetworkManager (nmcli)
    async () => {
      const res = await executeCommand("nmcli -t -f active,ssid dev wifi 2>/dev/null | grep '^yes'");
      if (!res) return null;
      const [, ssid] = res.trim().split(':');
      return ssid || null;
    },
    // 方法3: iw (modern wireless tool)
    async () => {
      const res = await executeCommand("iw dev wlan0 link 2>/dev/null | grep SSID");
      if (!res) return null;
      const match = res.match(/SSID:\s*(.+)/);
      return match ? match[1].trim() : null;
    }
  ];

  // 依次尝试所有方法
  for (const method of methods) {
    try {
      const result = await method();
      if (result) {
        return result;
      }
    } catch (e) {
      console.warn('WiFi信息获取方法失败:', e);
    }
  }

  return 'Unknown';
};

/**
 * 扫描附近的WiFi网络 (依赖 NetworkManager 的 nmcli)
 * @returns {Promise<Array<{ssid: string, signal: number, security: string}>>}
 */
export const scanWifiNetworks = async () => {
  try {
    const res = await executeCommand("nmcli -t -f SSID,SIGNAL,SECURITY dev wifi list --rescan yes 2>/dev/null");
    if (!res) return [];

    const bySsid = new Map();
    for (const line of res.trim().split('\n')) {
      // nmcli -t escapes literal colons within a field as "\:"
      const parts = line.split(/(?<!\\):/).map((p) => p.replace(/\\:/g, ':'));
      const [ssid, signalStr, security] = parts;
      if (!ssid) continue; // hidden/blank SSID entries aren't connectable by name

      const signal = parseInt(signalStr, 10) || 0;
      const existing = bySsid.get(ssid);
      if (!existing || existing.signal < signal) {
        bySsid.set(ssid, { ssid, signal, security: security || '' });
      }
    }

    return Array.from(bySsid.values()).sort((a, b) => b.signal - a.signal);
  } catch (e) {
    console.error('扫描WiFi网络失败:', e);
    return [];
  }
};

/**
 * 连接到指定的WiFi网络 (依赖 NetworkManager 的 nmcli)
 * @param {string} ssid
 * @param {string} [password]
 * @returns {Promise<{success: boolean, message: string}>}
 */
export const connectWifiNetwork = async (ssid, password = '') => {
  if (!ssid) {
    return { success: false, message: 'No network selected' };
  }

  const escapedSsid = ssid.replace(/"/g, '\\"');
  const command = password
    ? `nmcli dev wifi connect "${escapedSsid}" password "${password.replace(/"/g, '\\"')}" 2>&1`
    : `nmcli dev wifi connect "${escapedSsid}" 2>&1`;

  try {
    const res = await executeCommand(command);
    const output = (res || '').trim();
    const success = /successfully activated|already active/i.test(output);
    return {
      success,
      message: output || (success ? 'Connected' : 'Failed to connect')
    };
  } catch (e) {
    console.error('连接WiFi网络失败:', e);
    return { success: false, message: e.message || 'Failed to connect' };
  }
};

/**
 * 获取电池信息
 * @returns {Promise<{percentage: number, voltage: number, temperature: number}>} 电池信息
 */
export const getBatteryInfo = async () => {
  // Many embedded/SBC Linux devices have no battery at all - that's expected,
  // not an error, so this just resolves to zeros in that case.
  try {
    const batteryDir = (await executeCommand(
      "ls /sys/class/power_supply/ 2>/dev/null | grep -i -m1 bat"
    )).trim();

    if (!batteryDir) {
      return { percentage: 0, voltage: 0, temperature: 0 };
    }

    const base = `/sys/class/power_supply/${batteryDir}`;
    const [capacity, voltageNow, temp] = await Promise.all([
      executeCommand(`cat ${base}/capacity 2>/dev/null`),
      executeCommand(`cat ${base}/voltage_now 2>/dev/null`),
      executeCommand(`cat ${base}/temp 2>/dev/null`)
    ]);

    const percentage = parseInt(capacity, 10) || 0;
    const voltage = (parseInt(voltageNow, 10) || 0) / 1000000; // microvolts -> volts
    const temperature = (parseInt(temp, 10) || 0) / 10; // decidegrees -> degrees C

    return { percentage, voltage, temperature };
  } catch (e) {
    console.error('获取电池信息失败:', e);
    return { percentage: 0, voltage: 0, temperature: 0 };
  }
};

/**
 * 获取存储信息
 * @returns {Promise<{total: string, used: string, usedRate: number}>} 存储信息
 */
export const getStorageInfo = async () => {
  try {
    // Root filesystem, not Android's /data mount point (doesn't exist on generic Linux)
    const res = await executeCommand("df -h / | tail -n 1");

    if (res) {
      const parts = res.trim().split(/\s+/);
      // Filesystem Size Used Avail Use% Mounted-on
      if (parts.length >= 5) {
        const usedRate = parseInt(parts[4], 10);
        return {
          total: parts[1],
          used: parts[2],
          usedRate: Number.isNaN(usedRate) ? 0 : usedRate,
        };
      }
    }
  } catch (e) {
    console.error('获取存储信息失败:', e);
  }
  
  return { total: '0G', used: '0G', usedRate: 0 };
};

/**
 * 获取CPU频率数据
 * @returns {Promise<Array<{timestamp: number, frequency: number}>>} CPU频率数据
 */
export const getCpuFrequencyData = async () => {
  const data = [];
  try {
    const res = await executeCommand('cat /sys/devices/system/cpu/cpu0/cpufreq/scaling_cur_freq');
    if (res) {
      const freq = parseInt(res.trim(), 10);
      data.push({ timestamp: Date.now(), frequency: freq / 1000 }); // 以MHz为单位
    }
  } catch (e) {
    console.warn('获取CPU频率数据失败:', e);
  }
  return data;
};

/**
 * 获取内存使用数据
 * @returns {Promise<Array<{timestamp: number, memory: number}>>} 内存使用数据
 */
export const getMemoryUsageData = async () => {
  const data = [];
  try {
    const res = await executeCommand('free -m | awk \'NR==2\' | awk \'{print $3}\''); // 获取已使用内存
    if (res) {
      const usedMemory = parseInt(res.trim(), 10);
      data.push({ timestamp: Date.now(), memory: usedMemory });
    }
  } catch (e) {
    console.warn('获取内存使用数据失败:', e);
  }
  return data;
};

/**
 * 根据电池百分比获取颜色
 * @param {number} percentage - 电池百分比
 * @returns {string} - 颜色代码
 */
export const getBatteryColor = (percentage) => {
  if (percentage >= 70) {
    return '#4CAF50'; // 绿色
  } else if (percentage >= 30) {
    return '#FF9800'; // 橙色
  } else {
    return '#F44336'; // 红色
  }
};

/**
 * 根据温度获取颜色
 * @param {number} temperature - 温度值（摄氏度）
 * @returns {string} - 颜色代码
 */
export const getTemperatureColor = (temperature) => {
  if (temperature <= 30) {
    return '#4CAF50'; // 绿色
  } else if (temperature <= 40) {
    return '#FF9800'; // 橙色
  } else {
    return '#F44336'; // 红色
  }
};

/**
 * 根据百分比获取进度条颜色
 * @param {number} percentage - 百分比值
 * @returns {string} - 颜色代码
 */
export const getProgressColor = (percentage) => {
  if (percentage <= 70) {
    return '#4CAF50'; // 绿色
  } else if (percentage <= 90) {
    return '#FF9800'; // 橙色
  } else {
    return '#F44336'; // 红色
  }
}; 