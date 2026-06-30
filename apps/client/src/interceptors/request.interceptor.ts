/**
 * 全局请求拦截器
 *
 * 职责：
 * 1. 自动注入 `X-Device-ID`，便于后端做幂等/限流。
 * 2. 统一设置 `Content-Type`，允许单请求覆盖。
 *
 * 触发顺序：
 * - 由 `src/main.ts` 引入模块即生效（uni 拦截器为全局单例）。
 * - 与 `error.interceptor.ts` 并存，分别处理成功/失败与状态码。
 */

import { getOrCreateDeviceId } from '@/utils/device-id';

uni.addInterceptor('request', {
  invoke(options) {
    const headers: Record<string, string> = {
      'X-Device-ID': getOrCreateDeviceId(),
    };
    if (options.header) {
      // 调用方显式传入的 header 优先级高于默认。
      Object.assign(headers, options.header as Record<string, string>);
    }
    if (!headers['Content-Type'] && !headers['content-type']) {
      headers['Content-Type'] = 'application/json';
    }
    options.header = headers;
  },
});

export default {};
