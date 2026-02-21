/**
 * 图片元数据管理 (持久化到角色卡变量)
 *
 * 支持两种存储模式:
 * - local: 图片存储在 SillyTavern 服务端文件系统
 * - embedded: 图片以 base64 嵌入角色卡变量 (导出角色卡时自动携带)
 */
import { uploadFile, deleteFile, verifyFiles, fileToBase64, generateStorageName } from './api';
import { compressImage } from './compress';
import { useSettingsStore } from './settings';

/** 单张图片的元数据 */
const ImageMeta = z.object({
    display_name: z.string(),
    original_name: z.string(),
    mime_type: z.string(),
    size: z.coerce.number(),
    uploaded_at: z.coerce.number(),
    /** 服务端文件路径 (local 模式) */
    server_path: z.string().default(''),
    /** base64 图片数据 (embedded 模式) */
    base64_data: z.string().default(''),
    /** 存储模式 */
    storage: z.enum(['local', 'embedded']).default('local'),
});
export type ImageMeta = z.infer<typeof ImageMeta>;

/** 角色卡的图片注册表 */
const ImageRegistry = z
    .object({
        /** storage_name -> ImageMeta */
        images: z.record(z.string(), ImageMeta).prefault({}),
    })
    .prefault({});
export type ImageRegistry = z.infer<typeof ImageRegistry>;

function getCharacterName(): string {
    const name = getCharacterNames().find(
        (n: string) => n === substitudeMacros('{{char}}'),
    );
    return name ?? 'unknown';
}

function loadRegistry(): ImageRegistry {
    const vars = getVariables({ type: 'character' });
    return ImageRegistry.parse(_.get(vars, 'image_hosting', {}));
}

function saveRegistry(registry: ImageRegistry): void {
    updateVariablesWith(
        vars => _.set(vars, 'image_hosting', klona(registry)),
        { type: 'character' },
    );
}

/** Object URL 缓存 (embedded 模式用) */
const objectUrlCache = new Map<string, string>();

/** 从 base64 创建 Object URL 并缓存 */
function getOrCreateObjectUrl(storageName: string, base64Data: string, mimeType: string): string {
    const cached = objectUrlCache.get(storageName);
    if (cached) return cached;

    const binaryString = atob(base64Data);
    const bytes = new Uint8Array(binaryString.length);
    for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
    }
    const blob = new Blob([bytes], { type: mimeType });
    const url = URL.createObjectURL(blob);
    objectUrlCache.set(storageName, url);
    return url;
}

/** 清除某个 Object URL 缓存 */
function revokeObjectUrl(storageName: string): void {
    const url = objectUrlCache.get(storageName);
    if (url) {
        URL.revokeObjectURL(url);
        objectUrlCache.delete(storageName);
    }
}

export const useImageStore = defineStore('image-hosting-images', () => {
    const registry = ref(loadRegistry());
    const settingsStore = useSettingsStore();

    /** 上传一张图片 */
    async function upload(file: File): Promise<string> {
        let base64: string;
        let mimeType = file.type;
        let extension = file.name.split('.').pop() ?? 'png';
        let fileSize = file.size;

        // 可选压缩
        if (settingsStore.settings.auto_compress && file.type.startsWith('image/')) {
            const compressed = await compressImage(file, settingsStore.settings.compress_quality);
            base64 = compressed.base64;
            mimeType = compressed.mimeType;
            extension = compressed.extension;
            fileSize = compressed.size;
        } else {
            base64 = await fileToBase64(file);
        }

        const storageName = generateStorageName(getCharacterName(), extension);
        const mode = settingsStore.settings.storage_mode;

        let serverPath = '';
        let base64Data = '';

        if (mode === 'local') {
            serverPath = await uploadFile(storageName, base64);
        } else {
            // embedded: 直接存到角色卡变量
            base64Data = base64;
        }

        const meta: ImageMeta = {
            display_name: file.name.replace(/\.[^.]+$/, ''),
            original_name: file.name,
            mime_type: mimeType,
            size: fileSize,
            uploaded_at: Date.now(),
            server_path: serverPath,
            base64_data: base64Data,
            storage: mode,
        };

        registry.value.images[storageName] = meta;
        saveRegistry(registry.value);
        return storageName;
    }

    /** 删除一张图片 */
    async function remove(storageName: string): Promise<void> {
        const meta = registry.value.images[storageName];
        if (!meta) return;

        if (meta.storage === 'local' && meta.server_path) {
            try {
                await deleteFile(meta.server_path);
            } catch (err) {
                console.warn(`删除服务端文件失败, 仅从注册表移除: ${err}`);
            }
        }

        revokeObjectUrl(storageName);
        delete registry.value.images[storageName];
        saveRegistry(registry.value);
    }

    /** 重命名图片的显示名称 */
    function rename(storageName: string, newDisplayName: string): void {
        const meta = registry.value.images[storageName];
        if (!meta) return;
        meta.display_name = newDisplayName;
        saveRegistry(registry.value);
    }

    /** 获取图片的可用 URL (自动处理两种模式) */
    function resolveUrl(storageName: string, meta: ImageMeta): string {
        if (meta.storage === 'embedded' && meta.base64_data) {
            return getOrCreateObjectUrl(storageName, meta.base64_data, meta.mime_type);
        }
        return `/${meta.server_path}`;
    }

    /** 通过显示名称获取图片 URL */
    function getUrlByDisplayName(displayName: string): string | null {
        for (const [storageName, meta] of Object.entries(registry.value.images)) {
            if (meta.display_name === displayName) {
                return resolveUrl(storageName, meta);
            }
        }
        return null;
    }

    /** 通过存储名称获取图片 URL */
    function getUrlByStorageName(storageName: string): string | null {
        const meta = registry.value.images[storageName];
        if (!meta) return null;
        return resolveUrl(storageName, meta);
    }

    /** 获取所有图片列表 */
    function getAllImages(): Array<{ storageName: string; url: string } & ImageMeta> {
        return _.map(registry.value.images, (meta, storageName) => ({
            storageName,
            url: resolveUrl(storageName, meta),
            ...meta,
        }));
    }

    /** 验证所有本地模式图片的完整性 */
    async function verify(): Promise<Record<string, boolean>> {
        const localImages = _.filter(
            _.map(registry.value.images, (meta, name) => ({ name, meta })),
            item => item.meta.storage === 'local' && item.meta.server_path,
        );
        if (localImages.length === 0) return {};
        return verifyFiles(localImages.map(i => i.meta.server_path));
    }

    /** 重新从角色卡变量加载注册表 */
    function reload(): void {
        // 清除旧的 Object URL 缓存
        for (const key of objectUrlCache.keys()) {
            revokeObjectUrl(key);
        }
        registry.value = loadRegistry();
    }

    /** 获取原始注册表数据 (供导出使用) */
    function getRegistryData(): ImageRegistry {
        return klona(registry.value);
    }

    /** 导入注册表数据 (供导入使用) */
    function mergeRegistry(incoming: ImageRegistry): void {
        _.assign(registry.value.images, incoming.images);
        saveRegistry(registry.value);
    }

    return {
        registry,
        upload,
        remove,
        rename,
        resolveUrl,
        getUrlByDisplayName,
        getUrlByStorageName,
        getAllImages,
        verify,
        reload,
        getRegistryData,
        mergeRegistry,
    };
});
