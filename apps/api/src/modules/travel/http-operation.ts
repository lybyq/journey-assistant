/** 浏览器中止领域请求时，中止真实供应商调用而非只隐藏加载动画。 */
import type { Request, Response } from 'express';
/** 请求结束后移除监听，避免在复用连接上残留取消句柄。 */
export async function withHttpSignal<T>(
  request: Request,
  response: Response,
  work: (signal: AbortSignal) => Promise<T>,
): Promise<T> {
  const controller = new AbortController();
  const abort = () => {
    if (!response.writableFinished) controller.abort(new Error('HTTP操作已取消'));
  };
  request.once('aborted', abort);
  response.once('close', abort);
  try {
    return await work(controller.signal);
  } finally {
    request.off('aborted', abort);
    response.off('close', abort);
  }
}
