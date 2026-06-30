/**
 * 统一请求封装
 *
 * 目的：
 * - 收敛"后端业务异常"判定逻辑：业务失败由 `{ code, message, data }` 协议定义，
 *   业务 code !== 0 时抛出 `BizError`，由调用方决定是否提示/捕获。
 * - HTTP 层面的状态码由 `error.interceptor.ts` 统一提示。
 * - 自动携带 deviceId（已在 request.interceptor 注入）。
 *
 * 注意：
 * - 该文件不直接发请求，只做 `uni.request` 的薄包装。
 * - 返回 `T` 时，假定后端业务包络为 `{ code: 0, data: T, message: '' }`。
 */

export interface BizEnvelope<T> {
  code: number;
  message: string;
  data: T;
}

export class BizError extends Error {
  readonly code: number;
  readonly httpStatus: number;

  constructor(code: number, message: string, httpStatus = 200) {
    super(message);
    this.name = 'BizError';
    this.code = code;
    this.httpStatus = httpStatus;
  }
}

export interface RequestOptions extends Omit<UniApp.RequestOptions, 'success' | 'fail' | 'complete'> {
  /** 业务 code 为 0 才视为成功；否则抛出 BizError。默认 true。 */
  throwOnBizError?: boolean;
}

export function request<T = unknown>(options: RequestOptions): Promise<T> {
  const { throwOnBizError = true, header, ...rest } = options;
  return new Promise<T>((resolve, reject) => {
    uni.request({
      ...rest,
      header: header as UniApp.RequestOptions['header'],
      success(res) {
        // HTTP 层错误已经由 error.interceptor 提示过；这里只关心业务包络。
        const body = res.data as BizEnvelope<T> | undefined;
        if (!body || typeof body !== 'object' || !('code' in body)) {
          if (throwOnBizError) {
            reject(new BizError(-1, '响应格式异常', res.statusCode));
          } else {
            resolve(body as unknown as T);
          }
          return;
        }
        if (body.code === 0) {
          resolve(body.data);
          return;
        }
        if (throwOnBizError) {
          reject(new BizError(body.code, body.message || '业务错误', res.statusCode));
        } else {
          resolve(body.data);
        }
      },
      fail(err) {
        reject(err instanceof Error ? err : new Error(String(err)));
      },
    });
  });
}

export default request;
