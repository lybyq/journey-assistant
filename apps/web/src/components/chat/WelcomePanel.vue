<!-- 欢迎区域提供真实目的地影像和可编辑的输入示例。 -->
<script setup lang="ts">
/** 引入图标，旅行偏好只用于编辑输入，不暗示业务已完成。 */
import { ArrowUpRight, CarFront, Mountain, TrainFront, UsersRound } from 'lucide-vue-next';
/** 点击示例只填写输入框，用户仍可确认或修改。 */
const emit = defineEmits<{ choose: [text: string] }>();
/** 真实输入示例不包含任何虚构价格或产品库存。 */
const prompts = [
  /** 自驾场景需要后续画像、路线与费用模块联合实现。 */
  {
    icon: CarFront,
    title: '周末自驾',
    detail: '两个人，从杭州出发',
    text: '我们两个人从杭州出发，想周末自驾两天，预算2000元，喜欢自然风景。请帮我规划并说明费用依据。',
  },
  /** 跟团场景需要产品条款标准化。 */
  {
    icon: UsersRound,
    title: '跟团还是自由行',
    detail: '同样预算，怎么选',
    text: '两位成人想去云南玩五天，请比较跟团和自由行，包含往返交通、住宿、门票以及自费项目。',
  },
  /** 铁路场景突出跨城市接驳而不是孤立票价。 */
  {
    icon: TrainFront,
    title: '坐着高铁去旅行',
    detail: '车次与落地接驳一起看',
    text: '从上海坐高铁去苏州玩两天，请安排车次查询、到站接驳和每天行程，分别列出报价与估算。',
  },
  /** 保持提示数组只读，防止展示组件改写数据。 */
] as const;
/** 结束欢迎组件脚本。 */
</script>
<!-- 欢迎内容进入时有轻微错峰动画。 -->
<template>
  <!-- 外层不使用多层装饰卡片，保持旅行工作台的平静层级。 -->
  <section class="welcome">
    <!-- 先说明页面用途，再给输入操作。 -->
    <div class="welcome-heading">
      <span class="eyebrow">YOUR NEXT JOURNEY</span>
      <h1>今天，想去哪里？</h1>
      <p>把想法告诉行也，一起安排下一程。</p>
    </div>
    <!-- 目的地摄影是页面的主要视觉锚点。 -->
    <div class="destination">
      <!-- 图片随仓库交付，界面不依赖第三方图片域名实时加载。 -->
      <img
        src="/images/alpine-lake.jpg"
        alt="群山环抱的湖泊与木船，作为旅行灵感配图"
        fetchpriority="high"
      />
      <!-- 渐暗遮罩保证照片上文字对比稳定。 -->
      <div class="destination-shade"></div>
      <!-- 图片是灵感配图，不对应虚构旅游报价。 -->
      <div class="destination-copy">
        <span>
          <Mountain :size="13" />
          灵感目的地
        </span>
        <strong>
          山川之间，
          <br />
          留一点时间给自己。
        </strong>
        <small>路线 · 风景 · 你的节奏</small>
      </div>
      <!-- 图片来源可见，避免把素材误认为用户真实行程。 -->
      <span class="image-credit">旅行灵感配图 · Unsplash</span>
      <!-- 结束目的地影像。 -->
    </div>
    <!-- 提示示例为真正可编辑的输入入口。 -->
    <div class="prompt-heading">
      <span>从一个想法开始</span>
      <small>选择示例，或直接输入</small>
    </div>
    <!-- 三种场景采用分隔线列表而非卡片拼图。 -->
    <div class="prompt-list">
      <!-- 图标组件来自本地静态配置，用户输入不能创建任意组件。 -->
      <button
        v-for="prompt in prompts"
        :key="prompt.title"
        type="button"
        class="prompt"
        @click="emit('choose', prompt.text)"
      >
        <component :is="prompt.icon" :size="18" :stroke-width="1.6" />
        <span>
          <strong>{{ prompt.title }}</strong>
          <small>{{ prompt.detail }}</small>
        </span>
        <ArrowUpRight :size="15" />
      </button>
      <!-- 结束提示列表。 -->
    </div>
    <!-- 结束欢迎区域。 -->
  </section>
  <!-- 结束欢迎模板。 -->
</template>
<!-- 欢迎区采用编辑式排版，减少常见仪表盘堆叠。 -->
<style scoped>
/** 主内容宽度控制长行阅读，留出目的地影像空间。 */
.welcome {
  max-width: 760px;
  width: 100%;
  margin: 0 auto;
  animation: arrive 0.5s ease both;
}
/** 标题区域不引入复杂背景。 */
.welcome-heading {
  padding: 15px 0 29px;
}
/** 英文眉题建立轻量的旅行出版物气质。 */
.eyebrow {
  font-size: 12px;
  letter-spacing: 2.2px;
  color: #7b8b79;
}
/** 主标题使用宋体字形，区别于通用聊天应用。 */
h1 {
  font-family: 'STSong', 'Songti SC', 'Noto Serif SC', serif;
  font-size: clamp(29px, 2.7vw, 38px);
  font-weight: 500;
  letter-spacing: 1px;
  margin: 12px 0 11px;
  color: var(--forest);
}
/** 副文案压缩到一行便于扫描。 */
.welcome-heading p {
  margin: 0;
  font-size: 14px;
  color: var(--muted);
}
/** 全幅影像在工作区内部横向展开。 */
.destination {
  height: clamp(190px, 22vw, 260px);
  position: relative;
  overflow: hidden;
  border-radius: 12px;
  background: #506c67;
}
/** 图片裁切保留山与湖的主体。 */
.destination img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 54%;
  transition: transform 1s ease;
}
/** 悬停时仅有轻微景深变化，不影响操作与阅读。 */
.destination:hover img {
  transform: scale(1.025);
}
/** 左侧遮罩为文字提供稳定的深色衬底。 */
.destination-shade {
  position: absolute;
  inset: 0;
  background: linear-gradient(90deg, rgba(10, 37, 30, 0.75), rgba(10, 37, 30, 0.04) 85%);
}
/** 主体文字锚定于照片的安静区域。 */
.destination-copy {
  position: absolute;
  inset: 27px auto auto 30px;
  color: #fff;
}
/** 小标签只解释影像用途。 */
.destination-copy > span {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 13px;
  color: #e0e7df;
  letter-spacing: 1px;
}
/** 摄影标题用自然行距表现空间感。 */
.destination-copy strong {
  display: block;
  font-family: 'STSong', 'Songti SC', serif;
  font-size: clamp(24px, 2.3vw, 31px);
  line-height: 1.6;
  font-weight: 400;
  margin-top: 17px;
  letter-spacing: 2px;
}
/** 照片辅助说明保持低权重。 */
.destination-copy small {
  display: block;
  color: #d5e0d5;
  font-size: 13px;
  margin-top: 12px;
  letter-spacing: 2px;
}
/** 素材来源放在右下角，保留必要归属。 */
.image-credit {
  position: absolute;
  right: 13px;
  bottom: 12px;
  font-size: 12px;
  letter-spacing: 0.4px;
  color: #fff;
  text-shadow: 0 1px 5px #000;
}
/** 示例区域与影像通过空白分隔。 */
.prompt-heading {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin: 29px 0 10px;
  color: var(--ink);
  font-size: 14px;
}
/** 提示操作说明为辅助信息。 */
.prompt-heading small {
  color: var(--muted);
  font-size: 13px;
}
/** 三列在宽屏可快速比较场景。 */
.prompt-list {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
}
/** 场景入口以细分隔线组织，避免多层边框。 */
.prompt {
  display: flex;
  align-items: flex-start;
  gap: 11px;
  text-align: left;
  padding: 19px 13px 19px 0;
  color: var(--forest);
  border-top: 1px solid var(--line);
  transition:
    background 0.2s,
    padding 0.2s;
}
/** 除第一列外留出相同内间距。 */
.prompt + .prompt {
  padding-left: 16px;
}
/** 场景标题清晰但不抢占主输入。 */
.prompt strong {
  display: block;
  font-size: 14px;
  font-weight: 500;
  margin-bottom: 7px;
}
/** 场景描述不使用虚构数据。 */
.prompt small {
  display: block;
  color: #879082;
  font-size: 12px;
  line-height: 1.6;
}
/** 指向箭头靠近边缘，强调点击会填入内容。 */
.prompt > svg:last-child {
  margin-left: auto;
  flex-shrink: 0;
  color: #8b9787;
}
/** 悬停提供轻微底色以确认可点击。 */
.prompt:hover {
  background: var(--wash);
}
/** 进入动画只改变透明度和小距离位移。 */
@keyframes arrive {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}
/** 手机缩小图片和文字，并将入口改为纵向列表。 */
@media (max-width: 760px) {
  .welcome-heading {
    padding: 8px 0 24px;
  }
  .destination {
    height: 220px;
  }
  .destination-copy {
    left: 23px;
    top: 23px;
  }
  .prompt-list {
    grid-template-columns: 1fr;
  }
  .prompt + .prompt {
    padding-left: 0;
  }
  .prompt {
    padding: 15px 0;
  }
  .prompt span {
    display: flex;
    gap: 13px;
    align-items: baseline;
  }
  .prompt strong {
    margin: 0;
  }
  .prompt-heading {
    margin-top: 23px;
  }
}
/** 减少动态偏好时禁用进入和缩放。 */
@media (prefers-reduced-motion: reduce) {
  .welcome {
    animation: none;
  }
  .destination img {
    transition: none;
  }
  .destination:hover img {
    transform: none;
  }
}
/** 结束欢迎样式。 */
</style>
