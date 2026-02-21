<template>
  <div class="image-hosting-settings">
    <div class="inline-drawer">
      <div class="inline-drawer-toggle inline-drawer-header">
        <b>{{ `图片托管` }}</b>
        <div class="inline-drawer-icon fa-solid fa-circle-chevron-down down"></div>
      </div>
      <div class="inline-drawer-content">
        <!-- 当前角色卡名 -->
        <div class="image-hosting_block flex-container flexFlowColumn">
          <small>当前角色卡: <b>{{ characterName }}</b></small>
        </div>

        <!-- 存储模式 -->
        <div class="image-hosting_block flex-container" style="align-items: center; gap: 8px">
          <label>存储模式</label>
          <select v-model="settings.storage_mode" class="text_pole" style="height: 28px; flex: 1">
            <option value="local">本地文件 (需额外分享压缩包)</option>
            <option value="embedded">嵌入角色卡 (导出卡片时自动包含)</option>
          </select>
        </div>

        <!-- 上传区域 -->
        <div class="image-hosting_block">
          <div
            class="image-hosting_dropzone"
            :class="{ 'image-hosting_dropzone--active': isDragging }"
            @dragover.prevent="isDragging = true"
            @dragleave.prevent="isDragging = false"
            @drop.prevent="handleDrop"
            @click="triggerFileInput"
          >
            <i class="fa-solid fa-cloud-arrow-up"></i>
            <span>{{ uploading ? `上传中 (${uploadProgress})...` : '拖拽图片到此处, 或点击选择' }}</span>
          </div>
          <input
            ref="fileInputRef"
            type="file"
            accept="image/*"
            multiple
            style="display: none"
            @change="handleFileSelect"
          />
        </div>

        <!-- 设置区域 -->
        <div class="image-hosting_block flex-container">
          <input v-model="settings.auto_compress" type="checkbox" />
          <label>上传时压缩/转 WebP</label>
        </div>
        <div v-if="settings.auto_compress" class="image-hosting_block flex-container">
          <label>压缩质量: {{ Math.round(settings.compress_quality * 100) }}%</label>
          <input
            v-model.number="settings.compress_quality"
            type="range"
            min="0.1"
            max="1"
            step="0.05"
            style="flex: 1"
          />
        </div>

        <!-- 导入导出按钮 (仅 local 模式) -->
        <div v-if="settings.storage_mode === 'local'" class="image-hosting_block flex-container">
          <input class="menu_button" type="submit" value="导出图片包" @click="handleExport" />
          <input class="menu_button" type="submit" value="导入图片包" @click="handleImport" />
        </div>
        <div v-else class="image-hosting_block">
          <small style="opacity: 0.6">
            <i class="fa-solid fa-circle-info"></i>
            嵌入模式: 图片数据跟随角色卡导出/导入，无需额外压缩包
          </small>
        </div>

        <hr class="sysHR" />

        <!-- 图片列表 -->
        <div v-if="images.length === 0" class="image-hosting_block">
          <small style="opacity: 0.6">暂无图片, 请上传</small>
        </div>
        <div v-for="image in images" :key="image.storageName" class="image-hosting_image-item">
          <div class="image-hosting_image-preview" @click="openPreview(image)">
            <img :src="image.url" :alt="image.display_name" loading="lazy" />
          </div>
          <div class="image-hosting_image-info">
            <div class="image-hosting_image-name">
              <template v-if="editingName !== image.storageName">
                <span :title="image.display_name">{{ image.display_name }}</span>
                <i
                  class="fa-solid fa-pen-to-square image-hosting_icon-btn"
                  title="重命名"
                  @click="startRename(image.storageName, image.display_name)"
                ></i>
              </template>
              <template v-else>
                <input
                  v-model="editNameValue"
                  class="text_pole"
                  style="flex: 1; height: 24px; font-size: 12px"
                  @keyup.enter="confirmRename(image.storageName)"
                  @keyup.escape="cancelRename"
                />
                <i
                  class="fa-solid fa-check image-hosting_icon-btn"
                  title="确认"
                  @click="confirmRename(image.storageName)"
                ></i>
                <i
                  class="fa-solid fa-xmark image-hosting_icon-btn"
                  title="取消"
                  @click="cancelRename"
                ></i>
              </template>
            </div>
            <small style="opacity: 0.6">
              {{ formatSize(image.size) }} · {{ image.mime_type }}
              <span v-if="image.storage === 'embedded'" style="color: var(--SmartThemeQuoteColor, #3498db)">
                · 嵌入
              </span>
            </small>
            <div class="image-hosting_image-actions">
              <i
                class="fa-solid fa-copy image-hosting_icon-btn"
                title="复制调用代码"
                @click="copyCode(image.display_name)"
              ></i>
              <i
                class="fa-solid fa-trash-can image-hosting_icon-btn"
                title="删除"
                style="color: var(--SmartThemeQuoteColor, #e74c3c)"
                @click="handleDelete(image.storageName, image.display_name)"
              ></i>
            </div>
          </div>
        </div>

        <hr class="sysHR" />
      </div>
    </div>

    <!-- 大图预览浮层 -->
    <Teleport to="body">
      <div v-if="previewImage" class="image-hosting_overlay" @click.self="closePreview">
        <div class="image-hosting_preview-container">
          <img :src="previewImage.url" :alt="previewImage.display_name" />
          <div class="image-hosting_preview-info">
            <span>{{ previewImage.display_name }}</span>
            <small>{{ formatSize(previewImage.size) }} · {{ previewImage.mime_type }}</small>
          </div>
          <i class="fa-solid fa-xmark image-hosting_preview-close" @click="closePreview"></i>
        </div>
      </div>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { storeToRefs } from 'pinia';
import { useSettingsStore } from './settings';
import { useImageStore, type ImageMeta } from './image-store';
import { exportImages, importImages } from './export-import';

const { settings } = storeToRefs(useSettingsStore());
const imageStore = useImageStore();

const images = computed(() => imageStore.getAllImages());
const characterName = ref(substitudeMacros('{{char}}') || '未选择');

// 上传状态
const uploading = ref(false);
const uploadProgress = ref('');
const isDragging = ref(false);
const fileInputRef = ref<HTMLInputElement>();

// 重命名状态
const editingName = ref<string | null>(null);
const editNameValue = ref('');

// 大图预览状态
const previewImage = ref<({ storageName: string; url: string } & ImageMeta) | null>(null);

// 监听角色卡切换
eventOn(tavern_events.CHAT_CHANGED, () => {
  characterName.value = substitudeMacros('{{char}}') || '未选择';
  imageStore.reload();
});

function triggerFileInput() {
  fileInputRef.value?.click();
}

async function uploadFiles(files: FileList | File[]) {
  uploading.value = true;
  let completed = 0;
  const total = files.length;

  for (const file of files) {
    if (!file.type.startsWith('image/')) {
      toastr.warning(`'${file.name}' 不是图片文件, 已跳过`);
      completed++;
      continue;
    }

    try {
      uploadProgress.value = `${completed + 1}/${total}`;
      await imageStore.upload(file);
      completed++;
    } catch (err) {
      console.error(`上传 '${file.name}' 失败:`, err);
      toastr.error(`上传 '${file.name}' 失败`);
      completed++;
    }
  }

  uploading.value = false;
  toastr.success(`成功上传 ${completed}/${total} 张图片`);
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
    toastr.success(`已删除「${displayName}」`);
  }
}

function copyCode(displayName: string) {
  const code = `ImageHosting.getImageUrl('${displayName}')`;
  navigator.clipboard.writeText(code).then(() => {
    toastr.success('已复制调用代码');
  });
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 大图预览
function openPreview(image: { storageName: string; url: string } & ImageMeta) {
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
.image-hosting_block {
  margin: 5px 0;
}

.image-hosting_dropzone {
  border: 2px dashed var(--SmartThemeBorderColor, #555);
  border-radius: 8px;
  padding: 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  opacity: 0.7;
}

.image-hosting_dropzone:hover,
.image-hosting_dropzone--active {
  border-color: var(--SmartThemeQuoteColor, #3498db);
  opacity: 1;
}

.image-hosting_dropzone i {
  font-size: 24px;
}

.image-hosting_image-item {
  display: flex;
  gap: 10px;
  padding: 8px 0;
  border-bottom: 1px solid var(--SmartThemeBorderColor, #333);
  align-items: center;
}

.image-hosting_image-preview {
  width: 50px;
  height: 50px;
  flex-shrink: 0;
  border-radius: 4px;
  overflow: hidden;
  cursor: pointer;
  transition: opacity 0.15s;
}

.image-hosting_image-preview:hover {
  opacity: 0.8;
}

.image-hosting_image-preview img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.image-hosting_image-info {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.image-hosting_image-name {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 13px;
}

.image-hosting_image-name span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.image-hosting_image-actions {
  display: flex;
  gap: 8px;
}

.image-hosting_icon-btn {
  cursor: pointer;
  opacity: 0.6;
  transition: opacity 0.15s;
  font-size: 13px;
}

.image-hosting_icon-btn:hover {
  opacity: 1;
}

/* 大图预览浮层 */
.image-hosting_overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: rgba(0, 0, 0, 0.85);
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
  cursor: default;
}

.image-hosting_preview-container img {
  max-width: 90vw;
  max-height: 85vh;
  object-fit: contain;
  border-radius: 8px;
  box-shadow: 0 4px 30px rgba(0, 0, 0, 0.5);
}

.image-hosting_preview-info {
  text-align: center;
  margin-top: 8px;
  color: #ccc;
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.image-hosting_preview-close {
  position: absolute;
  top: -12px;
  right: -12px;
  font-size: 20px;
  color: #fff;
  background: rgba(0, 0, 0, 0.6);
  border-radius: 50%;
  width: 32px;
  height: 32px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.15s;
}

.image-hosting_preview-close:hover {
  background: rgba(255, 255, 255, 0.2);
}
</style>
