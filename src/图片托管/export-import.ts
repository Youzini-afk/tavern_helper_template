/**
 * 导出/导入压缩包
 *
 * 使用 JSZip 打包图片资源 + manifest.json 供分享
 * 支持 local、embedded 和已缓存的 remote 存储模式
 */
import JSZip from 'jszip';
import { uploadFile, generateStorageName } from './api';
import { useImageStore, type ImageRegistry } from './image-store';
import { useSettingsStore } from './settings';

const MANIFEST_VERSION = 1;

/**
 * 导出当前角色卡的所有图片为 ZIP 压缩包
 */
export async function exportImages(): Promise<void> {
    const imageStore = useImageStore();
    const registryData = imageStore.getRegistryData();
    const entries = Object.entries(registryData.images);

    if (entries.length === 0) {
        toastr.warning('当前角色卡没有图片可以导出');
        return;
    }

    const zip = new JSZip();
    const imgFolder = zip.folder('images')!;
    let successCount = 0;

    for (const [storageName, meta] of entries) {
        try {
            if (meta.storage === 'embedded' && meta.base64_data) {
                // embedded 模式: 从 base64_data 直接打包
                const binaryString = atob(meta.base64_data);
                const bytes = new Uint8Array(binaryString.length);
                for (let i = 0; i < binaryString.length; i++) {
                    bytes[i] = binaryString.charCodeAt(i);
                }
                imgFolder.file(storageName, bytes, { binary: true });
                successCount++;
            } else if (meta.server_path) {
                // local 模式 或 已缓存的 remote 模式: 从服务端下载
                const response = await fetch(`/${meta.server_path}`);
                if (!response.ok) {
                    console.warn(`获取图片 '${meta.display_name}' 失败 (${response.status}), 跳过`);
                    continue;
                }
                const blob = await response.blob();
                imgFolder.file(storageName, blob);
                successCount++;
            } else {
                console.warn(`图片 '${meta.display_name}' 存储数据不完整, 跳过`);
            }
        } catch (err) {
            console.warn(`处理图片 '${meta.display_name}' 失败:`, err);
        }
    }

    if (successCount === 0) {
        toastr.error('没有成功获取到任何图片文件');
        return;
    }

    // 导出时清除 base64_data 以减小 manifest 体积, 只保留元数据
    const exportManifest = klona(registryData);
    for (const meta of Object.values(exportManifest.images)) {
        meta.base64_data = '';
    }

    zip.file('manifest.json', JSON.stringify({ version: MANIFEST_VERSION, ...exportManifest }, null, 2));

    // 生成并下载 ZIP
    const content = await zip.generateAsync({ type: 'blob' });
    const characterName = substitudeMacros('{{char}}') || 'unknown';
    const fileName = `${characterName}_images.zip`;

    const url = URL.createObjectURL(content);
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    toastr.success(`成功导出 ${successCount} 张图片`);
}

/**
 * 导入图片压缩包
 * 根据当前存储模式设置决定导入方式
 */
export async function importImages(): Promise<void> {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.zip';

    return new Promise<void>((resolve) => {
        input.onchange = async () => {
            const file = input.files?.[0];
            if (!file) {
                resolve();
                return;
            }

            try {
                const zip = await JSZip.loadAsync(file);

                // 读取 manifest
                const manifestFile = zip.file('manifest.json');
                if (!manifestFile) {
                    toastr.error('压缩包中缺少 manifest.json');
                    resolve();
                    return;
                }

                const manifestText = await manifestFile.async('string');
                const manifestRaw = JSON.parse(manifestText);
                // 兼容没有 version 的旧版 manifest
                const manifest = (manifestRaw.images ? manifestRaw : { images: {} }) as ImageRegistry;

                const imagesFolder = zip.folder('images');
                if (!imagesFolder) {
                    toastr.error('压缩包中缺少 images 目录');
                    resolve();
                    return;
                }

                const imageStore = useImageStore();
                const settingsStore = useSettingsStore();
                const currentMode = settingsStore.settings.storage_mode;
                let successCount = 0;
                const entries = Object.entries(manifest.images);

                for (const [origStorageName, meta] of entries) {
                    const imageFile = imagesFolder.file(origStorageName);
                    if (!imageFile) {
                        console.warn(`压缩包中缺少图片文件: ${origStorageName}`);
                        continue;
                    }

                    try {
                        const base64 = await imageFile.async('base64');

                        // 生成新的 storageName 避免覆盖已有条目
                        const ext = origStorageName.split('.').pop() ?? 'png';
                        const charName = substitudeMacros('{{char}}') || 'unknown';
                        const newStorageName = imageStore.registry.images[origStorageName]
                            ? generateStorageName(charName, ext)  // 已有同名, 生成新名
                            : origStorageName;  // 无冲突, 保留原名

                        if (currentMode === 'local') {
                            const serverPath = await uploadFile(newStorageName, base64);
                            meta.server_path = serverPath;
                            meta.base64_data = '';
                            meta.storage = 'local';
                        } else {
                            meta.base64_data = base64;
                            meta.server_path = '';
                            meta.storage = 'embedded';
                        }

                        // 用新 key 存到 manifest
                        if (newStorageName !== origStorageName) {
                            delete manifest.images[origStorageName];
                            manifest.images[newStorageName] = meta;
                        }
                        successCount++;
                    } catch (err) {
                        console.warn(`导入图片 '${meta.display_name}' 失败:`, err);
                    }
                }

                // 合并注册表
                imageStore.mergeRegistry(manifest);

                toastr.success(`成功导入 ${successCount}/${entries.length} 张图片`);
            } catch (err) {
                console.error('导入失败:', err);
                toastr.error('导入压缩包失败, 请检查文件格式');
            }

            resolve();
        };

        input.click();
    });
}
