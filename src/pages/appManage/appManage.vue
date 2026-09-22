<template>
  <div class="mx-4">
    <div class="d-flex justify-content-between">
      <el-space>
        <el-input v-model="searchPackage" :style="{width: width - 180 + 'px'}" placeholder="Search by app name or package name">
          <template #prefix>
            <span>🔍</span>
          </template>
        </el-input>
      </el-space>
      <el-space>
        <el-button type="primary" @click="getAppIcon">Initialize</el-button>
      </el-space>
    </div>


    <el-space class="mt-4" :size="40">
      <el-space style="cursor: pointer" @click="uninstallApp">
        <SvgIcon icon="packageDelete"/>
        <span>Uninstall</span>
      </el-space>
      <el-space style="cursor: pointer" @click="backupApp">
        <SvgIcon icon="packageSave"/>
        <span>Backup</span>
      </el-space>
      <el-space style="cursor: pointer" @click="exportApk">
        <SvgIcon icon="packageExport"/>
        <span>Export APK</span>
      </el-space>
      <el-space style="cursor: pointer" @click="showAppDetails">
        <SvgIcon icon="packageInfo"/>
        <span>Details</span>
      </el-space>
    </el-space>
    <div class="card mt-4">
      <div class="card-header">
        <el-row :gutter="10">
          <el-col :span="10">
            <el-space>
              <el-icon v-if="selectStatus === 0" style="margin-right: 50px;margin-left: 10px;cursor: pointer" :size="20"
                       @click="handleSelectAll">
                <CircleCheck/>
              </el-icon>
              <el-icon v-if="selectStatus === 2 || selectStatus === 3"
                       style="margin-right: 50px;margin-left: 10px;cursor: pointer" :size="20"
                       color="#409EFF" @click="handleSelectAll">
                <RemoveFilled/>
              </el-icon>
              <el-icon v-if="selectStatus === 1" style="margin-right: 50px;margin-left: 10px;cursor: pointer" :size="20"
                       color="#409EFF" @click="handleSelectAll">
                <CircleCheckFilled/>
              </el-icon>

              <span>Name</span>
              <el-icon v-if="sortType === 'desc'" :size="18" style="cursor: pointer" @click="sortFileList('asc')">
                <Bottom/>
              </el-icon>
              <el-icon v-else :size="18" style="cursor: pointer;margin-top: 3px" @click="sortFileList('desc')">
                <Top/>
              </el-icon>
            </el-space>
          </el-col>
          <el-col :span="14">
            <span style="margin-right: 45px">Source</span>
            <span>Size</span>
            <div style="margin-left: 160px; margin-top: -24px" class="d-flex justify-content-between">
              <span>Install Time</span>
              <span>Last Used</span>
              <span style="margin-right: 15px">Operations</span>
            </div>
          </el-col>
        </el-row>
      </div>
      <el-scrollbar :style="{height: height-250 + 'px'}">
        <div class="card-body">
          <div v-if="appItemList.length > 0">

            <el-row
                v-for="(appItem, index) in appItemList"
                :key="index" class="fileItemCss"
                :style="appItem.isSelect?{backgroundColor: '#d1dbf5'}:''"
                :gutter="10"
                style="margin-left: -16px; margin-right: -16px" @click="getCurrentAppItem(appItem)">
              <el-col :span="10">
                <el-space>
                  <div v-if="appItem.isSelect" @click.stop="handelSelectItem(appItem)"
                       style="margin-right: 14px;margin-left: 21px;margin-top: -3px">
                    <SvgIcon icon="RoundCheckIcon" color="#409EFF"/>
                  </div>
                  <div v-else class="hidden-icon" @click.stop="handelSelectItem(appItem)">
                    <SvgIcon icon="RoundIcon"/>
                  </div>
                  <el-image v-if="appItem.IconBase64 === 'data:image/png;base64,' || appItem.IconBase64 === ''"
                            :src="androidPack" :style="{width: 40 + 'px', height: 40 + 'px', borderRadius: 12 +'px'}"
                            fit="fill"/>
                  <el-image v-else :src="appItem.IconBase64"
                            :style="{width: 40 + 'px', height: 40 + 'px', borderRadius: 12 +'px'}" fit="fill"/>
                  <!--                <el-avatar shape="square" :size="40" :src="appItem.IconBase64" />-->
                  <span class="fileNameCss">{{ appItem.appName }}</span>
                </el-space>
              </el-col>
              <el-col :span="14">
                <div style="margin-top: 8px">
                  <span>{{ appItem.appSource }}</span>
                </div>
                <div style="margin-left: 90px;margin-top: -25px">
                  <span v-if="appItem.numType === 8">{{ appItem.size }}</span>
                  <span v-else>--</span>
                </div>
                <div style="margin-left: 160px; margin-top: -20px" class="d-flex justify-content-between">
                  <span>{{ appItem.createTime }}</span>
                  <span>{{ appItem.modifyTime }}</span>
                  <el-popover
                      placement="right"
                      trigger="click"
                      width="170"
                      :popper-style="{padding: 7 + 'px'}"
                  >
                    <template #reference>
                      <el-icon style="margin-right: 32px; margin-left: 9px;" :size="18" @click.stop>
                        <More/>
                      </el-icon>
                    </template>
                    <template #default>
                      <el-space class="operationItemCss" @click="rightDownloadFile(appItem.name, appItem.numType)">
                        <SvgIcon style="margin-left: 9px" icon="DownloadIcon"/>
                        <span class="mx-2">Launch on Device</span>
                      </el-space>
                      <el-space class="operationItemCss" @click="renameFile(appItem.name)">
                        <SvgIcon style="margin-left: 9px" icon="RenameIcon"/>
                        <span class="mx-2">Uninstall</span>
                      </el-space>
                      <el-space class="operationItemCss" @click="deleteFileSingle(appItem.name, appItem.numType)">
                        <SvgIcon style="margin-left: 9px" icon="DeleteIcon"/>
                        <span class="mx-2">Backup</span>
                      </el-space>
                      <el-space class="operationItemCss" @click="getFileDetail(appItem.name)">
                        <SvgIcon style="margin-left: 12px" icon="InfoIcon"
                                 :style="{ width:18 + 'px', height: 18 + 'px'}"/>
                        <span style="margin-left: 9px">Export APK</span>
                      </el-space>
                      <el-space class="operationItemCss" @click="deleteFileSingle(appItem.name, appItem.numType)">
                        <SvgIcon style="margin-left: 9px" icon="DeleteIcon"/>
                        <span class="mx-2">Details</span>
                      </el-space>
                    </template>
                  </el-popover>
                </div>
              </el-col>
            </el-row>
          </div>
          <el-empty v-else description="No files"/>
        </div>
      </el-scrollbar>
    </div>
  </div>
</template>

<script setup>
import {PackageManager} from "@yume-chan/android-bin";
import {TextDecoderStream, WritableStream} from "@yume-chan/stream-extra";
import {Bottom, CircleCheck, CircleCheckFilled, More, RemoveFilled, Search, Top} from '@element-plus/icons-vue'
import {getAdbInstance} from "@/utils/adbManager.js";
import SvgIcon from "@/components/SvgIcon.vue";
import useWindowResize from "@/utils/useWindowResize.js";
import androidPack from '@/assets/img/androidPack.png';
import {pushServerAndStartScrcpyClient} from "@/utils/adbUtils.js";

const {width, height} = useWindowResize()
const searchPackage = ref("");
const selectStatus = ref(0);
const sortType = ref("desc");
const appItemList = ref([])
let socket;
let writer;
const appList = ref([])
const appInfoList = ref([])

const handleSelectAll = () => {
  console.log('Select All')
  if (selectStatus.value === 0) {
    appItemList.value.forEach((appItem) => {
      appItem.isSelect = true
    })
  } else {
    appItemList.value.forEach((appItem) => {
      appItem.isSelect = false
    })
  }
}

// App operation functions
const uninstallApp = () => {
  ElMessage.info('Uninstall feature under development')
}

const backupApp = () => {
  ElMessage.info('Backup feature under development')
}

const exportApk = () => {
  ElMessage.info('Export APK feature under development')
}

const showAppDetails = () => {
  ElMessage.info('View app details feature under development')
}

const testReadAppInfo = async () => {
  let adb = await getAdbInstance();
  let isServiceRunning = false
  console.log("Checking if service is started")
  
  let process;
  if (adb.subprocess.shellProtocol?.isSupported) {
    process = await adb.subprocess.shellProtocol.spawn("top -b -n 1 | grep app_process");
  } else {
    process = await adb.subprocess.noneProtocol.spawn("top -b -n 1 | grep app_process");
  }
  
  await process.stdout.pipeThrough(new TextDecoderStream()).pipeTo(
      new WritableStream({
        write(chunk) {
          if (chunk.includes("com.lyx.myapplication.Main")) {
            isServiceRunning = true
            console.log("Service already started, no additional startup needed")
          }
        },
      }),
  );
  if (!isServiceRunning) {
    console.log("Service not started, attempting to start service")
    console.log("Preparing to push apkans.jar")
    await pushServerAndStartScrcpyClient(adb, '/apkans.jar', false)
    
    if (adb.subprocess.shellProtocol?.isSupported) {
      await adb.subprocess.shellProtocol.spawn(
          "CLASSPATH=/data/local/tmp/apkans.jar nohup app_process / com.lyx.myapplication.Main > /dev/null 2>&1 &"
      );
    } else {
      await adb.subprocess.noneProtocol.spawn(
          "CLASSPATH=/data/local/tmp/apkans.jar nohup app_process / com.lyx.myapplication.Main > /dev/null 2>&1 &"
      );
    }
    
    let checkProcess;
    if (adb.subprocess.shellProtocol?.isSupported) {
      checkProcess = await adb.subprocess.shellProtocol.spawn("top -b -n 1 | grep app_process");
    } else {
      checkProcess = await adb.subprocess.noneProtocol.spawn("top -b -n 1 | grep app_process");
    }
    
    await checkProcess.stdout.pipeThrough(new TextDecoderStream()).pipeTo(
        new WritableStream({
          write(chunk) {
            if (chunk.includes("com.lyx.myapplication.Main")) {
              console.log("Service currently started")
            }
          },
        }),
    );
  }
};

// Client starts socket connection
const testSocket = async () => {
  console.log("Starting socket connection");
  const maxRetries = 5; // Max retries
  const retryInterval = 1000; // Retry interval (milliseconds)

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      let adb = await getAdbInstance();
      // Create socket connection to Android device port
      socket = await adb.createSocket("tcp:4521");
      console.log("Socket connection successful");
      const decoder = new TextDecoder("utf-8");

      let currentAppInfo = '';

      await socket.readable.pipeTo(
          new WritableStream({
            write(chunk) {
              const decodedChunk = decoder.decode(chunk);
              if (decodedChunk.startsWith("appName: ")) {
                if (currentAppInfo) {
                  appInfoList.value.push(currentAppInfo);
                  currentAppInfo = '';
                }
                currentAppInfo = decodedChunk;
              } else {
                currentAppInfo += decodedChunk;
              }
            },
            close() {
              if (currentAppInfo) {
                appInfoList.value.push(currentAppInfo);
              }
            }
          })
      );
      return; // Exit loop after successful connection
    } catch (error) {
      console.error(`Attempt ${attempt} to create socket failed:`, error);
      if (attempt < maxRetries) {
        console.log(`Will retry in ${retryInterval / 1000} seconds...`);
        await new Promise(resolve => setTimeout(resolve, retryInterval));
      } else {
        console.error("Max retry attempts reached, giving up connection");
        throw error; // Throw error after max retry attempts
      }
    }
  }
}


const testAppInfoList = async () => {
  appInfoList.value.forEach((item, index) => {
    const parts = item.split('iconBase64:');
    const appInfo = {};

    // Parse non-IconBase64 part
    const lines = parts[0].split('\n').filter(line => line.trim() !== '');
    lines.forEach(line => {
      const [key, value] = line.split(': ').map(part => part.trim());
      appInfo[key] = value;
    });

    // Parse IconBase64 part
    if (parts.length > 1) {
      appInfo.IconBase64 = parts[1].trim();
    }

    appItemList.value.push(appInfo);
  });
  appList.value.forEach(item => {
    appItemList.value.forEach(item2 => {
      if (item.packageName === item2.packageName) {
        // Merge item content to item2
        Object.assign(item2, item);
        if (item2.sourceDir.startsWith('/data/app/')) {
          item2.appSource = 'Local App';
        } else if (item.sourceDir.startsWith('/system')) {
          item2.appSource = 'System App';
        } else {
          item2.appSource = 'Unknown';
        }
      }
    })
  })

  console.log(appItemList.value);
  socket.close();
}

const sendPackage = async (path) => {
  writer = socket.writable.getWriter();
  console.log("Test sending message");
  await writer.write(new TextEncoder().encode(path));
  await writer.write(new TextEncoder().encode("\r"));
  console.log("Data sent successfully");
  writer.releaseLock();
}
const getCurrentAppItem = (name) => {
  console.log(name)
}

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const initPmObj = async (isShowThirdParty = true) => {
  console.log("Initialize app manager");
  let adb = await getAdbInstance();
  const pm = new PackageManager(adb);
  const options = {
    showSourceDir: true,
    showVersionCode: true,
    showInstaller: true,
    listThirdParty: isShowThirdParty
  };
  const packageList = pm.listPackages(options);
  console.log("Get simple list via app manager")
  await testReadAppInfo()

  for await (const packages of packageList) {
    console.log(packages);
    console.log("Package Name:", packages.packageName);
    console.log("Source sourceDir:", packages.sourceDir || "Unknown");
    console.log("Version Code:", packages.versionCode || "Unknown");
    console.log("Installer:", packages.installer || "Unknown");
    console.log("UID:", packages.uid || "Unknown");
    console.log("---------------------");
    appList.value.push({
      packageName: packages.packageName,
      versionCode: packages.versionCode,
      sourceDir: packages.sourceDir,
      installer: packages.installer,
      isSelect: false
    });
  }
  console.log("Total number of apps", appList.value.length);
  await testSocket()
};
const getAppIcon = async () => {
  for (let i = 0; i < appList.value.length; i++) {
    console.log("Send message", i, "th message", appList.value[i].sourceDir);
    await sendPackage(appList.value[i].sourceDir);
    // Wait 500ms after sending one message before sending the next
    await delay(100);
  }
  await testAppInfoList()
};
onMounted(() => {
  initPmObj();
})
</script>

<style scoped>
.fileItemCss {
  cursor: pointer;
  height: 50px;
  transition: background-color 0.3s;
  align-content: center;

  &:hover {
    background-color: #dedfe0;
  }
}

/* New rule: Hide SvgIcon by default */
.hidden-icon {
  margin-right: 14px;
  margin-left: 21px;
  margin-top: -3px;
  opacity: 0;
  transition: opacity 0.3s; /* Add transition effect */
}

/* New rule: Show .hidden-icon on hover */
.fileItemCss:hover .hidden-icon {
  opacity: 1; /* 完全可见 */
}

.operationItemCss {
  cursor: pointer;
  height: 40px;
  width: 154px;
  border-radius: 6px;
  transition: background-color 0.3s;

  &:hover {
    background-color: #dedfe0;
  }
}
</style>