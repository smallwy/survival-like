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

func writeJSON(w http.ResponseWriter, v any) {
	w.Header().Set("Content-Type", "application/json")
	_ = json.NewEncoder(w).Encode(v)
}
