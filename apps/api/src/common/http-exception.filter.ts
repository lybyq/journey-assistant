/** 引入统一异常捕获器接口与 HTTP 异常类型。 */
import { ArgumentsHost, Catch, HttpException, type ExceptionFilter } from '@nestjs/common';
/** 仅导入 Express 类型，不在运行时绑定第二个 HTTP 服务。 */
import type { Request, Response } from 'express';
/** 捕获所有 HTTP 异常，避免内部堆栈和秘密值进入响应。 */
@Catch()
/** 将 HTTP 错误转换成带追踪标识的稳定结构。 */
export class HttpExceptionFilter implements ExceptionFilter {
  /** 统一处理控制器、路由和服务抛出的异常。 */
  catch(exception: unknown, host: ArgumentsHost): void {
    /** 获取本次 HTTP 上下文。 */
    const context = host.switchToHttp();
    /** 读取请求头中由框架生成或验证过的追踪标识。 */
    const request = context.getRequest<Request>();
    /** 取得 Express 响应以设置状态码。 */
    const response = context.getResponse<Response>();
    /** 已知 HTTP 异常保留状态码，其他异常统一视为内部错误。 */
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    /** 只暴露受控 HTTP 消息，不发送原始数据库、SDK 或网络错误。 */
    const message =
      exception instanceof HttpException && status < 500
        ? exception.message
        : '服务暂时不可用，请稍后重试';
    /** 以固定字段返回错误，便于网页和未来小程序统一消费。 */
    response.status(status).json({
      statusCode: status,
      message,
      requestId: request.headers['x-request-id'],
      timestamp: new Date().toISOString(),
    });
    /** 结束异常处理。 */
  }
  /** 结束统一 HTTP 异常过滤器。 */
}
