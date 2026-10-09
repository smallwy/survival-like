package main

import (
	"log"
	"net/http"

	"survivors-game/server/internal/config"
	"survivors-game/server/internal/handler"
	"survivors-game/server/internal/store"
)

func main() {
	cfg := config.Load()
	st, err := store.New(cfg.DataDir)
	if err != nil {
		log.Fatalf("store init failed: %v", err)
	}
	h := handler.New(st)

	mux := http.NewServeMux()
	mux.HandleFunc("/api/health", h.Health)
	mux.HandleFunc("/api/save", h.Save)
	mux.HandleFunc("/api/load", h.Load)
	// 同一路径按方法分流：POST 提交成绩，GET 取排行榜
	mux.HandleFunc("/api/leaderboard", func(w http.ResponseWriter, r *http.Request) {
		if r.Method == http.MethodPost {
			h.PostScore(w, r)
			return
		}
		h.Leaderboard(w, r)
	})

	addr := ":" + cfg.Port
	log.Printf("survivors-game server listening on %s (data=%s)", addr, cfg.DataDir)
	log.Fatal(http.ListenAndServe(addr, mux))
}
