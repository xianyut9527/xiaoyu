import { createSSRApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';

// 全局样式
import '@/styles/index.scss';
// 全局拦截器（模块副作用即注册）
import '@/interceptors/request.interceptor';
import '@/interceptors/error.interceptor';

export function createApp() {
  const app = createSSRApp(App);
  app.use(createPinia());
  return {
    app,
  };
}
