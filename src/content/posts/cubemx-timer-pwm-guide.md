---
title: "CubeMX Timer 配置详解:PWM 输出从图形界面到底层寄存器"
published: 2026-08-03
description: "从 PSC/ARR/影子寄存器到计数器数据流的完整讲解:理解 CubeMX 里每一个 Timer 配置参数,以及它最终映射到哪颗寄存器。"
tags: [STM32, CubeMX, PWM, 定时器, 嵌入式]
category: 嵌入式
slug: cubemx-timer-pwm-guide
lang: zh-CN
---

## 前言:为什么会用 HAL 却不懂配置

很多人能复制代码跑出 PWM:`HAL_TIM_PWM_Start()` 一调,灯亮了、风扇转了。但打开 CubeMX 的 TIM 配置页,Prescaler、Counter Period、Auto-Reload Preload、PWM Mode 1/2、CH Polarity……每一个参数都像天书,改一个就翻车。

本文以 **STM32F1(F103C8T6)+ TIM3 + PWM 输出** 为例,把 CubeMX 的每一个配置项讲透,并下钻到寄存器层,让你看清"界面上的一个勾,最终写进哪颗寄存器、何时生效"。

## 一、定时器是什么:一个会数数的硬件

定时器的核心只有三件事:**数数(CNT)、定上限(ARR)、定步长(PSC)**。

```
┌─────────────┐   分频    ┌──────────┐   每 tick +1   ┌──────────┐   溢出   ┌──────────┐
│ 72MHz 时钟  │──PSC────▶ │  tick    │─────▶         │   CNT    │────────▶ │ 更新事件 │
└─────────────┘   ÷(PSC+1) └──────────┘                │ 0 → ARR  │   UEV   └──────────┘
                                                        └──────────┘
```

- **CNT**:计数器本体,每个 tick 加 1,从 0 数到 ARR
- **PSC**:预分频器,决定"多久数一下"(时间分辨率)
- **ARR**:自动重载值,数到这里就溢出归零,开始下一个周期
- **CCR**:比较值,PWM 就是靠"CNT 和 CCR 比大小"切出来的

### F103C8T6 的定时器家族

| 定时器 | 类型 | 能力 | 挂在哪 |
|---|---|---|---|
| TIM1 | 高级 | PWM + 互补输出 + 死区 + 刹车 | APB2 |
| TIM2 | 通用 | PWM / 捕获 / 编码器(32 位!) | APB1 |
| TIM3 / TIM4 | 通用 | PWM / 捕获 / 编码器(16 位) | APB1 |
| TIM6 / TIM7 | 基础 | **只能定时,没有 PWM** | APB1 |

冷知识:F1 的 **TIM2 和 TIM5 是 32 位计数器**,最大计数 2^32,做长延时/测频时和 16 位的 TIM3/4 完全不同。

## 二、时钟从哪来:APB 分频 ×2 规则

新手 90% 的频率计算事故源头在这里。看 Clock Configuration:

- APB1 总线最大 36MHz(TIM2/3/4 挂在这)
- APB2 总线 72MHz(TIM1 挂在这)

那 TIM2/3/4 凭什么有 72MHz?答案是硬件里的**分频补偿规则**:

> **当 APB 预分频 ≠ 1 时,挂在它上面的定时器时钟 = APB 时钟 × 2**

| APB1 预分频 | APB1 总线 | TIM2/3/4 时钟 |
|---|---|---|
| /1 | 72MHz(超规格,不建议) | 72MHz × 1 = **72MHz** |
| /2(默认) | 36MHz | 36MHz × 2 = **72MHz** |

两种配置定时器时钟恰好都是 72MHz——这就是为什么"定时器时钟 = 总线时钟"的错觉如此普遍。真相是:**预分频 ≠ 1 时自动 ×2**。换 F4(APB1=84M→TIM=168M)或改动分频后,必须用这套规则重算。

CubeMX 里查看位置:**Clock Configuration 标签页**,点 APB1 那根线,下方列出 "TIM2, TIM3, TIM4 Clock = 72.0 MHz"。

## 三、核心参数四件套:PSC、ARR、Counter Mode、Preload

### 1. Prescaler(PSC,预分频器)

决定 tick 有多快。**写入值 = 分频比 − 1**:

```
PSC = 0   → 每个 72MHz 时钟走一步(÷1)
PSC = 71  → 每 72 个时钟走一步(÷72)
```

硬件行为是"数到 PSC+1 个时钟边沿才走一步",所以**分频比永远是 PSC+1**。0 是一个真实的有效状态。

### 2. Counter Period(ARR,计数周期)

决定一个周期有多少个 tick。**写入值 = 周期 − 1**:

```
计数器从 0 数到 ARR:0,1,2,…,ARR 一共 ARR+1 个数
ARR = 999 → 每周期 1000 个 tick
```

记忆口诀:**任何"计数到 X 才动作"的寄存器,写入值都是 X−1。**

### 3. 频率公式与 16 位上限

```
f_PWM = f_TCLK / ((PSC+1) × (ARR+1))
占空比 = Pulse(CCR) / (ARR+1)     ← 只和 CCR、ARR 有关,与 PSC 无关
```

PSC、ARR 都是 16 位寄存器(0~65535)。设计实例——72MHz 下输出 **1kHz**:

```
(PSC+1) × (ARR+1) = 72,000
PSC = 71 → tick = 1MHz(1µs 一格)
ARR = 999 → 周期 = 1000 tick = 1ms = 1kHz
```

tick 越短分辨率越高,但 ARR 一定变小、频率一定变高——**分辨率与频率此消彼长**,上限就是 16 位。

### 4. Counter Mode(计数模式)

| 模式 | 计数路径 | 一个周期 tick 数 | PWM 频率 |
|---|---|---|---|
| Up | 0→1→…→999→溢出→0 | ARR+1 | f_tick/(ARR+1) |
| Down | 999→…→0→溢出→999 | ARR+1 | 同 Up |
| Center Aligned | 0→999→0→…(上下各扫一趟) | ≈2×ARR | **约减半** |

中心对齐模式的频率陷阱:**同样的 PSC/ARR,Up 出 1kHz,Center 只剩约 500Hz**。它把"开"的时间对称放在周期中央,谐波小、电流纹波低,配合 TIM1/TIM8 的互补输出 + 死区,是电机 FOC 控制的标配。

## 四、影子寄存器:底层搬运机制

这是整个定时器最反直觉、也最值得懂的部分。ARR、CCR、PSC 每个寄存器其实有**两份**:

- **预装载寄存器(Preload)**:软件写入的就是它(`__HAL_TIM_SET_COMPARE()` 改它)
- **影子寄存器(Shadow)**:硬件计数器实际使用的值

勾上 **Auto-Reload Preload** 后:软件写入 → 进预装载 → **等到下次溢出(更新事件 UEV)才拷进影子生效**。不勾则写入直通、立即生效。

运行中把 ARR 从 999 改成 300:

| | 勾选(缓冲) | 不勾(直通) |
|---|---|---|
| 生效时机 | 本周期走完、溢出瞬间 | 立刻 |
| 中间态 | 周期完整,波形干净 | 计数器正数到 500 突然回绕,**当前脉冲被拦腰截断** |

那个截断就是**撕裂波形(torn waveform)**:一个畸形脉冲。驱动电机时会造成电流尖峰。

- **PWM 应用默认勾上**:改动必须整周期生效
- **精确单次定时不勾**:你要新值立即生效,等一个不来的溢出没意义

注意 CCR 有自己的一套预装载,**Output Compare Preload**,默认也勾。所以 `__HAL_TIM_SET_COMPARE()` 改占空比要等下一个周期才生效——这是特性,不是 bug。

## 五、PWM 生成模式与极性

硬件比较器每个 tick 把 CNT 和 CCR 比大小:

```
Mode 1:  CNT < CCR  时输出有效(高) → 脉冲在周期前段
Mode 2:  CNT > CCR  时输出有效(高) → 脉冲在周期后段,与 Mode 1 完全反相
```

而 **CH Polarity(极性)** 是输出引脚上最后一道反相器:

| 组合 | 波形 |
|---|---|
| Mode 1 + Polarity High | 前段高,后段低(经典 PWM) |
| Mode 1 + Polarity Low | 前段低,后段高 |
| Mode 2 + Polarity High | 前段低,后段高 ← 同上 |
| Mode 2 + Polarity Low | 前段高,后段低 ← 同首行 |

**Mode 1 + High ≡ Mode 2 + Low。** 模式决定比较逻辑,极性决定引脚反不反相,两件事正交。驱动共阳 LED 或低有效 MOSFET 时用 Polarity Low 能少写一次取反。

## 六、底层工作逻辑:一个 PWM 周期的完整数据流

### 寄存器全景

```
TIMx_CR1   → CEN(启动计数) ARPE(ARR 预装载开关) CMS(计数模式)
TIMx_PSC   → 预分频:每 (PSC+1) 个时钟 CNT 才走一步(恒有影子)
TIMx_ARR   → 周期上限:CNT 数到 ARR 后下一个 tick 溢出
TIMx_CCR1  → 比较值:硬件比较器每 tick 把 CNT 和它比
TIMx_CNT   → 实时计数器,读取即得当前值
TIMx_CCMR1 → OC1M(PWM Mode 1/2) OC1PE(CCR 预装载)
TIMx_CCER  → CC1E(通道输出使能) CC1P(极性)
TIMx_SR    → UIF(溢出标志) CC1IF(比较匹配标志)
TIMx_EGR   → UG:写 1 = 强制复位 CNT 并立即搬运影子寄存器
```

### 执行链(无 CPU 参与)

```
72MHz ──PSC÷72──▶ tick(1MHz)──▶ CNT:0→1→…→999
                                   │
                      硬件比较器(每 tick 一次)
                        CNT < CCR(500) → OCxREF = 高
                        CNT = 500      → CC1IF 置位,OCxREF 翻低
                                   │
                        CNT 数到 999 → 溢出:
                          ① CNT 归 0
                          ② 产生更新事件 UEV
                          ③ UEV 触发:预装载 → 影子 搬运
                             (运行中改的 ARR/CCR 这时才生效)
                          ④ SR.UIF 置 1 → 可选中断/DMA
                                   │
                        开始下一个周期(循环)
```

### 四个关键结论

1. **比较发生在每个 tick,与 CPU 无关** —— PWM 到几十 kHz 时 CPU 零负载。
2. **运行时改参数有两条路**:改 CCR(占空比)→ 写 CCR1,下个 UEV 生效;改 PSC → F1 上 PSC 恒有影子,必须等 UEV 或手动写 `EGR.UG=1` 强制刷新。**改了 PSC 没触发 UEV,频率纹丝不动**——最阴的坑。
3. **溢出 = 一个周期结束**:HAL 里 `HAL_TIM_PeriodElapsedCallback` 就是 UIF 中断的入口。
4. **输出链路**:`CNT 与 CCR 比较 → OCxREF → CC1P 极性 → CC1E 门控 → GPIO 复用推挽`。计数器在跑但没使能 CC1E,引脚永远没有波形。

边界情况:`CCR=0` → 输出恒低(0%);`CCR ≥ ARR+1` → 输出恒高(100%)。风扇"一上电全速"多数是这个。

## 七、生成的代码逐行拆解

```c
static void MX_TIM3_Init(void)
{
  TIM_OC_InitTypeDef sConfigOC = {0};

  htim3.Instance = TIM3;
  htim3.Init.Prescaler = 71;              // → TIM3->PSC(tick = 1MHz)
  htim3.Init.CounterMode = TIM_COUNTERMODE_UP;  // → CR1.CMS=00(Up 模式)
  htim3.Init.Period = 999;                // → TIM3->ARR(周期 1000 tick)
  htim3.Init.ClockDivision = TIM_CLOCKDIVISION_DIV1;  // → CR1.CKD(输入滤波分频,与 PWM 无关)
  htim3.Init.AutoReloadPreload = TIM_AUTORELOAD_PRELOAD_ENABLE;  // → CR1.ARPE=1
  HAL_TIM_PWM_Init(&htim3);               // 内部:初始化时基 + 调用 HAL_TIM_MspInit

  sConfigOC.OCMode = TIM_OCMODE_PWM1;     // → CCMR1.OC1M = 110(PWM Mode 1)
  sConfigOC.Pulse = 500;                  // → TIM3->CCR1(占空比 500/1000 = 50%)
  sConfigOC.OCPolarity = TIM_OCPOLARITY_HIGH;  // → CCER.CC1P=0(极性高)
  sConfigOC.OCFastMode = TIM_OCFAST_DISABLE;   // → CCMR1.OC1FE(只有频率逼近 f_tick/2 才需要)
  HAL_TIM_PWM_ConfigChannel(&htim3, &sConfigOC, TIM_CHANNEL_1);
}
```

`HAL_TIM_MspInit`(时钟使能,写在 stm32f1xx_hal_msp.c):

```c
__HAL_RCC_TIM3_CLK_ENABLE();   // → RCC_APB1ENR.TIM3EN,时钟源即 APB1 ×2
```

`HAL_TIM_MspPostInit`(GPIO,新版 HAL 自动生成):

```c
GPIO_InitStruct.Pin = GPIO_PIN_6;              // PA6 = TIM3_CH1
GPIO_InitStruct.Mode = GPIO_MODE_AF_PP;        // 复用推挽,别手改成输出!
GPIO_InitStruct.Speed = GPIO_SPEED_FREQ_LOW;
HAL_GPIO_Init(GPIOA, &GPIO_InitStruct);
```

运行时三件套:

```c
HAL_TIM_PWM_Start(&htim3, TIM_CHANNEL_1);      // 做两件事:CR1.CEN=1(开始计数)+ CCER.CC1E=1(使能输出)
__HAL_TIM_SET_COMPARE(&htim3, TIM_CHANNEL_1, 700);   // → CCR1=700(下个 UEV 生效 → 70%)
__HAL_TIM_SET_AUTORELOAD(&htim3, 1999);        // → ARR=1999(下个 UEV 生效 → 频率减半)
```

需要"每周期干点事"(如软件呼吸灯渐变):`HAL_TIM_PWM_Start_IT()` 使能 UEV 中断,在回调里改 CCR:

```c
void HAL_TIM_PeriodElapsedCallback(TIM_HandleTypeDef *htim)
{
  if (htim->Instance == TIM3) { /* 每个周期触发一次 */ }
}
```

## 八、翻车清单

1. **PSC/ARR 忘记 +1** → 频率正好差一倍
2. **以为 TIM 时钟 = APB 时钟** → 改动 APB 分频后全部算错(×2 规则)
3. **Center Aligned 当 Up 用** → 频率莫名减半
4. **Pulse > ARR** → 输出恒高,电机/风扇全速失控
5. **GPIO 没配复用推挽** → 引脚没波形(或改成普通输出推挽,波形被 GPIO 层吃掉)
6. **改 PSC 后没触发更新事件** → 频率纹丝不动
7. **`HAL_TIM_PWM_Stop` 后计数器仍在跑** → 重启输出时相位和预期不同
8. **运行中改 ARR 撕裂波形** → 记得开 Auto-Reload Preload

## 九、速查表

| CubeMX 参数 | 寄存器 | 作用 | 默认建议 |
|---|---|---|---|
| Prescaler | TIMx_PSC | tick 分辨率 | 按目标频率算 |
| Counter Period | TIMx_ARR | 周期 tick 数 | 按目标频率算 |
| Counter Mode | CR1.CMS | 计数方向 | Up 通用 / Center 电机 |
| Auto-Reload Preload | CR1.ARPE | ARR 影子缓冲 | PWM 勾上 |
| Mode | CCMR1.OC1M | 比较逻辑 | PWM1 |
| Pulse | TIMx_CCR1 | 占空比 | 500/1000 |
| Output Compare Preload | CCMR1.OC1PE | CCR 影子缓冲 | 勾上 |
| CH Polarity | CCER.CC1P | 引脚反相 | High |

一句话总结:**PSC 定步长,ARR 定周期,CCR 定占空比;所有"界面上勾的框",最后都落到影子寄存器的搬运时机上。**
