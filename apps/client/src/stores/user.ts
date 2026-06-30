/**
 * user store
 *
 * U8 范围：仅持久化 deviceId；用户身份字段（id/avatar/nickname 等）由后续 U9/U10 引入。
 *
 * 约束：
 * - deviceId 来自 `getOrCreateDeviceId()`，已经写入 uni.storage。
 * - store 内只持有引用，不要在 action 里再写一次 storage（避免并发覆盖）。
 */

import { defineStore } from 'pinia';
import { ref } from 'vue';
import { getOrCreateDeviceId } from '@/utils/device-id';

export const useUserStore = defineStore('user', () => {
  const deviceId = ref<string>(getOrCreateDeviceId());

  function refreshDeviceId() {
    deviceId.value = getOrCreateDeviceId();
  }

  return {
    deviceId,
    refreshDeviceId,
  };
});

export default useUserStore;
