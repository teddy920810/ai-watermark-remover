# 过期恢复数据擦除合同

研发收尾范围：清除已完成、过期产物关联JSON里的session副本及旧诊断遮罩；保留JSON记录、任务身份、原报价/指纹、Provider任务标识、哈希和金融依据。不删除对象或数据库账本，不调用Provider，不以R2前缀TTL替代字段擦除。

默认dry-run。实际apply必须匹配刚审阅的计划digest；任何读、版本、身份或完整性异常均停止。复用现有R2条件写和金融只读查询。R2的[强一致读取与列举](https://developers.cloudflare.com/r2/reference/consistency/)不意味着跨对象事务，因此使用共同输入/结果/parentJob形成的关联组与现有job租约围栏；组内任一未满足条件则整组保留。

仅READY/EXPIRED、无pendingResult、金融settled/refunded且与任务归属/金额/单位匹配的组可进入计划。UNKNOWN、SAVING、SETTLING、未完成退款与只有金融终态的FAILED/REFUNDED均保护；这些任务可能仍接受迟到收费结果。活跃租约、有效结果、未完成精修子任务、缺失/跨归属元数据也保护。所有关联artifact必须到期至少24小时，任务执行终态稳定至少24小时；这是额外恢复缓冲，不能据财务状态提前擦除。

逐一校验job、artifact、attempt和provider/mock receipt的归属与关联，读取receipt中的结果到期时间，包含旧大遮罩但有大小上限。擦除已知session/诊断遮罩字段，不按名称模糊删除全部metadata。apply先获取组内job租约，再重新检查版本；每条更新以ETag为条件。冲突或中断可能留下部分已擦除记录，不会丢失金融字段；租约过期后重新预演可幂等续行。重试只擦除字段，不重新提交处理。

每次手动维护先执行只读盘点和dry-run，核对eligible/skipped与原因、digest及版本，才运行同计划的apply。默认不调度自动擦除；启用定期擦除属于另行确认的运行政策。现有dispatcher和Provider收费行为不变。代码回退保留已擦除的过期JSON，不能恢复过期session；活跃任务和金融恢复不依赖这些符合条件的字段。

2026-11-01的单次真实维护已记录在[重构发布台账](REFACTOR_LEDGER.md)：预演检查13任务，7任务/6组符合条件，同digest apply擦除35条记录；后验保留13任务、0待擦除。该次结果不是未来任务可擦除的证明，也不授权再次apply、删除控制记录或开启自动调度；原预演、apply、后验与失败证据继续保留。
