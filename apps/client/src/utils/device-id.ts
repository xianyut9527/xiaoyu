/**
 * 设备 ID 管理
 *
 * - 使用 UUID v4 作为设备唯一标识，写入 uni.storage 持久化。
 * - 首次启动自动生成；后续启动复用。
 * - 通过 `getOrCreateDeviceId()` 暴露给请求拦截器，自动注入 `X-Device-ID`。
 *
 * 约束：
 * - 仅用于幂等/限流/防滥用的设备维度，不承载用户身份。
 * - 永远不要把 deviceId 当作登录凭证；用户态由后端 session 维护。
 */

const DEVICE_ID_KEY = 'xiaoyu:device_id';

function generateUUIDv4(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * 读取设备 ID，若不存在则生成并持久化。
 *
 * 调用时机：每个 `uni.request` 触发时由 `request.interceptor.ts` 调用。
 */
export function getOrCreateDeviceId(): string {
  try {
    const stored = uni.getStorageSync(DEVICE_ID_KEY);
    if (typeof stored === 'string' && stored.length > 0) {
      return stored;
    }
  } catch (e) {
    // storage 不可用时降级为本次进程内 ID（开发态常见）。
    console.warn('[xiaoyu] getStorageSync failed, fallback to ephemeral id', e);
  }
  const fresh = generateUUIDv4();
  try {
    uni.setStorageSync(DEVICE_ID_KEY, fresh);
  } catch (e) {
    console.warn('[xiaoyu] setStorageSync failed', e);
  }
  return fresh;
}

/**
 * 清除设备 ID（仅在用户主动重置/登出时使用）。
 */
export function clearDeviceId(): void {
  try {
    uni.removeStorageSync(DEVICE_ID_KEY);
  } catch (e) {
    console.warn('[xiaoyu] removeStorageSync failed', e);
  }
}

export const DEVICE_ID_STORAGE_KEY = DEVICE_ID_KEY;
