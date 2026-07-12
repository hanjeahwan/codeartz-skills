# 语义定位参考

定位审查线索时使用语义类型，不使用固定正则作为主入口。

## 目录

- 字面标记类
- 语义反模式类
- 规则颗粒度类
- 结构职责类
- 语言一致性类
- 跨文件事实类

## 通用规则

- 语义线索只用于提醒审查方向，不直接判定命中。
- 每条语义线索都必须通过 `SKILL.md` 的判定门。
- 不要把固定关键词、固定正则或搜索结果当作命中依据。

## 字面标记类

支持方式：

- 扫描占位、时效、状态和未完成标记。
- 命中后仍过判定门。

中文线索例：

- `待定`
- `待补`
- `待填`
- `目前`
- `最近`
- `新版`
- `暂时`

英文线索例：

- `TODO`
- `FIXME`
- `TBD`
- `currently`
- `recently`
- `latest`
- `temporary`

不命中例：代码、命令、配置字段、引用原文里的同形字符串。

## 语义反模式类

支持方式：

- 逐句判断这句话是否改变读者动作。
- 不要依赖某个固定词。

中文线索例：

- `本文档说明了审查流程。`
- `流水线不是从读 repo 开始，而是从理解输入开始。`
- `适当处理错误。`
- `重要的是保持高质量。`

英文线索例：

- `This document explains the audit process.`
- `The flow is not repository-first, but input-first.`
- `Handle errors properly.`
- `It is important to keep the output high quality.`

不命中例：句子虽然像说明，但紧邻规则需要它定义触发条件、边界或失败后果。

## 规则颗粒度类

支持方式：检查单条规则是否可独立勾选，是否把条件、动作、禁止、例外挤在一起。

中文线索例：

- `用户给出路径时优先使用该路径，不要扫描无关目录。`
- `未授权变体写入待裁决，不写成普通风险。`

英文线索例：

- `When the user provides a path, use it first and do not scan unrelated directories.`
- `If an unauthorized variant exists, write it to pending decision, not risk.`

不命中例：规则已拆成独立动作行，或已用命名槽位表达互斥分支。

## 结构职责类

支持方式：

- 检查标题、缩进、文件位置和阶段边界。
- 不要只看句子措辞。

中文线索例：

- 入口文件里维护阶段执行细节。
- 阶段手册里重复入口路由。
- 简单规则被包装成多层缩进。
- 多条规则只替换对象名称，却重复相同的判断关系与处理方式。
- 当前阶段要求预读后续阶段手册。

英文线索例：

- The entry file repeats phase execution details.
- A phase guide repeats routing rules from the entry file.
- A simple rule is nested under multiple wrapper headings.
- Several rules repeat the same decision while only changing the named object.
- The current phase asks the agent to read later phase guides.

不命中例：多文件之间只是引用权威位置，没有重复维护同一条规则；相似对象具有不同风险、后果或处理方式。

## 语言一致性类

支持方式：先确定主语言，再判断外语片段是否只是普通说明词。

中文主语言线索例：

- `先做 quick check。`
- `创建 scratch pad。`
- `指定 owner。`

英文主语言线索例：

- `Use 当前配置 for this check.`
- `Mark the item as 待裁决.`
- `Write 不适用 when the field is empty.`

不命中例：专名、术语、字段、路径、命令、状态枚举、直接引用、契约值。

## 跨文件事实类

支持方式：先查权威来源，再判断目标文件是否重复维护同一事实。

审查“重复事实来源”前，搜索以下位置是否已有定义：

- CLAUDE.md
- AGENTS.md
- README
- 相邻规范文档
- glossary
- 配置文件
- 代码中的权威定义

只有发现同一事实被重复定义且可能分叉时，才报告“重复事实来源”。
