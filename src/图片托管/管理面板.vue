<template>
  <div class="image-hosting-panel" :class="{ 'is-desktop': isDesktop }">
    <!-- ======== 左侧面板: 设置/统计/导入导出 ======== -->
    <div class="panel-left">
      <div class="image-hosting_header">
        <b><i class="fa-solid fa-images"></i> 图片托管</b>
      </div>

      <!-- 当前角色卡名 -->
      <div class="image-hosting_block flex-container flexFlowColumn" style="margin-bottom: 15px;">
        <small style="opacity:0.7; font-size: 11px; letter-spacing: 0.5px; text-transform: uppercase;">当前角色卡</small>
        <div class="image-hosting_character-badge">
          <i class="fa-solid fa-user-astronaut"></i>
          <b>{{ characterName }}</b>
        </div>
      </div>

      <!-- 使用统计 -->
      <div v-if="images.length > 0" class="image-hosting_stats">
        <div class="image-hosting_stat-item">
          <div class="stat-icon"><i class="fa-solid fa-images"></i></div>
          <div class="stat-content">
            <span class="stat-label">总图片</span>
            <span class="stat-value">{{ images.length }}</span>
          </div>
        </div>
        <div class="image-hosting_stat-item">
          <div class="stat-icon"><i class="fa-solid fa-hard-drive"></i></div>
          <div class="stat-content">
            <span class="stat-label">总占用</span>
            <span class="stat-value">{{ formatSize(totalSize) }}</span>
          </div>
        </div>
        <div class="image-hosting_stat-item">
          <div class="stat-icon"><i class="fa-solid fa-server"></i></div>
          <div class="stat-content">
            <span class="stat-label">存储分布</span>
            <span class="stat-value">{{ localCount }} 本地 / {{ embeddedCount }} 嵌入 / {{ remoteCount }} 远程</span>
          </div>
        </div>
      </div>

      <!-- 存储模式 -->
      <div class="image-hosting_block image-hosting_glass-card">
        <div class="flex-container" style="align-items: center; justify-content: space-between;">
          <label style="font-weight: 600; font-size: 13px;">存储模式</label>
          <select v-model="settings.storage_mode" class="image-hosting_select">
            <option value="local">📁 本地文件 (需额外分享)</option>
            <option value="embedded">📦 嵌入角色卡 (自动分享)</option>
            <option value="remote">🌐 远程图床 (URL)</option>
          </select>
        </div>
        <div v-if="settings.storage_mode === 'embedded'" class="image-hosting_hint-text">
          <i class="fa-solid fa-circle-info"></i> 图片数据将使用 Base64 嵌入角色卡变量，导出卡片时自动包含。
        </div>
        <div v-if="settings.storage_mode === 'remote'" class="image-hosting_hint-text">
          <i class="fa-solid fa-circle-info"></i> 填入图片 URL，元数据存入角色卡。用户导入后直接从远程加载。
        </div>
      </div>

      <!-- CDN 代理设置 (remote 模式) -->
      <div v-if="settings.storage_mode === 'remote'" class="image-hosting_block image-hosting_glass-card">
        <label class="image-hosting_toggle-row">
          <div class="toggle-info">
            <span class="toggle-title">CDN 代理加速</span>
            <span class="toggle-desc">原始 URL 不可用时自动通过代理加载</span>
          </div>
          <div class="st-checkbox-wrapper">
            <input v-model="settings.cdn_proxy_enabled" type="checkbox" class="st-checkbox" />
            <div class="st-checkbox-slider"></div>
          </div>
        </label>

        <label class="image-hosting_toggle-row" style="margin-top: 10px;">
          <div class="toggle-info">
            <span class="toggle-title">本地缓存</span>
            <span class="toggle-desc">首次加载后保存到本地，之后不再远程拉取</span>
          </div>
          <div class="st-checkbox-wrapper">
            <input v-model="settings.remote_cache_local" type="checkbox" class="st-checkbox" />
            <div class="st-checkbox-slider"></div>
          </div>
        </label>

        <!-- 缓存清理 -->
        <div v-if="settings.remote_cache_local" class="cdn-speed-panel" style="margin-top: 8px; padding-top: 8px;">
          <div class="cdn-speed-header">
            <div style="display: flex; align-items: center; gap: 6px;">
              <span class="toggle-title" style="font-size: 12px">清理缓存</span>
              <input
                v-model.number="cleanupDays"
                type="number"
                min="0"
                class="search-input"
                style="width: 50px; font-size: 11px; padding: 2px 6px; text-align: center"
                placeholder="天"
              />
              <span style="font-size: 11px; color: var(--text-muted)">天前</span>
            </div>
            <button
              class="image-hosting_btn btn-secondary"
              style="padding: 3px 10px; font-size: 11px"
              @click="handleCleanupCache"
            >
              <i class="fa-solid fa-broom"></i> 清理
            </button>
          </div>
          <span style="font-size: 10px; color: var(--text-muted); margin-top: 4px; display: block">
            设为 0 清理全部缓存；仅清理远程图片的本地缓存文件
          </span>
        </div>

        <label class="image-hosting_toggle-row" style="margin-top: 10px;">
          <div class="toggle-info">
            <span class="toggle-title">去 CDN</span>
            <span class="toggle-desc">剥离已有 CDN 外壳，用自己配置的代理替换</span>
          </div>
          <div class="st-checkbox-wrapper">
            <input v-model="settings.cdn_strip_enabled" type="checkbox" class="st-checkbox" />
            <div class="st-checkbox-slider"></div>
          </div>
        </label>

        <!-- CDN 测速面板 -->
        <div v-if="settings.cdn_proxy_enabled" class="cdn-speed-panel">
          <div class="cdn-speed-header">
            <span class="toggle-title" style="font-size: 12px">代理测速</span>
            <div style="display: flex; gap: 6px; align-items: center">
              <button
                class="image-hosting_btn btn-secondary"
                style="padding: 3px 10px; font-size: 11px"
                :disabled="speedTesting"
                @click="runSpeedTest"
              >
                <i class="fa-solid" :class="speedTesting ? 'fa-spinner fa-spin' : 'fa-gauge-high'"></i>
                {{ speedTesting ? '测速中...' : '测速' }}
              </button>
              <button
                v-if="settings.cdn_preferred_proxy"
                class="image-hosting_btn btn-secondary"
                style="padding: 3px 8px; font-size: 11px"
                title="清除锚定"
                @click="settings.cdn_preferred_proxy = ''"
              >
                <i class="fa-solid fa-rotate-left"></i>
              </button>
            </div>
          </div>

          <div class="cdn-proxy-list">
            <!-- 直连 -->
            <div class="cdn-proxy-item" :class="{ 'is-preferred': !settings.cdn_preferred_proxy }">
              <span class="proxy-name">🔗 直连 (原始 URL)</span>
              <span v-if="speedResults['__direct__'] !== undefined" class="proxy-latency" :class="latencyClass(speedResults['__direct__'])">
                {{ speedResults['__direct__'] >= 0 ? speedResults['__direct__'] + 'ms' : '超时' }}
              </span>
            </div>
            <!-- 代理列表 -->
            <div
              v-for="(proxy, idx) in settings.cdn_proxy_list"
              :key="idx"
              class="cdn-proxy-item"
              :class="{ 'is-preferred': settings.cdn_preferred_proxy === proxy }"
              @click="settings.cdn_preferred_proxy = proxy"
            >
              <span class="proxy-name">{{ proxyDisplayName(proxy) }}</span>
              <div style="display: flex; align-items: center; gap: 6px">
                <span v-if="speedResults[proxy] !== undefined" class="proxy-latency" :class="latencyClass(speedResults[proxy])">
                  {{ speedResults[proxy] >= 0 ? speedResults[proxy] + 'ms' : '超时' }}
                </span>
                <i v-if="settings.cdn_preferred_proxy === proxy" class="fa-solid fa-anchor" style="font-size: 10px; color: var(--primary-color)" title="已锚定"></i>
                <button class="proxy-delete-btn" title="删除" @click.stop="removeProxy(idx)">
                  <i class="fa-solid fa-xmark"></i>
                </button>
              </div>
            </div>

            <!-- 添加新代理 -->
            <div class="cdn-proxy-add">
              <input
                v-model="newProxyTemplate"
                class="search-input remote-input"
                placeholder="模板 URL（{url}=编码 / {raw}=去协议头）"
                style="font-size: 11px"
                @keyup.enter="addProxy"
              />
              <button class="image-hosting_btn btn-primary" style="flex: 0 0 auto; padding: 4px 10px; font-size: 11px;" @click="addProxy">
                <i class="fa-solid fa-plus"></i>
              </button>
            </div>
          </div>
        </div>
      </div>

      <!-- 设置区域 -->
      <div class="image-hosting_block image-hosting_glass-card">
        <label class="image-hosting_toggle-row">
          <div class="toggle-info">
            <span class="toggle-title">开启上传压缩</span>
            <span class="toggle-desc">自动将图片压缩并转换为 WebP 格式</span>
          </div>
          <div class="st-checkbox-wrapper">
            <input v-model="settings.auto_compress" type="checkbox" class="st-checkbox" />
            <div class="st-checkbox-slider"></div>
          </div>
        </label>
        
        <div v-if="settings.auto_compress" class="image-hosting_quality-slider">
          <div class="slider-header">
            <label>压缩质量</label>
            <span class="quality-badge">{{ Math.round(settings.compress_quality * 100) }}%</span>
          </div>
          <input
            v-model.number="settings.compress_quality"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            class="image-hosting_range"
          />
        </div>
      </div>

      <!-- 导入导出按钮 (仅 local 模式) -->
      <div v-if="settings.storage_mode === 'local'" class="image-hosting_block flex-container" style="gap: 10px;">
        <button class="image-hosting_btn btn-primary" @click="handleExport">
          <i class="fa-solid fa-file-export"></i> 导出图片包
        </button>
        <button class="image-hosting_btn btn-secondary" @click="handleImport">
          <i class="fa-solid fa-file-import"></i> 导入图片包
        </button>
      </div>

      <!-- 移动端: 上传区域在左侧 (非 remote 模式) -->
      <div v-if="!isDesktop && settings.storage_mode !== 'remote'" class="image-hosting_block">
        <div
          class="image-hosting_dropzone"
          :class="{ 'image-hosting_dropzone--active': isDragging, 'image-hosting_dropzone--uploading': uploading }"
          @dragover.prevent="isDragging = true"
          @dragleave.prevent="isDragging = false"
          @drop.prevent="handleDrop"
          @click="triggerFileInput"
        >
          <div class="dropzone-icon">
            <i class="fa-solid" :class="uploading ? 'fa-spinner fa-spin' : 'fa-cloud-arrow-up'"></i>
          </div>
          <div class="dropzone-text">
            <span class="primary-text">{{ uploading ? `正在上传 (${uploadProgress})` : '点击选择或拖拽图片到此处' }}</span>
            <span v-if="!uploading" class="secondary-text">支持 PNG, JPG, GIF, WebP</span>
          </div>
        </div>
      </div>

      <!-- Remote 模式: URL 输入区 (移动端在左侧) -->
      <div v-if="!isDesktop && settings.storage_mode === 'remote'" class="image-hosting_block image-hosting_glass-card">
        <div class="remote-url-form">
          <div class="remote-input-row">
            <input
              v-model="remoteDisplayName"
              class="search-input remote-input"
              placeholder="显示名称"
            />
          </div>
          <div class="remote-input-row">
            <input
              v-model="remoteUrl"
              class="search-input remote-input"
              placeholder="图片 URL (https://...)"
              @keyup.enter="handleAddRemote"
            />
            <button class="image-hosting_btn btn-primary" style="flex: 0 0 auto; padding: 6px 14px;" @click="handleAddRemote">
              <i class="fa-solid fa-plus"></i> 添加
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- ======== 右侧面板: 搜索/上传/图片画廊 ======== -->
    <div class="panel-right"
         @dragover.prevent="isDesktop && (isDragging = true)"
         @dragleave.prevent="isDesktop && (isDragging = false)"
         @drop.prevent="isDesktop && handleDrop($event)"
         :class="{ 'panel-right--dragover': isDesktop && isDragging }">

      <!-- 移动端: 分隔线 -->
      <div v-if="!isDesktop" class="image-hosting_divider"></div>

      <!-- 搜索栏 + 批量操作 -->
      <div v-if="images.length > 0" class="image-hosting_toolbar">
        <div class="image-hosting_search-box">
          <i class="fa-solid fa-magnifying-glass search-icon"></i>
          <input
            v-model="searchQuery"
            class="search-input"
            placeholder="搜索图片名称..."
          />
          <i
            v-if="searchQuery"
            class="fa-solid fa-circle-xmark clear-icon"
            @click="searchQuery = ''"
          ></i>
        </div>
        
        <div class="image-hosting_batch-bar">
          <label class="batch-checkbox">
            <input type="checkbox" :checked="isAllSelected" @change="toggleSelectAll" />
            <span>{{ isAllSelected ? '取消全选' : '全选' }}</span>
          </label>
          
          <div class="batch-actions" :class="{ 'batch-actions--active': selectedSet.size > 0 }">
            <span class="selected-count">{{ selectedSet.size }} 项</span>
            <button class="icon-action-btn copy-btn" title="批量复制调用代码" @click="handleBatchCopyCode">
              <i class="fa-solid fa-copy"></i>
            </button>
            <button class="icon-action-btn delete-btn" title="批量删除" @click="handleBatchDelete">
              <i class="fa-solid fa-trash-can"></i>
            </button>
          </div>
        </div>
      </div>

      <!-- 图片画廊 -->
      <div class="image-hosting_list-container">
        <div v-if="images.length === 0 && !isDesktop" class="image-hosting_empty-state">
          <div class="empty-icon"><i class="fa-regular fa-images"></i></div>
          <span>暂无图片，请在上方上传</span>
        </div>
        <div v-else-if="filteredImages.length === 0 && images.length > 0" class="image-hosting_empty-state">
          <div class="empty-icon"><i class="fa-solid fa-search"></i></div>
          <span>没有找到匹配的图片</span>
        </div>
        
        <TransitionGroup name="list" tag="div" class="image-hosting_grid">
          <!-- 桌面端: 上传/添加卡片融入画廊首位 -->
          <div v-if="isDesktop && settings.storage_mode !== 'remote'" key="__upload__" class="image-hosting_card upload-card" @click="triggerFileInput">
            <div class="upload-card-content">
              <i class="fa-solid" :class="uploading ? 'fa-spinner fa-spin' : 'fa-plus'" style="font-size: 24px; color: var(--primary-color)"></i>
              <span style="font-size: 13px; font-weight: 500">{{ uploading ? `上传中 (${uploadProgress})` : '添加图片' }}</span>
              <span style="font-size: 11px; color: var(--text-muted)">点击选择或拖拽到此区域</span>
            </div>
          </div>

          <!-- 桌面端 remote 模式: URL 输入卡片 -->
          <div v-if="isDesktop && settings.storage_mode === 'remote'" key="__remote_add__" class="image-hosting_card upload-card remote-add-card">
            <div class="remote-url-form" style="width: 100%">
              <input
                v-model="remoteDisplayName"
                class="search-input remote-input"
                placeholder="显示名称"
              />
              <div class="remote-input-row">
                <input
                  v-model="remoteUrl"
                  class="search-input remote-input"
                  placeholder="图片 URL"
                  @keyup.enter="handleAddRemote"
                />
                <button class="image-hosting_btn btn-primary" style="flex: 0 0 auto; padding: 5px 12px; font-size: 12px;" @click="handleAddRemote">
                  <i class="fa-solid fa-plus"></i>
                </button>
              </div>
            </div>
          </div>

          <!-- 桌面端空状态提示 (在上传卡片之后) -->
          <div v-if="isDesktop && images.length === 0" key="__empty__" class="image-hosting_card empty-hint-card">
            <div class="upload-card-content">
              <i class="fa-regular fa-images" style="font-size: 20px; opacity: 0.3"></i>
              <span style="font-size: 12px; color: var(--text-muted)">暂无图片</span>
            </div>
          </div>

          <div v-for="image in filteredImages" :key="image.storageName" 
               class="image-hosting_card"
               :class="{ 'is-selected': selectedSet.has(image.storageName) }">
            
            <div class="card-select">
              <input type="checkbox" :checked="selectedSet.has(image.storageName)" @change="toggleSelect(image.storageName)" />
            </div>
            
            <div class="card-preview" @click="openPreview(image)">
              <img :src="image.url" :alt="image.display_name" loading="lazy" />
              <div class="preview-overlay"><i class="fa-solid fa-expand"></i></div>
              <div v-if="image.storage === 'embedded'" class="embedded-badge" title="嵌入模式">
                <i class="fa-solid fa-box-archive"></i>
              </div>
            </div>
            
            <div class="card-info">
              <div class="card-name-row">
                <template v-if="editingName !== image.storageName">
                  <span class="card-name" :title="image.display_name">{{ image.display_name }}</span>
                  <button class="small-icon-btn" title="重命名" @click="startRename(image.storageName, image.display_name)">
                    <i class="fa-solid fa-pen"></i>
                  </button>
                </template>
                <template v-else>
                  <input
                    v-model="editNameValue"
                    class="name-edit-input"
                    v-focus
                    @keyup.enter="confirmRename(image.storageName)"
                    @keyup.escape="cancelRename"
                  />
                  <button class="small-icon-btn success" @click="confirmRename(image.storageName)"><i class="fa-solid fa-check"></i></button>
                  <button class="small-icon-btn danger" @click="cancelRename"><i class="fa-solid fa-xmark"></i></button>
                </template>
              </div>
              
              <div class="card-meta">
                <span>{{ formatSize(image.size) }}</span>
                <span class="meta-dot">•</span>
                <span class="meta-type">{{ image.mime_type.split('/')[1]?.toUpperCase() || 'IMG' }}</span>
              </div>
              
              <div class="card-actions">
                <button class="action-btn" @click="copyCode(image.display_name)">
                  <i class="fa-regular fa-copy"></i> 复制调用代码
                </button>
                <button class="action-btn danger-icon" title="删除" @click="handleDelete(image.storageName, image.display_name)">
                  <i class="fa-regular fa-trash-can"></i>
                </button>
              </div>
            </div>
          </div>
        </TransitionGroup>
      </div>
    </div>

    <!-- 隐藏的文件输入 -->
    <input
      ref="fileInputRef"
      type="file"
      accept="image/*"
      multiple
      style="display: none"
      @change="handleFileSelect"
    />

    <!-- 大图预览浮层 -->
    <Teleport to="body">
      <Transition name="fade">
        <div v-if="previewImage" class="image-hosting_overlay" @click.self="closePreview">
          <div class="image-hosting_preview-container">
            <button class="preview-close-btn" @click="closePreview">
              <i class="fa-solid fa-xmark"></i>
            </button>
            <img :src="previewImage.url" :alt="previewImage.display_name" />
            <div class="preview-footer">
              <div class="preview-title">{{ previewImage.display_name }}</div>
              <div class="preview-meta">
                <span><i class="fa-solid fa-hard-drive"></i> {{ formatSize(previewImage.size) }}</span>
                <span class="divider">|</span>
                <span><i class="fa-solid fa-file-code"></i> {{ previewImage.mime_type }}</span>
                <span v-if="previewImage.storage === 'embedded'" class="embedded-tag">
                  <i class="fa-solid fa-box-archive"></i> 嵌入存储
                </span>
              </div>
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useSettingsStore } from './settings';
import { useImageStore, type ImageMeta, probeImageUrl, measureProxyLatency } from './image-store';
import { exportImages, importImages } from './export-import';

// Custom directive for auto focus
const vFocus = {
  mounted: (el: HTMLInputElement) => el.focus()
}

type ImageItem = { storageName: string; url: string } & ImageMeta;

const { settings } = storeToRefs(useSettingsStore());
const imageStore = useImageStore();

const images = computed(() => imageStore.getAllImages());
const characterName = ref(substitudeMacros('{{char}}') || '未选择');

// 搜索
const searchQuery = ref('');
const filteredImages = computed(() => {
  if (!searchQuery.value.trim()) return images.value;
  const q = searchQuery.value.trim().toLowerCase();
  return images.value.filter(img =>
    img.display_name.toLowerCase().includes(q) ||
    img.original_name.toLowerCase().includes(q),
  );
});

// 使用统计
const totalSize = computed(() => _.sumBy(images.value, 'size'));
const localCount = computed(() => images.value.filter(i => i.storage === 'local').length);
const embeddedCount = computed(() => images.value.filter(i => i.storage === 'embedded').length);
const remoteCount = computed(() => images.value.filter(i => i.storage === 'remote').length);

// 缓存清理
const cleanupDays = ref(7);
async function handleCleanupCache() {
  const label = cleanupDays.value > 0 ? `${cleanupDays.value} 天前的` : '全部';
  if (!confirm(`确定清理${label}远程图片本地缓存？\n缓存清理后下次访问会重新从远程拉取。`)) return;
  const count = await imageStore.cleanupCache(cleanupDays.value);
  if (count > 0) {
    toastr.success(`已清理 ${count} 个缓存文件`);
  } else {
    toastr.info('没有需要清理的缓存');
  }
}

// 批量选择
const selectedSet = ref(new Set<string>());
const isAllSelected = computed(() =>
  filteredImages.value.length > 0 && filteredImages.value.every(img => selectedSet.value.has(img.storageName)),
);

function toggleSelect(storageName: string) {
  const s = new Set(selectedSet.value);
  if (s.has(storageName)) s.delete(storageName);
  else s.add(storageName);
  selectedSet.value = s;
}

function toggleSelectAll() {
  if (isAllSelected.value) {
    selectedSet.value = new Set();
  } else {
    selectedSet.value = new Set(filteredImages.value.map(img => img.storageName));
  }
}

// 上传状态
const uploading = ref(false);
const uploadProgress = ref('');
const isDragging = ref(false);
const fileInputRef = ref<HTMLInputElement>();

// CDN 测速
const speedTesting = ref(false);
const speedResults = ref<Record<string, number>>({});

/** 备用测速图片 (仅在没有远程图片时使用) */
const FALLBACK_TEST_IMAGE = 'https://cdn.jsdelivr.net/gh/nicehash/Logos@latest/favicon-32x32.png';

function proxyDisplayName(template: string): string {
  try {
    const url = new URL(template.replace('{url}', 'test'));
    return url.hostname;
  } catch {
    return template.slice(0, 30);
  }
}

function latencyClass(ms: number): string {
  if (ms < 0) return 'latency-timeout';
  if (ms < 500) return 'latency-fast';
  if (ms < 1500) return 'latency-medium';
  return 'latency-slow';
}

/**
 * 获取用于测速的图片 URL 列表 (从当前注册的 remote 图片中选取, 最多 3 张)
 */
function getTestImageUrls(): string[] {
  const remoteImages = images.value.filter(img => img.storage === 'remote' && img.remote_url);
  if (remoteImages.length === 0) return [FALLBACK_TEST_IMAGE];
  // 取前 3 张作为采样
  return remoteImages.slice(0, 3).map(img => img.remote_url);
}

/**
 * 对一个来源 (直连/代理) 测试多张图片, 返回平均延迟
 * @param testUrls 测试用的图片URL列表
 * @param proxyTemplate 代理模板, 空字符串表示直连
 */
async function measureAvgLatency(testUrls: string[], proxyTemplate: string): Promise<number> {
  const results: number[] = [];
  for (const url of testUrls) {
    let latency: number;
    if (proxyTemplate) {
      latency = await measureProxyLatency(proxyTemplate, url, 5000);
    } else {
      latency = await probeImageUrl(url, 5000);
    }
    results.push(latency);
  }
  // 过滤出成功的
  const valid = results.filter(r => r >= 0);
  if (valid.length === 0) return -1;
  return Math.round(valid.reduce((a, b) => a + b, 0) / valid.length);
}

async function runSpeedTest() {
  speedTesting.value = true;
  speedResults.value = {};

  const testUrls = getTestImageUrls();
  const isUsingRemote = testUrls[0] !== FALLBACK_TEST_IMAGE;

  if (isUsingRemote) {
    toastr.info(`使用 ${testUrls.length} 张远程图片进行测速...`);
  }

  // 并行测试: 直连 + 所有代理同时进行
  const proxies = settings.value.cdn_proxy_list;
  const tasks: Array<{ key: string; promise: Promise<number> }> = [
    { key: '__direct__', promise: measureAvgLatency(testUrls, '') },
    ...proxies.map(proxy => ({ key: proxy, promise: measureAvgLatency(testUrls, proxy) })),
  ];

  // 并行执行, 每个完成后实时更新 UI
  await Promise.all(
    tasks.map(async ({ key, promise }) => {
      const latency = await promise;
      speedResults.value = { ...speedResults.value, [key]: latency };
    }),
  );

  // 综合评分: 找延迟最低的
  let bestProxy = '';
  let bestLatency = speedResults.value['__direct__'];

  for (const proxy of proxies) {
    const lat = speedResults.value[proxy];
    if (lat >= 0 && (bestLatency < 0 || lat < bestLatency)) {
      bestLatency = lat;
      bestProxy = proxy;
    }
  }

  settings.value.cdn_preferred_proxy = bestProxy;
  speedTesting.value = false;

  if (bestProxy) {
    toastr.success(`已自动锚定最快代理: ${proxyDisplayName(bestProxy)} (${bestLatency}ms)`);
  } else if (bestLatency >= 0) {
    toastr.success(`直连最快 (${bestLatency}ms)，无需代理`);
  } else {
    toastr.warning('所有代理均超时');
  }
}

// 代理列表管理
const newProxyTemplate = ref('');

function addProxy() {
  const tpl = newProxyTemplate.value.trim();
  if (!tpl) return;
  if (!tpl.includes('{url}') && !tpl.includes('{raw}')) {
    toastr.warning('模板必须包含 {url} 或 {raw} 占位符');
    return;
  }
  if (settings.value.cdn_proxy_list.includes(tpl)) {
    toastr.warning('该代理已存在');
    return;
  }
  settings.value.cdn_proxy_list.push(tpl);
  newProxyTemplate.value = '';
  toastr.success(`已添加代理: ${proxyDisplayName(tpl)}`);
}

function removeProxy(idx: number) {
  const removed = settings.value.cdn_proxy_list.splice(idx, 1)[0];
  if (settings.value.cdn_preferred_proxy === removed) {
    settings.value.cdn_preferred_proxy = '';
  }
  toastr.info(`已移除代理: ${proxyDisplayName(removed)}`);
}

// 远程 URL 输入
const remoteDisplayName = ref('');
const remoteUrl = ref('');

function handleAddRemote() {
  const url = remoteUrl.value.trim();
  if (!url) {
    toastr.warning('请输入图片 URL');
    return;
  }
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    toastr.warning('URL 必须以 http:// 或 https:// 开头');
    return;
  }
  const name = remoteDisplayName.value.trim() || url.split('/').pop()?.split('?')[0] || 'remote-image';
  imageStore.addRemote(name, url);
  toastr.success(`已添加远程图片「${name}」`);
  remoteDisplayName.value = '';
  remoteUrl.value = '';
}

// 重命名状态
const editingName = ref<string | null>(null);
const editNameValue = ref('');

// 大图预览状态
const previewImage = ref<ImageItem | null>(null);

// 横竖屏检测: 使用 parent window (脚本运行在 iframe 中, 自身 window 尺寸不可靠)
const parentWin = window.parent;
const isDesktop = ref(parentWin.innerWidth > parentWin.innerHeight);
function updateOrientation() {
  isDesktop.value = parentWin.innerWidth > parentWin.innerHeight;
}
parentWin.addEventListener('resize', updateOrientation);
onUnmounted(() => parentWin.removeEventListener('resize', updateOrientation));

// 注: reloadOnChatChange() 会在聊天切换时重载整个脚本 iframe,
// 因此无需在 Vue 组件内单独监听 CHAT_CHANGED

function triggerFileInput() {
  if (uploading.value) return;
  fileInputRef.value?.click();
}

async function uploadFiles(files: FileList | File[]) {
  if (uploading.value) return;
  uploading.value = true;
  let success = 0;
  let failed = 0;
  const total = files.length;

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      toastr.warning(`'${file.name}' 不是图片文件, 已跳过`);
      continue;
    }

    try {
      uploadProgress.value = `${success + failed + 1}/${total}`;
      await imageStore.upload(file);
      success++;
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.error(`上传 '${file.name}' 失败:`, msg);
      toastr.error(`上传 '${file.name}' 失败: ${msg}`);
    }
  }

  uploading.value = false;
  if (success > 0) {
    toastr.success(`成功上传 ${success}/${total} 张图片${failed > 0 ? ` (${failed} 张失败)` : ''}`);
  } else if (failed > 0) {
    toastr.error(`全部上传失败 (${failed} 张)`);
  }

  // embedded 模式下检查总大小, 超过 10MB 时提醒用户
  if (settings.value.storage_mode === 'embedded') {
    const currentTotal = images.value.reduce((sum, img) => sum + img.size, 0);
    const WARN_THRESHOLD = 10 * 1024 * 1024; // 10MB
    if (currentTotal > WARN_THRESHOLD) {
      toastr.warning(
        `嵌入总大小已达 ${formatSize(currentTotal)}, 过大可能影响角色卡性能。建议切换到本地模式或压缩图片。`,
        '嵌入容量提醒',
        { timeOut: 8000 },
      );
    }
  }
}

function handleDrop(event: DragEvent) {
  isDragging.value = false;
  const files = event.dataTransfer?.files;
  if (files && files.length > 0) {
    uploadFiles(files);
  }
}

function handleFileSelect(event: Event) {
  const target = event.target as HTMLInputElement;
  if (target.files && target.files.length > 0) {
    uploadFiles(target.files);
    target.value = '';
  }
}

function startRename(storageName: string, currentName: string) {
  editingName.value = storageName;
  editNameValue.value = currentName;
}

function confirmRename(storageName: string) {
  if (editNameValue.value.trim()) {
    imageStore.rename(storageName, editNameValue.value.trim());
  }
  editingName.value = null;
}

function cancelRename() {
  editingName.value = null;
}

async function handleDelete(storageName: string, displayName: string) {
  const result = await SillyTavern.callGenericPopup(
    `确定要删除图片「${displayName}」吗？`,
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (result === SillyTavern.POPUP_RESULT.AFFIRMATIVE) {
    await imageStore.remove(storageName);
    selectedSet.value.delete(storageName);
    toastr.success(`已删除「${displayName}」`);
  }
}

async function handleBatchDelete() {
  const count = selectedSet.value.size;
  if (count === 0) return;
  const result = await SillyTavern.callGenericPopup(
    `确定要删除选中的 ${count} 张图片吗？`,
    SillyTavern.POPUP_TYPE.CONFIRM,
  );
  if (result === SillyTavern.POPUP_RESULT.AFFIRMATIVE) {
    const names = [...selectedSet.value];
    for (const name of names) {
      await imageStore.remove(name);
    }
    selectedSet.value = new Set();
    toastr.success(`已删除 ${names.length} 张图片`);
  }
}

function copyToClipboard(text: string): void {
  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(
      () => toastr.success('已复制调用代码'),
      () => fallbackCopy(text),
    );
  } else {
    fallbackCopy(text);
  }
}

function fallbackCopy(text: string): void {
  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.style.cssText = 'position:fixed;opacity:0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
  toastr.success('已复制调用代码');
}

function copyCode(displayName: string) {
  copyToClipboard(`<img data-img="${displayName}">`);
}

function handleBatchCopyCode() {
  const codes = filteredImages.value
    .filter(img => selectedSet.value.has(img.storageName))
    .map(img => `<img data-img="${img.display_name}">`)
    .join('\n');
  copyToClipboard(codes);
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 大图预览
function openPreview(image: ImageItem) {
  previewImage.value = image;
}

function closePreview() {
  previewImage.value = null;
}

async function handleExport() {
  await exportImages();
}

async function handleImport() {
  await importImages();
}
</script>

<style scoped>
/* Base Variables & Theme Integration */
.image-hosting-panel {
  --primary-color: var(--SmartThemeQuoteColor, #3498db);
  --primary-hover: var(--SmartThemeMessageTextColor, #2980b9);
  --bg-color: var(--SmartThemeBlurTintColor, rgba(30, 30, 35, 0.6));
  --card-bg: rgba(255, 255, 255, 0.04);
  --card-hover: rgba(255, 255, 255, 0.08);
  --border-color: var(--SmartThemeBorderColor, rgba(255, 255, 255, 0.1));
  --text-main: var(--SmartThemeBodyDisplayColor, #eee);
  --text-muted: rgba(255, 255, 255, 0.5);
  --danger-color: #ff5b5b;
  --success-color: #20c997;
  
  color: var(--text-main);
  font-family: 'Inter', system-ui, -apple-system, sans-serif;
  display: flex;
  flex-direction: column;
  height: 100%;
}

* {
  box-sizing: border-box;
}

/* Header */
.image-hosting_header {
  font-size: 18px;
  font-weight: 600;
  padding-bottom: 12px;
  margin-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  gap: 8px;
  color: var(--primary-color);
}

/* Character Badge */
.image-hosting_character-badge {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  background: linear-gradient(135deg, var(--card-bg), rgba(255,255,255,0.01));
  border: 1px solid var(--border-color);
  padding: 8px 12px;
  border-radius: 8px;
  font-size: 14px;
  margin-top: 4px;
  backdrop-filter: blur(4px);
  box-shadow: 0 2px 8px rgba(0,0,0,0.1);
}
.image-hosting_character-badge i { color: var(--primary-color); }

/* Glass Cards */
.image-hosting_glass-card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 12px;
  margin-bottom: 12px;
  backdrop-filter: blur(8px);
  transition: background 0.2s;
}

/* Base Blocks */
.image-hosting_block {
  margin-bottom: 12px;
}
.image-hosting_divider {
  height: 1px;
  background: var(--border-color);
  margin: 16px 0;
}

/* Stats Row */
.image-hosting_stats {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 10px;
  margin-bottom: 16px;
}
.image-hosting_stat-item {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 8px;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 10px;
  transition: transform 0.2s;
}
.image-hosting_stat-item:hover {
  transform: translateY(-2px);
  background: var(--card-hover);
}
.stat-icon {
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: rgba(255,255,255,0.05);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 14px;
  color: var(--primary-color);
}
.stat-content {
  display: flex;
  flex-direction: column;
}
.stat-label {
  font-size: 11px;
  color: var(--text-muted);
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
.stat-value {
  font-size: 13px;
  font-weight: 600;
}

/* Form Controls */
.image-hosting_select {
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--border-color);
  color: var(--text-main);
  padding: 6px 12px;
  border-radius: 6px;
  font-size: 13px;
  outline: none;
  cursor: pointer;
  transition: border-color 0.2s;
}
.image-hosting_select:focus {
  border-color: var(--primary-color);
}

.image-hosting_hint-text {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 8px;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: rgba(255,255,255,0.03);
  border-radius: 6px;
}

/* Custom Toggle */
.image-hosting_toggle-row {
  display: flex;
  justify-content: space-between;
  align-items: center;
  cursor: pointer;
}
.toggle-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}
.toggle-title {
  font-size: 13px;
  font-weight: 600;
}
.toggle-desc {
  font-size: 11px;
  color: var(--text-muted);
}
.st-checkbox-wrapper {
  position: relative;
  width: 36px;
  height: 20px;
}
.st-checkbox {
  opacity: 0;
  width: 0;
  height: 0;
}
.st-checkbox-slider {
  position: absolute;
  cursor: pointer;
  top: 0; left: 0; right: 0; bottom: 0;
  background-color: rgba(255,255,255,0.1);
  transition: .3s;
  border-radius: 20px;
}
.st-checkbox-slider:before {
  position: absolute;
  content: "";
  height: 14px;
  width: 14px;
  left: 3px;
  bottom: 3px;
  background-color: white;
  transition: .3s;
  border-radius: 50%;
}
.st-checkbox:checked + .st-checkbox-slider {
  background-color: var(--primary-color);
}
.st-checkbox:checked + .st-checkbox-slider:before {
  transform: translateX(16px);
}

/* Range Slider */
.image-hosting_quality-slider {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px dashed var(--border-color);
}
.slider-header {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  margin-bottom: 8px;
  color: var(--text-muted);
}
.quality-badge {
  background: var(--primary-color);
  color: white;
  padding: 2px 6px;
  border-radius: 10px;
  font-size: 11px;
  font-weight: 600;
}
.image-hosting_range {
  width: 100%;
  accent-color: var(--primary-color);
  cursor: pointer;
}

/* Buttons */
.image-hosting_btn {
  flex: 1;
  padding: 8px 16px;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 600;
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  border: none;
  transition: all 0.2s cubic-bezier(0.4, 0, 0.2, 1);
}
.image-hosting_btn:active { transform: scale(0.98); }
.btn-primary {
  background: linear-gradient(135deg, var(--primary-color), #2980b9);
  color: white;
  box-shadow: 0 4px 10px rgba(52, 152, 219, 0.3);
}
.btn-primary:hover {
  box-shadow: 0 6px 15px rgba(52, 152, 219, 0.4);
  filter: brightness(1.1);
}
.btn-secondary {
  background: rgba(255,255,255,0.08);
  color: var(--text-main);
  border: 1px solid var(--border-color);
}
.btn-secondary:hover {
  background: rgba(255,255,255,0.12);
}

/* Dropzone */
.image-hosting_dropzone {
  border: 2px dashed rgba(255,255,255,0.2);
  border-radius: 12px;
  padding: 24px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  background: rgba(0,0,0,0.15);
}
.image-hosting_dropzone:hover,
.image-hosting_dropzone--active {
  border-color: var(--primary-color);
  background: rgba(52, 152, 219, 0.05);
  transform: scale(1.01);
}
.image-hosting_dropzone--uploading {
  border-style: solid;
  border-color: var(--primary-color);
  animation: pulseBg 2s infinite;
  pointer-events: none;
}
@keyframes pulseBg {
  0% { box-shadow: 0 0 0 0 rgba(52, 152, 219, 0.4); }
  70% { box-shadow: 0 0 0 10px rgba(52, 152, 219, 0); }
  100% { box-shadow: 0 0 0 0 rgba(52, 152, 219, 0); }
}
.dropzone-icon {
  font-size: 32px;
  color: var(--primary-color);
  background: rgba(52, 152, 219, 0.1);
  width: 60px;
  height: 60px;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
}
.dropzone-text {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.primary-text { font-size: 14px; font-weight: 500; }
.secondary-text { font-size: 12px; color: var(--text-muted); }

/* Toolbar */
.image-hosting_toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
  gap: 10px;
}
.image-hosting_search-box {
  flex: 1;
  display: flex;
  align-items: center;
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--border-color);
  border-radius: 20px;
  padding: 4px 12px;
  transition: border-color 0.2s;
}
.image-hosting_search-box:focus-within {
  border-color: var(--primary-color);
  box-shadow: 0 0 0 2px rgba(52, 152, 219, 0.1);
}
.search-icon { font-size: 12px; color: var(--text-muted); margin-right: 8px; }
.clear-icon { cursor: pointer; color: var(--text-muted); transition: color 0.15s; }
.clear-icon:hover { color: var(--text-main); }
.search-input {
  flex: 1;
  background: none;
  border: none;
  color: var(--text-main);
  font-size: 13px;
  outline: none;
  width: 100%;
}

.image-hosting_batch-bar {
  display: flex;
  align-items: center;
  gap: 12px;
}
.batch-checkbox {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
  color: var(--text-main);
}
.batch-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  opacity: 0;
  pointer-events: none;
  transform: translateX(10px);
  transition: all 0.2s cubic-bezier(0.175, 0.885, 0.32, 1.275);
}
.batch-actions--active {
  opacity: 1;
  pointer-events: auto;
  transform: translateX(0);
}
.selected-count {
  font-size: 11px;
  background: var(--primary-color);
  color: white;
  padding: 2px 6px;
  border-radius: 10px;
}
.icon-action-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  width: 28px; height: 28px;
  border-radius: 6px;
  display: flex; align-items: center; justify-content: center;
  transition: all 0.2s;
}
.icon-action-btn:hover { background: rgba(255,255,255,0.1); color: var(--text-main); }
.icon-action-btn.delete-btn:hover { background: rgba(255,91,91,0.1); color: var(--danger-color); }

/* List Container & Empty State */
.image-hosting_empty-state {
  text-align: center;
  padding: 40px 0;
  color: var(--text-muted);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 10px;
}
.empty-icon {
  font-size: 40px;
  opacity: 0.3;
}

.image-hosting_grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
  gap: 12px;
  margin-top: 10px;
}

/* List Transitions */
.list-enter-active, .list-leave-active { transition: all 0.3s ease; }
.list-enter-from { opacity: 0; transform: translateY(15px); }
.list-leave-to { opacity: 0; transform: scale(0.9); }

/* Card Design */
.image-hosting_card {
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  border-radius: 10px;
  padding: 10px;
  display: flex;
  align-items: center;
  gap: 12px;
  position: relative;
  transition: all 0.2s;
  overflow: hidden;
}
.image-hosting_card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 15px rgba(0,0,0,0.2);
  border-color: rgba(255,255,255,0.2);
}
.image-hosting_card.is-selected {
  border-color: var(--primary-color);
  background: rgba(52, 152, 219, 0.05);
}

.card-select {
  display: flex;
  align-items: center;
}

.card-preview {
  width: 60px;
  height: 60px;
  border-radius: 6px;
  overflow: hidden;
  position: relative;
  cursor: pointer;
  flex-shrink: 0;
  background: #000;
}
.card-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  transition: transform 0.3s ease;
}
.card-preview:hover img {
  transform: scale(1.1);
}
.preview-overlay {
  position: absolute;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0,0,0,0.5);
  display: flex;
  align-items: center;
  justify-content: center;
  opacity: 0;
  transition: opacity 0.2s;
  color: white;
  font-size: 16px;
}
.card-preview:hover .preview-overlay { opacity: 1; }

.embedded-badge {
  position: absolute;
  top: 4px; right: 4px;
  background: rgba(0,0,0,0.7);
  color: #f39c12;
  font-size: 10px;
  padding: 2px 4px;
  border-radius: 4px;
  backdrop-filter: blur(2px);
}

.card-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.card-name-row {
  display: flex;
  align-items: center;
  gap: 4px;
}
.card-name {
  font-size: 13px;
  font-weight: 500;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  flex: 1;
}
.name-edit-input {
  flex: 1;
  width: 100%;
  background: rgba(0,0,0,0.4);
  border: 1px solid var(--primary-color);
  color: white;
  border-radius: 4px;
  padding: 2px 6px;
  font-size: 12px;
  outline: none;
}
.small-icon-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  font-size: 11px;
  padding: 2px 4px;
  border-radius: 4px;
  transition: all 0.2s;
}
.small-icon-btn:hover { background: rgba(255,255,255,0.1); color: var(--text-main); }
.small-icon-btn.success:hover { color: var(--success-color); }
.small-icon-btn.danger:hover { color: var(--danger-color); }

.card-meta {
  font-size: 11px;
  color: var(--text-muted);
  display: flex;
  align-items: center;
  gap: 6px;
}
.meta-dot { opacity: 0.5; font-size: 8px; }
.meta-type {
  background: rgba(255,255,255,0.1);
  padding: 1px 4px;
  border-radius: 3px;
  font-size: 10px;
}

.card-actions {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-top: 4px;
}
.action-btn {
  background: rgba(255,255,255,0.05);
  border: 1px solid transparent;
  color: var(--text-main);
  padding: 4px 8px;
  border-radius: 4px;
  font-size: 11px;
  cursor: pointer;
  display: flex;
  align-items: center;
  gap: 4px;
  transition: all 0.2s;
  flex: 1;
  justify-content: center;
}
.action-btn:hover {
  background: rgba(255,255,255,0.1);
  border-color: rgba(255,255,255,0.1);
}
.action-btn.danger-icon {
  flex: 0 0 auto;
  color: var(--text-muted);
}
.action-btn.danger-icon:hover {
  color: var(--danger-color);
  border-color: rgba(255,91,91,0.2);
  background: rgba(255,91,91,0.05);
}

/* Fullscreen Preview */
.fade-enter-active, .fade-leave-active { transition: opacity 0.25s ease; }
.fade-enter-from, .fade-leave-to { opacity: 0; }

.image-hosting_overlay {
  position: fixed;
  top: 0; left: 0; right: 0; bottom: 0;
  background: rgba(0, 0, 0, 0.85);
  backdrop-filter: blur(5px);
  z-index: 99999;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
}

.image-hosting_preview-container {
  position: relative;
  max-width: 90vw;
  max-height: 90vh;
  background: var(--card-bg);
  border: 1px solid var(--border-color);
  padding: 10px;
  padding-bottom: 0;
  border-radius: 12px;
  cursor: default;
  display: flex;
  flex-direction: column;
  box-shadow: 0 20px 40px rgba(0,0,0,0.5);
}

.preview-close-btn {
  position: absolute;
  top: -15px; right: -15px;
  width: 36px; height: 36px;
  border-radius: 50%;
  background: var(--primary-color);
  color: white;
  border: 2px solid #000;
  font-size: 16px;
  display: flex; align-items: center; justify-content: center;
  cursor: pointer;
  box-shadow: 0 4px 10px rgba(0,0,0,0.3);
  transition: transform 0.2s;
  z-index: 10;
}
.preview-close-btn:hover { transform: scale(1.1); }

.image-hosting_preview-container img {
  max-width: calc(90vw - 20px);
  max-height: calc(85vh - 60px);
  object-fit: contain;
  border-radius: 6px;
}

.preview-footer {
  padding: 15px;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}
.preview-title { font-size: 15px; font-weight: 600; color: white; }
.preview-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #aaa;
}
.preview-meta .divider { opacity: 0.3; }
.embedded-tag {
  background: rgba(243, 156, 18, 0.15);
  color: #f39c12;
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 11px;
}

/* ======== Desktop Split Layout ======== */
.image-hosting-panel.is-desktop {
  flex-direction: row;
  gap: 0;
}

.image-hosting-panel.is-desktop .panel-left {
  width: 280px;
  flex-shrink: 0;
  border-right: 1px solid var(--border-color);
  padding-right: 16px;
  overflow-y: auto;
  max-height: 100%;
}

.image-hosting-panel.is-desktop .panel-right {
  flex: 1;
  padding-left: 16px;
  overflow-y: auto;
  max-height: 100%;
  min-width: 0;
  transition: background 0.2s, border-color 0.2s;
  border-radius: 8px;
}

.image-hosting-panel.is-desktop .panel-right.panel-right--dragover {
  background: rgba(52, 152, 219, 0.04);
  border: 2px dashed var(--primary-color);
}

/* 桌面端: 统计卡片竖排 */
.image-hosting-panel.is-desktop .image-hosting_stats {
  grid-template-columns: 1fr;
}

/* 桌面端: 工具栏竖排 */
.image-hosting-panel.is-desktop .image-hosting_toolbar {
  flex-direction: column;
  align-items: stretch;
}

/* 桌面端: 上传卡片融入画廊 */
.upload-card {
  cursor: pointer;
  border: 2px dashed rgba(255,255,255,0.15);
  background: transparent;
  min-height: 100px;
  justify-content: center;
  transition: all 0.25s ease;
}
.upload-card:hover {
  border-color: var(--primary-color);
  background: rgba(52, 152, 219, 0.05);
}
.upload-card-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  width: 100%;
}

.empty-hint-card {
  border-style: dashed;
  border-color: rgba(255,255,255,0.08);
  min-height: 100px;
  justify-content: center;
  cursor: default;
  pointer-events: none;
}
.empty-hint-card:hover {
  transform: none;
  box-shadow: none;
}

/* Remote URL Form */
.remote-url-form {
  display: flex;
  flex-direction: column;
  gap: 8px;
}
.remote-input-row {
  display: flex;
  gap: 8px;
  align-items: center;
}
.remote-input {
  background: rgba(0,0,0,0.3);
  border: 1px solid var(--border-color);
  border-radius: 6px;
  padding: 6px 10px;
  color: var(--text-main);
  font-size: 12px;
  flex: 1;
  transition: border-color 0.2s;
}
.remote-input:focus {
  border-color: var(--primary-color);
  outline: none;
}
.remote-add-card {
  min-height: 90px;
  padding: 12px;
  cursor: default;
}
.remote-add-card:hover {
  transform: none;
}

/* CDN Speed Test Panel */
.cdn-speed-panel {
  margin-top: 12px;
  padding-top: 10px;
  border-top: 1px solid var(--border-color);
}
.cdn-speed-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 8px;
}
.cdn-proxy-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
.cdn-proxy-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 10px;
  border-radius: 6px;
  background: rgba(0,0,0,0.2);
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.15s;
  font-size: 12px;
}
.cdn-proxy-item:hover {
  background: rgba(255,255,255,0.05);
  border-color: rgba(255,255,255,0.1);
}
.cdn-proxy-item.is-preferred {
  border-color: var(--primary-color);
  background: rgba(52, 152, 219, 0.08);
}
.proxy-name {
  color: var(--text-main);
  font-size: 11px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.proxy-latency {
  font-size: 11px;
  font-weight: 600;
  padding: 1px 6px;
  border-radius: 8px;
}
.latency-fast { background: rgba(46,204,113,0.15); color: #2ecc71; }
.latency-medium { background: rgba(241,196,15,0.15); color: #f1c40f; }
.latency-slow { background: rgba(231,76,60,0.15); color: #e74c3c; }
.latency-timeout { background: rgba(255,255,255,0.05); color: var(--text-muted); }

.proxy-delete-btn {
  background: none;
  border: none;
  color: var(--text-muted);
  cursor: pointer;
  padding: 2px 4px;
  font-size: 10px;
  opacity: 0.4;
  transition: all 0.15s;
  border-radius: 4px;
}
.proxy-delete-btn:hover {
  opacity: 1;
  color: #e74c3c;
  background: rgba(231,76,60,0.1);
}

.cdn-proxy-add {
  display: flex;
  gap: 6px;
  align-items: center;
  margin-top: 6px;
}
</style>
