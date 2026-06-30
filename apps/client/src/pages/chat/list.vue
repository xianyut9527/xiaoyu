<script setup lang="ts">
// U8 占位：会话列表
// 后续 U9 在此实现会话列表/创建/进入会话。
</script>

<template>
  <view class="container">
    <view class="title">会话列表</view>
    <view class="subtitle">U8 占位页面，等待 U9 接入</view>
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
}
</style>
