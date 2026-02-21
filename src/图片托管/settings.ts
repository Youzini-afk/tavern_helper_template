/**
 * 脚本全局设置 (持久化到脚本变量)
 */

/**
 * 默认 CDN 代理模板
 * 占位符:
 *   {url} = encodeURIComponent(原始URL) — 用于查询参数型
 *   {raw} = 原始URL去协议头             — 用于路径拼接型
 */
export const DEFAULT_CDN_PROXIES = [
    'https://wsrv.nl/?url={url}',
    'https://images.weserv.nl/?url={url}',
    'https://i0.wp.com/{raw}',
    'https://i1.wp.com/{raw}',
    'https://i2.wp.com/{raw}',
    'https://image.baidu.com/search/down?url={url}',
];

const Settings = z
    .object({
        /** 存储模式: 'local' 服务端文件 | 'embedded' 嵌入角色卡 | 'remote' 远程URL */
        storage_mode: z.enum(['local', 'embedded', 'remote']).default('local'),
        /** 是否启用上传时自动压缩/转 WebP */
        auto_compress: z.boolean().default(false),
        /** 压缩质量 (0-1) */
        compress_quality: z.coerce.number().default(0.8),
        /** 是否启用 CDN 代理 (remote 模式) */
        cdn_proxy_enabled: z.boolean().default(false),
        /** CDN 代理模板列表 */
        cdn_proxy_list: z.array(z.string()).default(DEFAULT_CDN_PROXIES),
        /** 锚定的首选 CDN 代理 (测速后自动设置, 空表示未锚定) */
        cdn_preferred_proxy: z.string().default(''),
        /** 远程图片是否缓存到本地 (拉取一次后缓存, 之后不再重复拉取) */
        remote_cache_local: z.boolean().default(false),
    })
    .prefault({});

export const useSettingsStore = defineStore('image-hosting-settings', () => {
    const settings = ref(Settings.parse(getVariables({ type: 'script', script_id: getScriptId() })));

    watch(settings, (val) => {
        insertOrAssignVariables(klona(val), { type: 'script', script_id: getScriptId() });
    }, { deep: true });

    return { settings };
});
