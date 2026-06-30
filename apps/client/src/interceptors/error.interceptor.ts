/**
 * 全局错误拦截器
 *
 * 职责：
 * - 状态码 4xx/5xx 统一翻译为中文 toast 文案。
 * - 网络层错误（fail）单独处理。
 *
 * 业务错误约定：
 * - 后端业务异常仍走 200 + `{ code, message }` 协议，落到各业务 store 自行处理。
 * - 这里只处理 HTTP 状态码层面的"系统级"问题。
 */

const ERROR_MESSAGES: Record<number, string> = {
  400: '请求参数错误',
  401: '设备标识缺失，请重启应用',
  403: '没有访问权限',
  404: '资源不存在',
  408: '请求超时，请稍后再试',
  429: '请求过于频繁，请稍后再试',
  500: '服务器繁忙，请稍后再试',
  502: '服务暂时不可用',
  503: '服务维护中',
  504: '网关超时，请稍后再试',
};

function pickMessage(statusCode: number): string {
  if (ERROR_MESSAGES[statusCode]) return ERROR_MESSAGES[statusCode];
  if (statusCode >= 500) return '服务器繁忙，请稍后再试';
  if (statusCode >= 400) return `请求失败 (${statusCode})`;
  return '';
}

uni.addInterceptor('request', {
  success(res) {
    if (res.statusCode >= 400) {
      const msg = pickMessage(res.statusCode);
      if (msg) {
        uni.showToast({ title: msg, icon: 'none', duration: 2000 });
      }
    }
  },
  fail(err) {
    // 网络层失败：DNS 失败、连接拒绝、超时等。
    console.warn('[xiaoyu] request fail', err);
    uni.showToast({ title: '网络异常，请检查连接', icon: 'none', duration: 2000 });
  },
});

export default {};
