/** 导入独立应用装配函数，测试不会意外监听固定端口。 */
import { createApplication } from "./bootstrap.js";
/** 读取已注入容器的服务配置。 */
import { AppConfig } from "./config/config.module.js";
/** 创建真实 Nest 应用。 */
const app = await createApplication();
/** 在所有环境校验通过后获取监听参数。 */
const config = app.get(AppConfig);
/** 按显式地址监听；默认仅对本机开放开发服务。 */
await app.listen(config.env.PORT, config.env.HOST);
