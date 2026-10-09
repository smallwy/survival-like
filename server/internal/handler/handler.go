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
		Score         int  `json:"score"`
		Kills         int  `json:"kills"`
		TimeSurvived  int  `json:"timeSurvived"`
		Won           bool `json:"won"`
	}
	if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
		http.Error(w, "bad body", http.StatusBadRequest)
		return
	}

	m, err := h.store.LoadMeta(pid)
	if err != nil {
		m = &store.Meta{PlayerID: pid, UnlockedWeapons: []string{"pistol"}, UnlockedChars: []string{"rookie"}}
	}

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
	grantUnlocks(m)
	m.Updated = time.Now().Unix()

	if err := h.store.SaveMeta(*m); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var now []string
	for _, id := range allIDs(m) {
		if !before[id] {
			now = append(now, id)
		}
	}
	writeJSON(w, map[string]any{"meta": m, "unlockedNow": now})
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
	return out
}

// grantUnlocks 按累计统计阈值权威解锁武器与皮肤。
func grantUnlocks(m *store.Meta) {
	add := func(slice *[]string, id string) {
		for _, x := range *slice {
			if x == id {
				return
			}
		}
		*slice = append(*slice, id)
	}
	if m.BestScore >= 150 {
		add(&m.UnlockedWeapons, "shotgun")
	}
	if m.TotalKills >= 150 {
		add(&m.UnlockedWeapons, "smg")
	}
	if m.BestScore >= 600 {
		add(&m.UnlockedWeapons, "rifle")
	}
	if m.TotalKills >= 400 {
		add(&m.UnlockedWeapons, "orbit")
	}
	if m.BestScore >= 1200 {
		add(&m.UnlockedWeapons, "beam")
	}
	if m.TotalKills >= 800 {
		add(&m.UnlockedWeapons, "aura")
	}
	if m.BestScore >= 800 {
		add(&m.UnlockedChars, "guanyu")
	}
	if m.BestScore >= 2000 {
		add(&m.UnlockedChars, "zhangfei")
	}
	if m.BestScore >= 4000 {
		add(&m.UnlockedChars, "zhaoyun")
	}
}

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
