/**
 * 脚本全局设置 (持久化到脚本变量)
 */
const Settings = z
    .object({
        /** 存储模式: 'local' 服务端文件 | 'embedded' 嵌入角色卡 */
        storage_mode: z.enum(['local', 'embedded']).default('local'),
        /** 是否启用上传时自动压缩/转 WebP */
        auto_compress: z.boolean().default(false),
        /** 压缩质量 (0-1) */
        compress_quality: z.coerce.number().default(0.8),
    })
    .prefault({});

export const useSettingsStore = defineStore('image-hosting-settings', () => {
    const settings = ref(Settings.parse(getVariables({ type: 'script', script_id: getScriptId() })));

    watchEffect(() => {
        insertOrAssignVariables(klona(settings.value), { type: 'script', script_id: getScriptId() });
    });

    return { settings };
});
