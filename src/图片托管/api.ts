/**
 * SillyTavern 服务端文件 API 封装层
 *
 * 基于 SillyTavern 的 /api/files/ 端点实现本地文件存储
 */

/**
 * 上传文件到 SillyTavern 服务端
 * @param name 文件名 (仅 [a-zA-Z0-9_\-.] 字符)
 * @param base64Data 文件的 base64 编码数据
 * @returns 上传成功后的服务端相对路径
 */
export async function uploadFile(name: string, base64Data: string): Promise<string> {
  const response = await fetch('/api/files/upload', {
    method: 'POST',
    headers: SillyTavern.getRequestHeaders(),
    body: JSON.stringify({ name, data: base64Data }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`上传文件 '${name}' 失败: (${response.status}) ${errorText}`);
  }

  const result = (await response.json()) as { path: string };
  return result.path;
}

/**
 * 删除服务端文件
 * @param filePath 文件的服务端相对路径
 */
export async function deleteFile(filePath: string): Promise<void> {
  const response = await fetch('/api/files/delete', {
    method: 'POST',
    headers: SillyTavern.getRequestHeaders(),
    body: JSON.stringify({ path: filePath }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`删除文件 '${filePath}' 失败: (${response.status}) ${errorText}`);
  }
}

/**
 * 验证文件是否存在
 * @param urls 文件路径列表
 * @returns 路径到是否存在的映射
 */
export async function verifyFiles(urls: string[]): Promise<Record<string, boolean>> {
  const response = await fetch('/api/files/verify', {
    method: 'POST',
    headers: SillyTavern.getRequestHeaders(),
    body: JSON.stringify({ urls }),
  });

  if (!response.ok) {
    throw new Error(`验证文件失败: (${response.status})`);
  }

  return (await response.json()) as Record<string, boolean>;
}

/**
 * 将 File 对象转为 base64 字符串
 */
export function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // 去除 data:xxxx;base64, 前缀
      const base64 = result.split(',')[1] ?? '';
      resolve(base64);
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/**
 * 生成安全的存储文件名
 * 仅使用 [a-zA-Z0-9_\-.] 字符
 */
export function generateStorageName(characterName: string, extension: string): string {
  // 清除非 ASCII 字符, 用 hash 补充辨识度
  const ascii = characterName.replace(/[^a-zA-Z0-9]/g, '');
  const safeCharName = ascii || hashStr(characterName);
  const uuid = (typeof crypto?.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`
  ).slice(0, 8);
  const safeExt = extension.replace(/^\./, '').replace(/[^a-zA-Z0-9]/g, '') || 'png';
  return `img_${safeCharName}_${uuid}.${safeExt}`;
}

/** 简单 hash: 将字符串转为短 hex 字符串 (非加密用途) */
function hashStr(str: string): string {
  let h = 0;
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(36).slice(0, 8) || 'char';
}
