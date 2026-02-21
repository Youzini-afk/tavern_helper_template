/**
 * 图片元数据管理 (持久化到角色卡变量)
 *
 * 支持三种存储模式:
 * - local: 图片存储在 SillyTavern 服务端文件系统
 * - embedded: 图片以 base64 嵌入角色卡变量 (导出角色卡时自动携带)
 * - remote: 图片通过远程 URL 加载, 可选 CDN 代理/轮询, 可选本地缓存
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
    /** 远程 URL (remote 模式) */
    remote_url: z.string().default(''),
    /** 存储模式 */
    storage: z.enum(['local', 'embedded', 'remote']).default('local'),
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

/** 获取当前选中的角色名 (注: substitudeMacros 拼写为 SillyTavern 历史遗留) */
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

// ===== CDN 代理轮询 =====

/** 已解析的 CDN URL 缓存 (避免每次重新轮询) */
const resolvedRemoteCache = new Map<string, string>();

/**
 * 检测 URL 是否可加载 (通过 <img> onload/onerror 检测)
 * @returns Promise<boolean>
 */
function probeImageUrl(url: string, timeoutMs = 5000): Promise<boolean> {
    return new Promise((resolve) => {
        const img = new Image();
        const timer = setTimeout(() => { img.src = ''; resolve(false); }, timeoutMs);
        img.onload = () => { clearTimeout(timer); resolve(true); };
        img.onerror = () => { clearTimeout(timer); resolve(false); };
        img.src = url;
    });
}

/**
 * 通过 CDN 代理列表轮询, 找到第一个可用 URL
 * @param originalUrl 原始远程 URL
 * @param proxyTemplates CDN 代理模板列表
 * @returns 可用的 URL (原始或代理)
 */
async function resolveWithCdn(originalUrl: string, proxyTemplates: string[]): Promise<string> {
    // 先测原始 URL
    if (await probeImageUrl(originalUrl)) return originalUrl;

    // 依次尝试代理
    for (const template of proxyTemplates) {
        const proxyUrl = template.replace('{url}', encodeURIComponent(originalUrl));
        if (await probeImageUrl(proxyUrl)) return proxyUrl;
    }

    // 全部失败, 返回原始 URL (让浏览器自己处理)
    return originalUrl;
}

// ===== Store =====

export const useImageStore = defineStore('image-hosting-images', () => {
    const registry = ref(loadRegistry());
    const settingsStore = useSettingsStore();

    /** 上传一张图片 (local / embedded 模式) */
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
            remote_url: '',
            storage: mode === 'remote' ? 'local' : mode, // upload 不支持 remote, 退回 local
        };

        registry.value.images[storageName] = meta;
        saveRegistry(registry.value);
        return storageName;
    }

    /** 添加远程图片 (remote 模式) */
    function addRemote(displayName: string, remoteUrl: string): string {
        const storageName = generateStorageName(getCharacterName(), 'remote');

        const meta: ImageMeta = {
            display_name: displayName,
            original_name: remoteUrl.split('/').pop() ?? displayName,
            mime_type: 'image/*',
            size: 0,
            uploaded_at: Date.now(),
            server_path: '',
            base64_data: '',
            remote_url: remoteUrl,
            storage: 'remote',
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
        resolvedRemoteCache.delete(storageName);
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

    /** 获取图片的可用 URL (自动处理三种模式) */
    function resolveUrl(storageName: string, meta: ImageMeta): string {
        if (meta.storage === 'embedded' && meta.base64_data) {
            return getOrCreateObjectUrl(storageName, meta.base64_data, meta.mime_type);
        }
        if (meta.storage === 'remote' && meta.remote_url) {
            // remote: 如果已有本地缓存 (base64_data 被填充), 使用本地缓存
            if (meta.base64_data) {
                return getOrCreateObjectUrl(storageName, meta.base64_data, meta.mime_type);
            }
            // 同步返回: 先返回缓存或原始 URL, 异步 CDN 轮询在 resolveUrlAsync 中处理
            return resolvedRemoteCache.get(storageName) ?? meta.remote_url;
        }
        return `/${meta.server_path}`;
    }

    /**
     * 异步解析远程图片 URL (带 CDN 轮询)
     * 首次调用时执行轮询并缓存结果, 之后直接返回缓存
     */
    async function resolveUrlAsync(storageName: string, meta: ImageMeta): Promise<string> {
        // 非 remote 直接返回同步结果
        if (meta.storage !== 'remote' || !meta.remote_url) {
            return resolveUrl(storageName, meta);
        }

        // 已有本地 base64 缓存
        if (meta.base64_data) {
            return getOrCreateObjectUrl(storageName, meta.base64_data, meta.mime_type);
        }

        // 已有轮询结果缓存
        const cached = resolvedRemoteCache.get(storageName);
        if (cached) return cached;

        // 执行 CDN 轮询
        let resolvedUrl: string;
        if (settingsStore.settings.cdn_proxy_enabled) {
            resolvedUrl = await resolveWithCdn(
                meta.remote_url,
                settingsStore.settings.cdn_proxy_list,
            );
        } else {
            resolvedUrl = meta.remote_url;
        }

        resolvedRemoteCache.set(storageName, resolvedUrl);

        // 可选: 拉取后缓存到本地 (base64 存入角色卡变量)
        if (settingsStore.settings.remote_cache_local) {
            cacheRemoteToLocal(storageName, resolvedUrl).catch(err =>
                console.warn(`远程图片本地缓存失败: ${err}`),
            );
        }

        return resolvedUrl;
    }

    /** 将远程图片拉取并缓存为 base64 到角色卡变量 */
    async function cacheRemoteToLocal(storageName: string, url: string): Promise<void> {
        const meta = registry.value.images[storageName];
        if (!meta || meta.base64_data) return; // 已缓存

        try {
            const response = await fetch(url);
            const blob = await response.blob();
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve, reject) => {
                reader.onloadend = () => {
                    const result = reader.result as string;
                    // 去掉 data:mime;base64, 前缀
                    resolve(result.split(',')[1] ?? '');
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            meta.base64_data = base64;
            meta.mime_type = blob.type || meta.mime_type;
            meta.size = blob.size;
            saveRegistry(registry.value);
        } catch {
            // 缓存失败不影响使用
        }
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

    /** 通过显示名称异步获取图片 URL (带 CDN 轮询) */
    async function getUrlByDisplayNameAsync(displayName: string): Promise<string | null> {
        for (const [storageName, meta] of Object.entries(registry.value.images)) {
            if (meta.display_name === displayName) {
                return resolveUrlAsync(storageName, meta);
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
        const localImages = Object.entries(registry.value.images)
            .filter(([, meta]) => meta.storage === 'local' && meta.server_path)
            .map(([, meta]) => meta.server_path);
        if (localImages.length === 0) return {};
        return verifyFiles(localImages);
    }

    /** 重新从角色卡变量加载注册表 */
    function reload(): void {
        // 清除旧的 Object URL 缓存
        for (const key of objectUrlCache.keys()) {
            revokeObjectUrl(key);
        }
        resolvedRemoteCache.clear();
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
        addRemote,
        remove,
        rename,
        resolveUrl,
        resolveUrlAsync,
        getUrlByDisplayName,
        getUrlByDisplayNameAsync,
        getUrlByStorageName,
        getAllImages,
        verify,
        reload,
        getRegistryData,
        mergeRegistry,
    };
});
