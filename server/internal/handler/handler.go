package handler

import (
	"encoding/json"
	"net/http"
	"time"

	"survivors-game/server/internal/store"
)

type Handler struct {
	store *store.Store
}

func New(s *store.Store) *Handler { return &Handler{store: s} }

func (h *Handler) Health(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(map[string]string{"status": "ok"})
}

// Save 接收前端 POST 的整局进度（任意 JSON 字符串），按 playerId 落盘。
func (h *Handler) Save(w http.ResponseWriter, r *http.Request) {
	if r.Method != http.MethodPost {
		http.Error(w, "method not allowed", http.StatusMethodNotAllowed)
		return
	}
	pid := r.URL.Query().Get("pid")
	if pid == "" {
		http.Error(w, "pid required", http.StatusBadRequest)
		return
	}
	var body struct {
		Data string `json:"data"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	if err := h.store.SaveGame(pid, body.Data, time.Now().Unix()); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "saved"})
}

// Load 返回该 playerId 的最近存档；404 表示还没存过。
func (h *Handler) Load(w http.ResponseWriter, r *http.Request) {
	pid := r.URL.Query().Get("pid")
	if pid == "" {
		http.Error(w, "pid required", http.StatusBadRequest)
		return
	}
	sv, err := h.store.LoadGame(pid)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	writeJSON(w, sv)
}

// GetMeta 读取玩家跨局成长数据；404 表示还没有记录。
func (h *Handler) GetMeta(w http.ResponseWriter, r *http.Request) {
	pid := r.URL.Query().Get("pid")
	if pid == "" {
		http.Error(w, "pid required", http.StatusBadRequest)
		return
	}
	m, err := h.store.LoadMeta(pid)
	if err != nil {
		http.Error(w, "not found", http.StatusNotFound)
		return
	}
	m.Normalize()
	writeJSON(w, m)
}

// ReportMeta 提交一局结果，后端累加统计并按阈值解锁新内容，返回最新 meta 与本局新解锁项。
func (h *Handler) ReportMeta(w http.ResponseWriter, r *http.Request) {
	pid := r.URL.Query().Get("pid")
	if pid == "" {
		http.Error(w, "pid required", http.StatusBadRequest)
		return
	}
	var body struct {
		Score        int    `json:"score"`
		Kills        int    `json:"kills"`
		TimeSurvived int    `json:"timeSurvived"`
		Won          bool   `json:"won"`
		Stage        string `json:"stage"` // 通关的关卡键（"c2s3"）；未通关传空串
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}

	m, err := h.store.LoadMeta(pid)
	if err != nil {
		// 新号默认带两把武器：手枪 + 冲锋枪。
		// 只给手枪会形成死结 —— 升级池里的「新武器」卡要靠累计击杀解锁武器才有
		// 内容，而解锁门槛（如 铁蒺藜 需单局 150 分）又要求你本来就打得动。
		// 实测单手枪 DPS 26.7，刷怪速率一旦超过它，玩家就只会越堆越多直到被围死，
		// 跑出"39 秒阵亡、14 只怪围着你"的曲线。两把武器（合计 69.6 dps）才让
		// 「打怪 → 升级 → 变强」这个正循环转起来。
		m = &store.Meta{
			PlayerID:        pid,
			UnlockedWeapons: []string{"bow", "crossbow"},
			UnlockedChars:   []string{"rookie"},
			// 计谋默认给一个：否则第一章里"计谋"这条支柱对玩家完全不可见，
			// 要等通关第一章才知道游戏有主动技能 —— 教学成本太高。
			UnlockedStrats: []string{"slowdown"},
		}
	}
	m.Normalize()

	before := map[string]bool{}
	for _, id := range allIDs(m) {
		before[id] = true
	}

	m.TotalKills += body.Kills
	if body.Score > m.BestScore {
		m.BestScore = body.Score
	}
	m.Runs += 1
	m.Souls += body.Score / 10
	if body.Won && body.Stage != "" {
		addUnique(&m.ClearedStages, body.Stage)
	}
	grantUnlocks(m)
	m.Updated = time.Now().Unix()

	if err := h.store.SaveMeta(*m); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// 用空切片而不是 nil：nil 会被 encoding/json 序列化成 null，
	// 前端 `for (const x of unlockedNow)` 直接抛 TypeError。
	now := []string{}
	for _, id := range allIDs(m) {
		if !before[id] {
			now = append(now, id)
		}
	}

	// 响应必须**扁平**：GET /api/meta 返回的就是一个 Meta 对象，
	// 两个接口形状一致，前端才不用记两套字段路径。
	// 先把 Meta 编成 JSON 再解回 map，这样以后给 Meta 加字段不会漏改这里。
	b, _ := json.Marshal(m)
	var out map[string]any
	_ = json.Unmarshal(b, &out)
	out["unlockedNow"] = now
	writeJSON(w, out)
}

// PostScore 提交一条排行榜成绩。
func (h *Handler) PostScore(w http.ResponseWriter, r *http.Request) {
	var sc store.Score
	if err := json.NewDecoder(r.Body).Decode(&sc); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}
	if err := h.store.AddScore(sc); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, map[string]string{"status": "added"})
}

// Leaderboard 返回 Top100。
func (h *Handler) Leaderboard(w http.ResponseWriter, r *http.Request) {
	list, err := h.store.Leaderboard()
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	writeJSON(w, list)
}

func allIDs(m *store.Meta) []string {
	out := append([]string{}, m.UnlockedWeapons...)
	out = append(out, m.UnlockedChars...)
	out = append(out, m.UnlockedStrats...)
	return out
}

func addUnique(slice *[]string, id string) {
	for _, x := range *slice {
		if x == id {
			return
		}
	}
	*slice = append(*slice, id)
}

// 章节奖励表 —— 与前端 web/src/config/gameData.ts 的 CAMPAIGN[].reward 一一对应。
//
// 这份表在 Go 侧是**故意重复**的：解锁必须由服务端权威判定，
// 否则改一下浏览器内存就能白嫖全解锁。重复的代价用守卫脚本兜住 ——
// tools/check_facing_applied.mjs 会交叉比对两边，漂移就报错。
//
// 键是该章**最后一关**的关卡键（第三关），因为奖励挂在「通关本章」上。
var chapterRewards = map[string][]string{
	"c1s3": {"strat_fire"},
	"c2s3": {"caltrop", "strat_ambush"},
	"c3s3": {"zhangfei", "strat_emptycity"},
	"c4s3": {"heavybow", "strat_chain"},
	"c5s3": {"zhaoyun", "strat_laststand"},
	"c6s3": {"guandao"},
}

// 潜行者 id 白名单：奖励串里除了武器就是潜行者，靠这个把 id 派发到正确的切片。
var charIDs = map[string]bool{"rookie": true, "guanyu": true, "zhangfei": true, "zhaoyun": true}

// grantUnlocks 按累计统计阈值 + 主线通关进度权威解锁武器 / 潜行者 / 计谋。
func grantUnlocks(m *store.Meta) {
	// 累计门槛（老机制，保留）
	if m.BestScore >= 150 {
		addUnique(&m.UnlockedWeapons, "caltrop")
	}
	if m.TotalKills >= 150 {
		addUnique(&m.UnlockedWeapons, "crossbow")
	}
	if m.BestScore >= 600 {
		addUnique(&m.UnlockedWeapons, "heavybow")
	}
	if m.TotalKills >= 400 {
		addUnique(&m.UnlockedWeapons, "knives")
	}
	if m.BestScore >= 1200 {
		addUnique(&m.UnlockedWeapons, "guandao")
	}
	if m.TotalKills >= 800 {
		addUnique(&m.UnlockedWeapons, "snake")
	}
	if m.BestScore >= 800 {
		addUnique(&m.UnlockedChars, "guanyu")
	}
	if m.BestScore >= 2000 {
		addUnique(&m.UnlockedChars, "zhangfei")
	}
	if m.BestScore >= 4000 {
		addUnique(&m.UnlockedChars, "zhaoyun")
	}

	// 主线奖励：只认已经通关的关卡，玩家谎报 stage 也没用 ——
	// 因为他必须先真的把那一关打过去才会有对应的 clearedStages 记录。
	// （这一条挡不住主动构造请求的人，但挡住"改前端常量"就够了；真要做强校验
	//   需要在关卡开始时下发服务端签发的 nonce，那属于下一步的事。）
	for _, st := range m.ClearedStages {
		for _, id := range chapterRewards[st] {
			switch {
			case len(id) > 6 && id[:6] == "strat_":
				addUnique(&m.UnlockedStrats, id)
			case charIDs[id]:
				addUnique(&m.UnlockedChars, id)
			default:
				addUnique(&m.UnlockedWeapons, id)
			}
		}
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
