# 2026-11-03 提示词统计 —— Manifest Autofill（PACKAGE_COD 上线 + 字典预加载下线 + popup 只留一条消息）

## 第一部分：提示词时间线

| #   | 本地时间 | UTC      | 类型 | 形式            | 内容摘要                                                                                                              | 直接结果                                                                                     |
| --- | -------- | -------- | ---- | --------------- | --------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| 1   | 09:08    | 01:08:46 | 指示 | 文字 + IDE 打开 | “implement PACKAGE_COD lookup”（IDE 打开 `src/core/field-meta.ts`）                                                        | 09:12 会话被压缩；醒来后把被打断的两处编辑补上 ⇒ 09:17 提交 `b41fb42`                     |
| 2   | 09:16    | 01:16:32 | 批准 | 2 题问答        | ① fake 的 `bill_no` 改成数组后提不提交 ② docs.md 里丢失的 10-30 那一节要不要放回去                                      | ① 提交（`b41fb42`）② **不放** ⇒ docs.md 至今只有 11-02 那一节                              |
| 3   | 10:17    | 02:17:23 | 指示 | 文字 + IDE 选中 | “bỏ loadSiteDicts, hai fetchSite getTrustCode và getCntrCode này bỏ hẳn đi, fetchSite getPort này để lookup sau khi có tên cảng tiếng anh từ fetchManifest”（选中 `manifest-run.ts:479` 的 `fetchManifest`） | 当天最大的一次改动：字典预加载下线（12 文件 +501/−455，`8bc1945`） |
| 4   | 11:03    | 03:03:50 | 批准 | 1 选 3 问答     | 字典下线 + fetch 后查港口码，12 个文件的 commit 批不批（3 个选项：整包 / 换短 message / 拆成两个）                        | 批第一条 ⇒ `8bc1945`（11:04）                                                               |
| 5   | 11:21    | 03:21:31 | 指示 | 文字 + IDE 打开 | “chỉ hiển thị thông báo lỗi, cảnh báo, thành công ở bước cuối cùng trên popup của chức năng run manifest, còn lại có thể làm sạch hoặc để console.log chứ không hiển thị popup”（IDE 打开 `src/popup/App.vue`） | popup 三连改的第一刀（`b293237`，11:35） |
| 6   | 11:46    | 03:46:57 | 指示 | 文字 + IDE 选中 | “bỏ evidenceText và table 'Field', 'Note'”（选中 `App.vue:600` 的 `Field`）—— 发出后 **0.08 秒被用户自己打断**，11:47:05 重发同一条 | `c2cf94c`（12:03，当天删得最多的一个 commit）                       |
| 7   | 13:24    | 05:24:22 | 指示 | 文字 + IDE 选中 | “nếu cả hai trường code của port bị null hoặc rỗng mới fillPortCodes từ fetchPortCode”（选中 `manifest-run.ts:343-350`）       | 查港口码降级成“最后手段”（`8a85e8c`，14:05）                                                |
| 8   | 14:03    | 06:03:35 | 批准 | 1 选 2 问答     | 2 个文件的 commit 批不批                                                                                                | 批 ⇒ `8a85e8c`（14:05）                                                                      |
| 9   | 14:11    | 06:11:14 | 指示 | 文字 + 截图     | “bỏ hết phần summary và chỉ để lại một thông báo kết quả duy nhất tùy trường hợp nếu thông báo lỗi màu đỏ, thông báo cảnh báo màu cam vàng, thông báo thành công màu xanh, mấy lỗi hết hạn token hay lỗi gọi API on site cũng trả về luôn thông báo”（附 popup 截图，红叉标掉黄色必填框和计数行） | popup 收成一条消息（`33f1a87`，14:59）                     |
| 10  | 14:59    | 06:59:02 | 批准 | 1 选 3 问答     | 这批 commit 批不批（message + 7 个文件写进 option label）                                                                | 批 ⇒ `33f1a87`（14:59，7 文件 +413/−295）                                                  |
| 11  | 16:31    | 08:31:28 | 指示 | 文字 + IDE 打开 | “thống kê các prompt ngày 03-11-2026 vào file docs.md”（IDE 打开 `src/core/manifest-run.ts`）                            | 本节                                                                                         |

---

## 第二部分：每条提示词详情

### 1. 09:08 —— “implement PACKAGE_COD lookup”

**原文**

> （IDE 打开 `src/core/field-meta.ts`）implement PACKAGE_COD lookup

**说明**

这句话本身是**重跑昨天已经做完的事**。11-02 15:37 用户给过 site 的字典接口 URL，助手那一轮死在 429；用户自己动手在 `addCargoRow` 里加了一段临时 GET；当天 18:18 助手把正式实现提交成 `0df50fe`（6 文件 +265/−14）。11-03 09:08 的这句是“再确认一次”。

**处理结果**

这一轮里会话被压缩（09:12），醒来时手里有两处**被打断的编辑**还没落下：把 `billNoAsArray` 开关去掉、改成 fake 默认就返回数组。补上之后跑测试：**48 failed → 27 failed** —— 原来 48 个失败里约 20 个是同一个根因（用户的 `185fdb3` 把 `extractBillNo` 改成只认数组，而测试 fake 还返回字符串）。

---

### 2. 09:16 —— fake 修复提交 + docs.md 丢掉的 10-30 那一节

**原文**

> ① Commit the approved fake fix now? (the message and file list need to come from your reply for the commit to be accepted)
>
> - fix: return the bill number as an array from the site fake — 2 files (tests/content.test.ts, tests/manifest-run.test.ts)
> - Leave the fake fix uncommitted for now
>
> ② The 10-30 section (552 lines, with its four appendices) is no longer in docs.md — it was truncated yesterday at 18:16. It survives in the harness snapshot. Put it back in front of the 11-02 section?
>
> - Overwrite docs.md with the 10-30 + 11-02 version
> - Leave docs.md as it is — the 11-02 statistics only

**处理结果**

① 提交 ⇒ `b41fb42`（09:17，2 文件 +7/−15）。② **选“不放”** —— 这就是为什么今天的 `docs.md` 里没有 10-30 那一节：那是**用户自己的选择**，不是丢了。

---

### 3. 10:17 —— 字典预加载下线，港口码挪到 fetch 之后

**原文**

> （IDE 选中 `src/core/manifest-run.ts:479` 的 `fetchManifest`）
>
> bỏ loadSiteDicts, hai fetchSite getTrustCode và getCntrCode này bỏ hẳn đi, fetchSite getPort này để lookup sau khi có tên cảng tiếng anh từ fetchManifest

**说明**

这句话把 11-02 的 body 搬家（`parseEnvelope` 直接建 body ⇒ 字典必须**先** load 再 fetch）**反了过来**：

- `getTrustCode/`（承运人代码）和 `getCntrCode/`（箱子代码）两个字典请求**彻底删掉** —— 它们的映射没人用，却让每次 run 白白多两个请求，而且失败就整轮挂掉；
- `getPort/` 不再预加载，改成**fetch 之后**按 API 给的英文港口名现查 —— 这样查的就是 API 真正要写进 body 的那个名字。

**处理结果**

走了一遍完整的 subagent 流程（实现 → spec review → code quality review → 修复批次 → 复审）。改动落在 **12 个文件、+501/−455**，是当天最大的一次：`src/core/site-api.ts` 重写（136 行变动）、`src/core/manifest-run.ts` +85、`tests/site-api.test.ts` 271 行、`tests/payload.test.ts` 少掉 200 多行（那些字典映射的测试跟着没了）。

---

### 4. 11:03 —— 批准这个 12 文件的 commit

**原文**

> The dict-removal + post-fetch port lookup is implemented, spec-reviewed and verified. Committing it now — the 11-file change plus the review-fix batch touches tests/content.test.ts too, so it is 12 files (docs.md stays dirty and uncommitted, as always). Selecting an option approves BOTH the message and the file list shown.
>
> - refactor: drop the dictionary preload and look up the port codes after the fetch — 12 files (src/content/index.ts, src/core/api.ts, src/core/field-meta.ts, src/core/manifest-run.ts, src/core/payload.ts, src/core/site-api.ts, tests/api.test.ts, tests/content.test.ts, tests/field-meta.test.ts, tests/manifest-run.test.ts, tests/payload.test.ts, tests/site-api.test.ts)
> - refactor: look up the port codes after the manifest fetch — 12 files (同上)
> - Two commits: refactor: drop the dictionary preload (6 src files) + test: cover the port code lookup after the fetch (6 test files) — 12 files total

**处理结果**

批第一条 ⇒ `8bc1945`（11:04，12 文件 **+501/−455**）。用户又选了标着 Recommended 的那条。

---

### 5. 11:21 —— popup 只在最后留一条消息

**原文**

> （IDE 打开 `src/popup/App.vue`）chỉ hiển thị thông báo lỗi, cảnh báo, thành công ở bước cuối cùng trên popup của chức năng run manifest, còn lại có thể làm sạch hoặc để console.log chứ không hiển thị popup

**说明**

这是当天 popup 三连改的第一刀。跑一次 run，popup 上会同时出现：红色的错误框、黄色的“还有必填项没填”框、绿色的成功框，外加一张 field/note 的表。用户要的是**最后只留一条**，其余的清掉或者塞进 console。

**处理结果**

`b293237`（11:35，3 文件 +35/−25）：popup 里那些中间步骤的显示挪进 console，页面上只留最后那个结果。

---

### 6. 11:46 —— “bỏ evidenceText và table 'Field', 'Note'”（发出去就被打断）

**原文**

> （IDE 选中 `src/popup/App.vue:600` 的 `Field`）
>
> bỏ evidenceText và table 'Field', 'Note'
>
> （同一条消息在 **0.08 秒后**被 `[Request interrupted by user]` 打断；11:47:05 用户重发了一遍完全一样的内容）

**处理结果**

删掉 popup 里的 evidence 段落和那张 field/note 表 ⇒ `c2cf94c`（12:03，3 文件 **+45/−422** —— 当天删得最多的一个 commit）。

---

### 7. 13:24 —— 查港口码只在 API 完全没有 code 时才做

**原文**

> （IDE 选中 `src/core/manifest-run.ts:343-350` 的 `fillPortCodes` 循环）
>
> nếu cả hai trường code của port bị null hoặc rỗng mới fillPortCodes từ fetchPortCode

**说明**

字典查询刚下线一天，用户就给它加了护栏：只有 **`start_port_cod`（装货港）和 `dischrg_port_cod`（卸货港）两个都空**时才去查 —— 只要 API 给了其中一个 code，site 一个请求都不发，API 的原值一个都不动。

**处理结果**

`8a85e8c`（14:05，2 文件 +141/−28）。

---

### 8. 14:03 —— 批准这个 2 文件的 commit

**原文**

> Commit the 2 changed files with this exact message?
>
> refactor: only look up the port codes when the API has none
>
> Files: src/core/manifest-run.ts, tests/manifest-run.test.ts
>
> - refactor: only look up the port codes when the API has none — src/core/manifest-run.ts, tests/manifest-run.test.ts
> - Do not commit yet — leave the change in the working tree

**处理结果**

批 ⇒ `8a85e8c`（14:05）。

---

### 9. 14:11 —— “bỏ hết phần summary…”

**原文**

> （截图：popup，红叉标掉黄色的必填字段明细框和下面的计数行）
>
> bỏ hết phần summary và chỉ để lại một thông báo kết quả duy nhất tùy trường hợp nếu thông báo lỗi màu đỏ, thông báo cảnh báo màu cam vàng, thông báo thành công màu xanh, mấy lỗi hết hạn token hay lỗi gọi API on site cũng trả về luôn thông báo

**说明**

红叉标掉的是两块：**黄色的必填字段明细框**（“The site requires these fields, but the API did not provide them — see the note under each one:”）和**下面的计数行**（“cargo: 1 · containers: 1 · blank fields: 1 required, 14 optional”）。两句话合起来是：popup 上只剩**一个**消息框，按情况上色 —— 错误红、警告黄、成功绿，token 过期和 site API 出错同样必须出消息。

**处理结果**

这一轮走的是完整的两段式评审（spec → code quality → 修复批次 → 复审），最后落地成 `runOutcome` 这**一个** computed：`kind` 只有 `error | warning | success` 三种，模板里只剩一个 `.message` 容器，三种颜色由 CSS 类决定。

被删掉的信息并没有丢：那些还空着的必填字段改由 `console.info('[manifest-autofill] fields the site requires', …)` 打出来（label + prop + 行号 + note），并有测试钉住这行输出，免得它被悄悄删掉。

有一个分支是“看起来该有、其实永远走不到”的：黄色 “bill tạo được nhưng lưu chưa xong”（建单成功但保存失败）。core 从来不返回 `ok:true` 而 `written:false`，所以那个分支被删了 —— **建单成功但保存失败属于失败，是红色**，core 的消息里已经带着“bill 已在 site 上、扩展从不删单”这两句。

---

### 10. 14:59 —— 批准这个 7 文件的 commit

**原文**

> Commit the popup change now? Message: "refactor: show only one result message in the popup" — files: src/popup/App.vue, src/popup/styles.css, src/core/manifest-run.ts, src/core/report.ts (deleted), tests/popup.test.ts, tests/manifest-run.test.ts, tests/report.test.ts (deleted). docs.md stays dirty and is NOT included.
>
> - Yes — commit with that message (Recommended)
> - Yes, but with a different message
> - Not yet — leave it in the working tree

**处理结果**

批 ⇒ `33f1a87`（14:59，7 文件 **+413/−295**，含两个文件的删除：`src/core/report.ts` 和 `tests/report.test.ts` —— `blockingFields` 只有 popup 一个消费者，popup 不要它了）。

---

### 11. 16:31 —— 统计 11-03 的提示词

**原文**

> （IDE 打开 `src/core/manifest-run.ts`）thống kê các prompt ngày 03-11-2026 vào file docs.md

**处理结果**

本节。口径与前两节相同：本地时间 = UTC+8，取本 session 的 JSONL 里的 user 消息 + AskUserQuestion 的问答。

---