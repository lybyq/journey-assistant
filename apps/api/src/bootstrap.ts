/** 在装饰器类加载前启用类型反射，供 Nest 依赖注入读取构造参数。 */
import 'reflect-metadata';
/** 用 UUID 标识每个 HTTP 请求。 */
import { randomUUID } from 'node:crypto';
/** 导入 Nest 应用工厂。 */
import { NestFactory } from '@nestjs/core';
/** 为测试和开发允许指定日志开关。 */
import type { NestApplicationOptions } from '@nestjs/common';
/** 使用标准 WebSocket 适配器，与未来小程序原生连接兼容。 */
import { WsAdapter } from '@nestjs/platform-ws';
/** 引入 OpenAPI 文档构建工具。 */
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
/** 设置基础安全响应头。 */
import helmet from 'helmet';
/** 导入请求类型，保证中间件参数受 TypeScript 检查。 */
import type { NextFunction, Request, Response } from 'express';
/** 领域表单可能包含有界来源和费用，使用明确JSON上限。 */
import { json } from 'express';
/** 引入组合根模块。 */
import { AppModule } from './app.module.js';
/** 读取统一配置。 */
import { AppConfig } from './config/config.module.js';
/** 引入不会泄漏内部异常的统一过滤器。 */
import { HttpExceptionFilter } from './common/http-exception.filter.js';
/** 装配应用但不监听端口，以便端到端测试使用随机端口。 */
export async function createApplication(options: NestApplicationOptions = {}) {
  /** Nest 负责创建模块依赖图；使用 tsc 保留装饰器元数据。 */
  const app = await NestFactory.create(AppModule, options);
  /** 仍有固定1MiB硬上限，不能让请求体无限占用内存。 */
  app.use(json({ limit: '1mb' }));
  /** 从 DI 容器获得已校验配置。 */
  const config = app.get(AppConfig);
  /** 所有 HTTP 业务接口显式带版本前缀。 */
  app.setGlobalPrefix('api/v1');
  /** 精确配置跨域来源，不开放携带凭据的任意来源访问。 */
  app.enableCors({
    origin: config.origins,
    credentials: true,
    exposedHeaders: ['x-request-id'],
  });
  /** 生产启用 CSP；开发 Swagger 使用内联资源，因此只在开发关闭 CSP。 */
  app.use(helmet({ contentSecurityPolicy: config.env.NODE_ENV === 'production' }));
  /** 对每个请求设置可跟踪但不信任任意外部输入的追踪标识。 */
  app.use((request: Request, response: Response, next: NextFunction) => {
    /** 外部传入值必须符合固定字符与长度规则，否则重新生成。 */
    const incoming = request.headers['x-request-id'];
    /** 仅接受短且安全的追踪串，避免响应头注入。 */
    const requestId =
      typeof incoming === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test(incoming)
        ? incoming
        : randomUUID();
    /** 写回请求，供统一错误过滤器关联。 */
    request.headers['x-request-id'] = requestId;
    /** 公开追踪响应头，不记录聊天正文或任何密钥。 */
    response.setHeader('x-request-id', requestId);
    /** 继续进入控制器。 */
    next();
    /** 结束请求追踪中间件。 */
  });
  /** 安装统一 HTTP 错误结构。 */
  app.useGlobalFilters(new HttpExceptionFilter());
  /** 挂载原生 WebSocket 支持。 */
  app.useWebSocketAdapter(new WsAdapter(app));
  /** 仅在非生产环境开放交互式接口文档。 */
  if (config.env.NODE_ENV !== 'production') {
    /** 给接口文档标明当前交付范围。 */
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('行也 · 旅行助手 API')
        .setDescription(
          '旅行助手完整服务：身份与持久化对话、Deep Agents、MCP查询、旅行需求与证据、预算计算、行程版本、分享与中文导出。',
        )
        /** 为受保护路由注册标准Bearer认证方案。 */
        .addBearerAuth()
        /** 文档版本反映身份与存储交付。 */
        .setVersion('1.0.0')
        .build(),
    );
    /** 同时生成 /api/docs 页面和 /api/docs-json 机器可读规范。 */
    SwaggerModule.setup('api/docs', app, document);
    /** 结束开发文档配置。 */
  }
  /** 支持 SIGTERM 优雅关闭以及 MCP 生命周期清理。 */
  app.enableShutdownHooks();
  /** 返回尚未监听的应用实例。 */
  return app;
  /** 结束应用装配函数。 */
}
