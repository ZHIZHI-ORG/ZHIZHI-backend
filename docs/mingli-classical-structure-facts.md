# 古法结构事实层规则规划

> **Status:** SUPERSEDED
> **Release:** HISTORICAL
> **Verification:** COMMITTED
> **Last verified:** 2026-07-11
> **Sources:** 早期三类月令事实规划；当前合同由 `zipingStructureFacts.ts` 与相关测试接管

> 本文保留最小事实层的设计推导和示例。当前实现已经扩展为 `ziping_structure_v2_fact_layer` 与 `ziping_ai_brief_v1`，不要按本文的三类输出上限裁剪现有合同。

## 1. 产品结论

事实层只输出 AI 不应该临场猜的结构证据。

本文件不做格局判断，不做喜忌用神，不做调候，不做断语。它只给 AI 一份极小的“月令结构证据包”。

本轮只保留三类事实：

1. 月令司令。
2. 月令藏干透出。
3. 月令藏干被地支关系触发。

一句话边界：

```text
事实层输出“发生了什么”，AI 解析层判断“这意味着什么”。
```

## 2. 精简原则

进入事实层的条件：

| 条件 | 是否进入 |
| --- | --- |
| 需要历法、月令表、藏干表稳定计算 | 进入 |
| 需要跨字段匹配，AI 容易漏看 | 进入 |
| 已经在基础排盘里直接给出 | 不重复 |
| AI 能根据现有事实自行推理 | 不重复 |
| 包含格局名、强弱、喜忌、吉凶 | 不进入 |

因此本文件删除旧版中的：

```text
ten_god_matrix
pattern_entry_facts
regular_entries
mixed_qi_entries
unsupported_entries
```

## 3. 输出契约

唯一新增对象：

```yaml
classical_structure_facts:
  rule_version: classical_structure_facts_v2_minimal
  month_command:
    month_branch: 辰
    command_stem: 戊
    command_depth: main_qi
    command_ten_god: 食神
    command_source: main_qi_fallback
    precision_level: low
  month_hidden_stems:
    - stem: 戊
      depth: main_qi
      ten_god: 食神
      exposed_in: [month_stem]
      activated_by_branch_relations: []
    - stem: 乙
      depth: middle_qi
      ten_god: 正印
      exposed_in: []
      activated_by_branch_relations: []
    - stem: 癸
      depth: residual_qi
      ten_god: 正官
      exposed_in: [hour_stem]
      activated_by_branch_relations:
        - relation_type: arch_combination
          relation_name: 申辰拱子
          target_element: 水
  flags:
    - command_precision_low
    - mixed_qi_month
    - hidden_stem_exposed
```

字段只表达事实，不表达判断。

## 4. 规则 1：月令司令

### 4.1 定义

月令司令回答：

```text
当前版本把月支中的哪一个藏干视为当权之气？
```

### 4.2 v1 规则

v1 只取月支主气。

```text
寅=甲，卯=乙，辰=戊，巳=丙，午=丁，未=己
申=庚，酉=辛，戌=戊，亥=壬，子=癸，丑=己
```

输出：

```yaml
month_command:
  month_branch: 辰
  command_stem: 戊
  command_depth: main_qi
  command_ten_god: 食神
  command_source: main_qi_fallback
  precision_level: low
```

必须加标记：

```text
command_precision_low
```

原因：

```text
当前没有做节气分日司令，只能标记为低精度事实。
```

## 5. 规则 2：月令藏干透出

### 5.1 定义

月令藏干透出回答：

```text
月支里的每个藏干，是否出现在年干、月干、时干？
```

日干是日主，不算透出位置。

### 5.2 字段

每个藏干输出一条：

| 字段 | 含义 |
| --- | --- |
| `stem` | 月令藏干 |
| `depth` | 主气、中气、余气 |
| `ten_god` | 相对日主的十神 |
| `exposed_in` | 透出位置 |

`exposed_in` 只允许：

```text
year_stem
month_stem
hour_stem
```

### 5.3 标记

| 条件 | 标记 |
| --- | --- |
| 至少一个月令藏干透出 | `hidden_stem_exposed` |
| 没有月令藏干透出 | `no_hidden_stem_exposed` |
| 主气透出 | `main_qi_exposed` |
| 中气透出 | `middle_qi_exposed` |
| 余气透出 | `residual_qi_exposed` |
| 多个月令藏干透出 | `multiple_hidden_stems_exposed` |

不能输出“有力”“成格”“为用”。

## 6. 规则 3：月令藏干被地支关系触发

### 6.1 定义

该规则回答：

```text
现有地支关系是否明确牵动了某个月令藏干对应的五行？
```

只引用现有地支关系事实，不重新定义关系规则。

允许引用：

```text
六合、三合、半合、拱合、三会、冲、刑、害、破
```

### 6.2 字段

写入对应藏干的 `activated_by_branch_relations`。

```yaml
activated_by_branch_relations:
  - relation_type: arch_combination
    relation_name: 申辰拱子
    target_element: 水
```

只记录客观关系，不解释：

```text
被引动后是否有力。
是否成格。
是否破格。
是否为喜忌。
```

## 7. 杂气月处理

杂气不做独立模块。

月支为辰、戌、丑、未时，只输出：

```text
mixed_qi_month
```

不输出：

```text
杂气正财格入口
杂气偏财格入口
杂气正印格入口
杂气偏印格入口
杂气七杀格入口
杂气食神格入口
```

原因：

```text
杂气某格已经是 AI 解析层的格局判断，不是事实层。
```

事实层只保留藏干和十神。AI 可以自行判断要不要讨论杂气格。

## 8. 禁止输出

本文件永远不输出：

```text
某格成立
某格不成立
某格破格
某神有力
某神为用
喜某五行
忌某五行
调候用神
富贵贫贱
婚姻疾病寿命事件断语
```

## 9. 实现顺序

最小实现路径：

1. 读取月支藏干。
2. 取月支主气为 `month_command`。
3. 把每个藏干映射成相对日主的十神。
4. 检查藏干是否出现在年干、月干、时干。
5. 引用现有地支关系，记录是否牵动月令藏干对应五行。
6. 输出 `flags`。

不新增任何格局判断逻辑。

## 10. 成功标准

AI 最终能拿到：

1. 月令司令是谁。
2. 月令藏干分别是什么十神。
3. 哪些月令藏干透出。
4. 哪些月令藏干被地支关系牵动。
5. 哪些地方存在低精度或杂气复杂性。

AI 仍然负责：

1. 判断格局。
2. 判断成败。
3. 判断喜忌。
4. 判断调候。
5. 组织断语。

## 11. 示例

输入：

```yaml
day_master: 丙
month_branch: 辰
year_stem: 甲
month_stem: 戊
hour_stem: 癸
existing_branch_relations:
  - relation_type: arch_combination
    relation_name: 申辰拱子
    target_element: 水
```

输出：

```yaml
classical_structure_facts:
  rule_version: classical_structure_facts_v2_minimal
  month_command:
    month_branch: 辰
    command_stem: 戊
    command_depth: main_qi
    command_ten_god: 食神
    command_source: main_qi_fallback
    precision_level: low
  month_hidden_stems:
    - stem: 戊
      depth: main_qi
      ten_god: 食神
      exposed_in: [month_stem]
      activated_by_branch_relations: []
    - stem: 乙
      depth: middle_qi
      ten_god: 正印
      exposed_in: []
      activated_by_branch_relations: []
    - stem: 癸
      depth: residual_qi
      ten_god: 正官
      exposed_in: [hour_stem]
      activated_by_branch_relations:
        - relation_type: arch_combination
          relation_name: 申辰拱子
          target_element: 水
  flags:
    - command_precision_low
    - mixed_qi_month
    - hidden_stem_exposed
    - main_qi_exposed
    - residual_qi_exposed
    - multiple_hidden_stems_exposed
```
