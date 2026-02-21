/**
 * 全局 API 导出
 *
 * 通过 initializeGlobal 将图片托管 API 共享给其他脚本/前端界面
 */
import { useImageStore, type ImageMeta } from './image-store';

export interface ImageHostingAPI {
    /**
     * 通过显示名称获取图片 URL (同步, remote 模式首次可能返回原始 URL)
     * @param displayName 图片的显示名称
     * @returns URL 或 null
     */
    getImageUrl(displayName: string): string | null;

    /**
     * 通过显示名称异步获取图片 URL (支持 CDN 轮询)
     * - remote 模式: 自动进行 CDN 代理轮询, 返回最优可用 URL
     * - local/embedded 模式: 行为与同步版本一致
     */
    getImageUrlAsync(displayName: string): Promise<string | null>;

    /**
     * 获取当前角色卡的所有图片信息
     */
    getAllImages(): Array<{ storageName: string } & ImageMeta>;
}

/**
 * 注册全局 API
 */
export function registerGlobalAPI(): void {
    const api: ImageHostingAPI = {
        getImageUrl(displayName: string): string | null {
            const imageStore = useImageStore();
            return imageStore.getUrlByDisplayName(displayName);
        },

        async getImageUrlAsync(displayName: string): Promise<string | null> {
            const imageStore = useImageStore();
            return imageStore.getUrlByDisplayNameAsync(displayName);
        },

        getAllImages(): Array<{ storageName: string } & ImageMeta> {
            const imageStore = useImageStore();
            return imageStore.getAllImages();
        },
    };

    initializeGlobal('ImageHosting', api);
}
