<script setup lang="ts">
// U8 占位：我的
// 后续在 U9/U10 接入用户信息、设备 ID 显示、设置入口。
import { useUserStore } from '@/stores/user';

const userStore = useUserStore();
</script>

<template>
  <view class="container">
    <view class="title">我的</view>
    <view class="subtitle">U8 占位页面</view>
    <view class="device-id">deviceId: {{ userStore.deviceId }}</view>
  </view>
</template>

<style lang="scss" scoped>
.container {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  min-height: 100vh;
  padding: 48rpx;
  box-sizing: border-box;
}

.title {
  font-size: 44rpx;
  font-weight: 600;
  margin-bottom: 24rpx;
}

.subtitle {
  font-size: 26rpx;
  color: #999;
  margin-bottom: 32rpx;
}

.device-id {
  font-size: 22rpx;
  color: #bbb;
  word-break: break-all;
  text-align: center;
}
</style>
