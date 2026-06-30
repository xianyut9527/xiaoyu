<script setup lang="ts">
import { API_VERSION } from '@xiaoyu/api-types';

// 根组件：仅承载初始渲染，业务页面由 pages.json 注册。
// 全局样式由 src/styles/index.scss 注入，拦截器由 src/main.ts 注册。
console.info(`[xiaoyu] api base path: ${API_VERSION}`);
</script>

<style lang="scss">
/* 根组件不写业务样式，详见 src/styles/index.scss */
</style>
