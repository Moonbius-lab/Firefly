---
title: "PWM 频率与占空比手动计算:PSC/ARR/CCR 三步反推法"
published: 2026-08-04
description: "不依赖 CubeMX 自动计算,从目标频率和占空比手动反推 PSC、ARR、CCR——含每秒计数次数(tick)的选择思路,以及 LED、电脑散热风扇、舵机三个实战例子。"
tags: [STM32, PWM, 定时器, 嵌入式]
category: 嵌入式
slug: pwm-frequency-duty-calc
lang: zh-CN
---

## 前言:会配参数,但让你算又算不出来

很多人能跑通 PWM,但打开 CubeMX 的 TIM 配置页:Prescaler 填几、Counter Period 填几、Pulse 填几,依然靠感觉、靠试错。

这篇给你一套**可复用的手动计算流程**:拿到一个目标频率 + 目标占空比,三步填完 CubeMX 的 TIM 配置页,全程只用一个除法和一个乘法。

沿用上篇《CubeMX Timer 配置详解》的设定:STM32F103、定时器时钟 72MHz、Up 计数模式、PWM Mode 1、极性 High。

## 一、只需要记住两个公式

$$f_{PWM} = \frac{f_{TCLK}}{(PSC+1) \times (ARR+1)}$$

$$\text{占空比} = \frac{Pulse}{ARR+1}$$

- $f_{TCLK}$:定时器时钟(本文设定下 72MHz)
- $PSC+1$:分频比,决定每秒计数几次(tick 频率)
- $ARR+1$:一个周期的 tick 数
- $Pulse$(CCR):高电平持续的 tick 数

> [!NOTE]
> **PSC、ARR、Pulse 的写入值都要减 1**——硬件行为是"数到 X 才动作",所以寄存器里存的是 X−1。这是计算类翻车的第一大坑,下文统一用公式右边这种"实际值"表示。

## 二、三步反推法

### Step 1:确认定时器时钟 f_TCLK

打开 CubeMX 的 Clock Configuration:APB1 预分频 /2 时,TIM2/3/4 时钟 = APB1 × 2 = **72MHz**(分频补偿规则)。

改了 APB 分频或换了芯片(F4 是 168MHz 等)必须重新确认这一步——**后面所有计算都依赖它**。

### Step 2:选 PSC,定 tick 频率(每秒计数几次)

$tick = f_{TCLK} / (PSC+1)$。优先选一个**能整除 72MHz** 的"整"数,反推时才是整数:

| PSC | tick 频率(每秒计数次数) | 每次计数耗时 | 适合 |
|---|---|---|---|
| 71 | 1 MHz | 1 µs | 通用(µs 级分辨率) |
| 35 | 2 MHz | 0.5 µs | 高分辨率需求 |
| 719 | 100 kHz | 10 µs | 电机调速 |
| 7199 | 10 kHz | 100 µs | 低频信号 |
| 71999 | 1 kHz | 1 ms | 慢速控制 |

> [!TIP]
> 每秒计数几次没有标准答案,由**目标频率和所需分辨率**共同决定:tick 越密 → 时间分辨率越高,但同一频率下 ARR+1 越小、占空比刻度越粗。分辨率与频率此消彼长。

### Step 3:由目标频率反推 ARR,再算 Pulse

$$ARR+1 = \frac{f_{tick}}{f_{PWM}} \qquad \Rightarrow \qquad ARR = \frac{f_{tick}}{f_{PWM}} - 1$$

$$Pulse = \text{占空比} \times (ARR+1)$$

如果 ARR 算出来不是整数,回 Step 2 换个 PSC(或微调频率)。**ARR 必须是 0~65535 的整数**,超了 16 位上限就得降 tick。

## 三、实战例子

### 例 1:LED 呼吸灯,目标 1kHz、占空比 50%

Step 2:tick = 1MHz → PSC = 71
Step 3:ARR+1 = 1M / 1k = 1000 → ARR = 999;Pulse = 50% × 1000 = 500

```text
Prescaler = 71   Counter Period = 999   Pulse = 500
```

### 例 2:电脑散热风扇,目标 25kHz

4 针风扇的 PWM 标准频率是 **25kHz**(Intel 规范,超出人耳可闻范围)。先把目标频率放进整除约束:

$$(PSC+1) \times (ARR+1) = \frac{72M}{25k} = 2880$$

- **方案 A(推荐)**:PSC = 71 → tick = 1MHz → ARR+1 = 40 → ARR = 39;Pulse = 20 → 50%
- **方案 B(调速更细腻)**:PSC = 35 → tick = 2MHz → ARR+1 = 80 → ARR = 79;Pulse 取 0~80,共 81 级调速

> [!WARNING]
> 风扇"一上电就全速失控",十有八九是 **Pulse 填得比 ARR 大** → 输出恒高 100%。算完检查:占空比 = Pulse / (ARR+1) 必须 ≤ 1。

### 例 3:舵机,目标 50Hz(周期 20ms)

舵机吃的是 20ms 周期、1~2ms 高电平脉冲(中位 1.5ms),本质也是 PWM,只是频率低、占空比窗口特殊。

Step 2:tick = 1MHz(PSC = 71),µs 级才能对脉冲精细
Step 3:ARR+1 = 20ms / 1µs = 20000 → ARR = 19999

高电平范围映射:

```text
Pulse = 1000 → 高电平 1.0ms(极限一侧)
Pulse = 1500 → 高电平 1.5ms(中位)
Pulse = 2000 → 高电平 2.0ms(极限另一侧)
```

占空比公式照旧:Pulse = 1500 → 1500/20000 = 7.5%,只是这里的"占空比"语义变成了角度位置。

## 四、验证:写完反算一遍

改完配置,用两个检查把 ±1 和整除失误当场抓出来:

1. **频率**:$f_{tick} / (ARR+1)$ 必须等于目标频率(例 2 方案 A:1M / 40 = 25kHz ✓)
2. **占空比**:$Pulse / (ARR+1)$ 必须等于目标占空比(例 2 方案 A:20 / 40 = 50% ✓)

> [!WARNING]
> 两个最阴的坑:
> - **PSC/ARR 忘记 +1**:频率恰好差一倍(填了 39 却当作 40 tick 用,25kHz 变 25.6kHz 还浑然不觉)
> - **ARR+1 不是整数**:说明 tick 选得不好。比如目标 30kHz、tick = 1MHz:1M/30k = 33.33 → 周期不是整数个 tick,输出频率必然跑偏

## 五、总结

三步走:**确认时钟 → 挑能整除的 tick → 反推 ARR 与 Pulse**;算完反着验一遍。原理与寄存器细节见《CubeMX Timer 配置详解:PWM 输出从图形界面到底层寄存器》。
