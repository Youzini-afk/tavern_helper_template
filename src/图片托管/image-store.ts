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

/** 将 server_path 转为浏览器可用的本地路径 (避免双斜杠) */
function toLocalPath(serverPath: string): string {
    return serverPath.startsWith('/') ? serverPath : `/${serverPath}`;
}

// ===== CDN 代理轮询 =====

/** 已解析的 CDN URL 缓存 (避免每次重新轮询) */
const resolvedRemoteCache = new Map<string, string>();

/**
 * 检测图片 URL 是否可加载, 并返回延迟 (ms)
 * @returns Promise<number> 延迟毫秒, -1 表示失败
 */
export function probeImageUrl(url: string, timeoutMs = 5000): Promise<number> {
    return new Promise((resolve) => {
        const img = new Image();
        const start = performance.now();
        const timer = setTimeout(() => { img.src = ''; resolve(-1); }, timeoutMs);
        img.onload = () => { clearTimeout(timer); resolve(Math.round(performance.now() - start)); };
        img.onerror = () => { clearTimeout(timer); resolve(-1); };
        img.src = url;
    });
}

/**
 * 将代理模板应用到原始 URL 上
 * 支持两种占位符:
 *   {url} = encodeURIComponent(originalUrl) — 用于 ?url= 查询参数型代理
 *   {raw} = 原始 URL 去掉协议头      — 用于路径拼接型代理 (如 i0.wp.com/)
 */
export function applyProxyTemplate(template: string, originalUrl: string): string {
    return template
        .replace('{url}', encodeURIComponent(originalUrl))
        .replace('{raw}', originalUrl.replace(/^https?:\/\//, ''));
}

/**
 * 测量一个代理模板对指定测试 URL 的延迟
 */
export function measureProxyLatency(
    proxyTemplate: string,
    testImageUrl: string,
    timeoutMs = 5000,
): Promise<number> {
    const proxyUrl = applyProxyTemplate(proxyTemplate, testImageUrl);
    return probeImageUrl(proxyUrl, timeoutMs);
}

/**
 * 检测 GitHub 原始文件 URL 并转换为 jsdelivr CDN URL
 * 支持:
 *   https://raw.githubusercontent.com/{user}/{repo}/{branch}/{path}
 *   https://github.com/{user}/{repo}/raw/{branch}/{path}
 * @returns jsdelivr CDN URL 或 null (非 GitHub URL)
 */
export function githubToJsdelivr(url: string): string | null {
    // raw.githubusercontent.com/{user}/{repo}/{branch}/{path}
    const rawMatch = url.match(
        /^https?:\/\/raw\.githubusercontent\.com\/([^/]+)\/([^/]+)\/([^/]+)\/(.+)$/,
    );
    if (rawMatch) {
        const [, user, repo, branch, path] = rawMatch;
        return `https://cdn.jsdelivr.net/gh/${user}/${repo}@${branch}/${path}`;
    }

    // github.com/{user}/{repo}/raw/{branch}/{path}
    const ghRawMatch = url.match(
        /^https?:\/\/github\.com\/([^/]+)\/([^/]+)\/raw\/([^/]+)\/(.+)$/,
    );
    if (ghRawMatch) {
        const [, user, repo, branch, path] = ghRawMatch;
        return `https://cdn.jsdelivr.net/gh/${user}/${repo}@${branch}/${path}`;
    }

    return null;
}

/**
 * 检测 URL 是否已经来自已知 CDN / 代理
 * 如果是, 不应再套代理 (避免 CDN 嵌套)
 */
const KNOWN_CDN_DOMAINS = [
    'cdn.jsdelivr.net',
    'fastly.jsdelivr.net',
    'wsrv.nl',
    'images.weserv.nl',
    'i0.wp.com',
    'i1.wp.com',
    'i2.wp.com',
    'imageproxy.pimg.tw',
];

function isKnownCdnUrl(url: string): boolean {
    try {
        const hostname = new URL(url).hostname;
        return KNOWN_CDN_DOMAINS.includes(hostname);
    } catch {
        return false;
    }
}

/**
 * 从 CDN/代理 URL 中还原出原始 URL
 * 支持:
 *   - 查询参数型: wsrv.nl/?url=xxx, weserv.nl/?url=xxx
 *   - 路径拼接型: i0/i1/i2.wp.com/domain/path
 *   - jsdelivr GitHub: cdn.jsdelivr.net/gh/user/repo@branch/path
 * @returns 还原的原始 URL, 无法识别时返回原 URL 不变
 */
export function stripCdn(url: string): string {
    try {
        const parsed = new URL(url);
        const hostname = parsed.hostname;

        // 查询参数型: ?url=encodedUrl
        if (hostname === 'wsrv.nl' || hostname === 'images.weserv.nl'
            || hostname === 'imageproxy.pimg.tw') {
            const innerUrl = parsed.searchParams.get('url');
            if (innerUrl) return innerUrl;
        }

        // 路径拼接型: i0.wp.com/example.com/path/img.png
        if (/^i[0-2]\.wp\.com$/.test(hostname)) {
            // pathname = /example.com/path/img.png → https://example.com/path/img.png
            const path = parsed.pathname.slice(1); // 去掉开头 /
            if (path) return `https://${path}`;
        }

        // jsdelivr GitHub → raw.githubusercontent.com
        if (hostname === 'cdn.jsdelivr.net' || hostname === 'fastly.jsdelivr.net') {
            const match = parsed.pathname.match(
                /^\/gh\/([^/]+)\/([^@]+)@([^/]+)\/(.+)$/,
            );
            if (match) {
                const [, user, repo, branch, path] = match;
                return `https://raw.githubusercontent.com/${user}/${repo}/${branch}/${path}`;
            }
        }
    } catch {
        // URL 解析失败, 原样返回
    }
    return url;
}

/**
 * 通过 CDN 代理列表轮询, 找到第一个可用 URL
 * 如果有首选代理 (测速锚定), 优先使用
 * 如果是 GitHub URL, 自动尝试 jsdelivr CDN
 * 如果 URL 已经是 CDN, 直接返回 (防止嵌套)
 */
async function resolveWithCdn(
    originalUrl: string,
    proxyTemplates: string[],
    preferredProxy: string,
    stripEnabled: boolean,
): Promise<string> {
    // 0. 去 CDN: 如果开启且 URL 是已知 CDN, 先剥离
    let url = originalUrl;
    if (stripEnabled && isKnownCdnUrl(url)) {
        url = stripCdn(url);
    } else if (!stripEnabled && isKnownCdnUrl(url)) {
        // 未开启去 CDN, 已知 CDN URL 先试直连
        const latency = await probeImageUrl(url, 4000);
        if (latency >= 0) return url;
        // 直连失败, 尝试剥离 CDN 后重新走代理流程
        url = stripCdn(url);
    }

    // 1. 如果有锚定的首选代理, 最先尝试
    if (preferredProxy) {
        const proxyUrl = applyProxyTemplate(preferredProxy, url);
        const latency = await probeImageUrl(proxyUrl, 4000);
        if (latency >= 0) return proxyUrl;
    }

    // 2. 测试原始 URL (或剥离后的)
    const origLatency = await probeImageUrl(url, 4000);
    if (origLatency >= 0) return url;

    // 3. 如果是 GitHub URL, 优先尝试 jsdelivr CDN
    const jsdelivrUrl = githubToJsdelivr(url);
    if (jsdelivrUrl) {
        const latency = await probeImageUrl(jsdelivrUrl, 4000);
        if (latency >= 0) return jsdelivrUrl;
    }

    // 4. 依次尝试代理
    for (const template of proxyTemplates) {
        if (template === preferredProxy) continue; // 已测过
        const proxyUrl = applyProxyTemplate(template, url);
        const latency = await probeImageUrl(proxyUrl);
        if (latency >= 0) return proxyUrl;
    }

    // 全部失败, 返回原始 URL
    return url;
}

// ===== Store =====

export const useImageStore = defineStore('image-hosting-images', () => {
    const registry = ref(loadRegistry());
    const settingsStore = useSettingsStore();

    /** 确保 display_name 唯一 (重名时自动加后缀) */
    function deduplicateDisplayName(name: string): string {
        const existing = new Set(
            Object.values(registry.value.images).map(m => m.display_name),
        );
        if (!existing.has(name)) return name;
        let i = 2;
        while (existing.has(`${name} (${i})`)) i++;
        return `${name} (${i})`;
    }

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
        // upload() 仅支持 local / embedded, remote 模式回退为 local
        const mode = settingsStore.settings.storage_mode === 'remote'
            ? 'local' : settingsStore.settings.storage_mode;

        let serverPath = '';
        let base64Data = '';

        if (mode === 'local') {
            serverPath = await uploadFile(storageName, base64);
        } else {
            // embedded: 直接存到角色卡变量
            base64Data = base64;
        }

        const meta: ImageMeta = {
            display_name: deduplicateDisplayName(file.name.replace(/\.[^.]+$/, '')),
            original_name: file.name,
            mime_type: mimeType,
            size: fileSize,
            uploaded_at: Date.now(),
            server_path: serverPath,
            base64_data: base64Data,
            remote_url: '',
            storage: mode,
        };

        registry.value.images[storageName] = meta;
        saveRegistry(registry.value);
        return storageName;
    }

    /** 添加远程图片 (remote 模式) */
    function addRemote(displayName: string, remoteUrl: string): string {
        // 从 URL 提取真实扩展名, 避免 .remote 后缀
        const urlExt = remoteUrl.split(/[?#]/)[0].split('.').pop()?.toLowerCase() ?? '';
        const safeExt = /^(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/.test(urlExt) ? urlExt : 'png';
        const storageName = generateStorageName(getCharacterName(), safeExt);

        const meta: ImageMeta = {
            display_name: deduplicateDisplayName(displayName),
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

        // local 和 remote 缓存都可能有服务端文件
        if (meta.server_path) {
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
        meta.display_name = deduplicateDisplayName(newDisplayName);
        saveRegistry(registry.value);
    }

    /** 获取图片的可用 URL (自动处理三种模式) */
    function resolveUrl(storageName: string, meta: ImageMeta): string {
        if (meta.storage === 'embedded' && meta.base64_data) {
            return getOrCreateObjectUrl(storageName, meta.base64_data, meta.mime_type);
        }
        if (meta.storage === 'remote' && meta.remote_url) {
            // remote: 如果已有服务端缓存, 使用本地文件
            if (meta.server_path) {
                return toLocalPath(meta.server_path);
            }
            // 同步返回: 先返回缓存或原始 URL, 异步 CDN 轮询在 resolveUrlAsync 中处理
            return resolvedRemoteCache.get(storageName) ?? meta.remote_url;
        }
        return meta.server_path ? toLocalPath(meta.server_path) : '';
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

        // 已有服务端缓存
        if (meta.server_path) {
            return toLocalPath(meta.server_path);
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
                settingsStore.settings.cdn_preferred_proxy,
                settingsStore.settings.cdn_strip_enabled,
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

    /** 将远程图片拉取并缓存到服务端文件系统 */
    async function cacheRemoteToLocal(storageName: string, url: string): Promise<void> {
        const meta = registry.value.images[storageName];
        if (!meta || meta.server_path) return; // 已缓存

        try {
            const response = await fetch(url);
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            const blob = await response.blob();
            const reader = new FileReader();
            const base64 = await new Promise<string>((resolve, reject) => {
                reader.onloadend = () => {
                    const result = reader.result as string;
                    resolve(result.split(',')[1] ?? '');
                };
                reader.onerror = reject;
                reader.readAsDataURL(blob);
            });

            // 上传到服务端文件系统
            const serverPath = await uploadFile(storageName, base64);
            meta.server_path = serverPath;
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

    /** 验证所有带 server_path 的图片的文件完整性 */
    async function verify(): Promise<Record<string, boolean>> {
        const pathEntries = Object.entries(registry.value.images)
            .filter(([, meta]) => meta.server_path)
            .map(([, meta]) => meta.server_path);
        if (pathEntries.length === 0) return {};
        return verifyFiles(pathEntries);
    }

    /**
     * 修复注册表: 检测文件缺失并处理
     * - local 模式缺失: 从注册表中删除该条目
     * - remote 缓存缺失: 清除 server_path (下次重新拉取)
     * @returns { removed: 删除的 local 条目数, cleared: 清除的 remote 缓存数 }
     */
    async function repairRegistry(): Promise<{ removed: number; cleared: number }> {
        const result = await verify();
        let removed = 0;
        let cleared = 0;
        const toDelete: string[] = [];

        for (const [storageName, meta] of Object.entries(registry.value.images)) {
            if (!meta.server_path) continue;
            const exists = result[meta.server_path];
            if (exists !== false) continue; // 文件存在或不在检查范围

            if (meta.storage === 'local') {
                // local 模式: 文件丢了, 从注册表删除
                revokeObjectUrl(storageName);
                toDelete.push(storageName);
                removed++;
            } else if (meta.storage === 'remote') {
                // remote 缓存: 文件丢了, 清除 server_path, 下次重新拉取
                meta.server_path = '';
                cleared++;
            }
        }

        for (const key of toDelete) {
            delete registry.value.images[key];
        }

        if (removed > 0 || cleared > 0) {
            saveRegistry(registry.value);
            resolvedRemoteCache.clear();
        }
        return { removed, cleared };
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

    /**
     * 清理图片缓存/文件
     * @param days 清理多少天前的, 0 表示全部
     * @param includeLocal 是否也清理 local 模式的图片 (不可恢复!)
     * @returns 清理的数量
     */
    async function cleanupCache(days: number, includeLocal = false): Promise<number> {
        const cutoff = days > 0 ? Date.now() - days * 24 * 60 * 60 * 1000 : Infinity;
        let cleaned = 0;
        const toDelete: string[] = []; // 需要从注册表删除的 storageName

        for (const [storageName, meta] of Object.entries(registry.value.images)) {
            if (days > 0 && meta.uploaded_at > cutoff) continue; // 没过期

            // 远程图片的本地缓存: 删文件, 清 server_path, 保留远程 URL
            if (meta.storage === 'remote' && meta.server_path) {
                try { await deleteFile(meta.server_path); } catch { /* ignore */ }
                meta.server_path = '';
                cleaned++;
            }

            // local 模式图片: 删文件 + 删注册表条目 (不可恢复)
            if (includeLocal && meta.storage === 'local' && meta.server_path) {
                try { await deleteFile(meta.server_path); } catch { /* ignore */ }
                revokeObjectUrl(storageName);
                toDelete.push(storageName);
                cleaned++;
            }
        }

        // 删除 local 图片的注册表条目
        for (const key of toDelete) {
            delete registry.value.images[key];
        }

        if (cleaned > 0) {
            saveRegistry(registry.value);
            resolvedRemoteCache.clear();
        }
        return cleaned;
    }

    /**
     * 刷新远程图片缓存: 清除已有缓存并重新拉取
     * @returns { cleared: 清除的旧缓存数, fetched: 重新拉取数 }
     */
    async function refreshCache(): Promise<{ cleared: number; fetched: number }> {
        let cleared = 0;

        // 先清除所有远程缓存
        for (const [, meta] of Object.entries(registry.value.images)) {
            if (meta.storage !== 'remote' || !meta.server_path) continue;
            try { await deleteFile(meta.server_path); } catch { /* ignore */ }
            meta.server_path = '';
            cleared++;
        }

        if (cleared > 0) {
            saveRegistry(registry.value);
        }
        resolvedRemoteCache.clear();

        // 如果开启了本地缓存, 重新拉取所有远程图片
        let fetched = 0;
        if (settingsStore.settings.remote_cache_local) {
            for (const [storageName, meta] of Object.entries(registry.value.images)) {
                if (meta.storage !== 'remote' || !meta.remote_url) continue;
                let url = meta.remote_url;
                if (settingsStore.settings.cdn_proxy_enabled) {
                    url = await resolveWithCdn(
                        meta.remote_url,
                        settingsStore.settings.cdn_proxy_list,
                        settingsStore.settings.cdn_preferred_proxy,
                        settingsStore.settings.cdn_strip_enabled,
                    );
                }
                await cacheRemoteToLocal(storageName, url);
                fetched++;
            }
        }

        return { cleared, fetched };
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
        cleanupCache,
        refreshCache,
        repairRegistry,
    };
});
